import { normalizeHistoryEmail } from "./history";
import type { Env } from "./env";
import { fetchWithTimeout, PROVIDER_TIMEOUT_MS } from "./providers/fetch-timeout";
import { setAssumeIdentityForRequest } from "./request-context";

interface Jwk {
  kid: string;
  n: string;
  e: string;
  kty: string;
  alg?: string;
}
let jwkCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getJwks(): Promise<Jwk[]> {
  const now = Date.now();
  if (jwkCache && now - jwkCache.fetchedAt < 60 * 60 * 1000) return jwkCache.keys;
  // P10: unguarded, and on the critical path for EVERY authenticated request —
  // a hung JWK socket stalls all auth, not one feature.
  const res = await fetchWithTimeout(JWK_URL, {}, {
    timeoutMs: PROVIDER_TIMEOUT_MS.auth,
    label: "firebase.jwk",
  });
  if (!res.ok) throw new Error("Could not fetch Firebase signing keys.");
  const data = (await res.json()) as { keys: Jwk[] };
  jwkCache = { keys: data.keys, fetchedAt: now };
  return data.keys;
}

export interface VerifiedUser {
  email: string;
  uid: string;
  /** Present when this token was minted by the assume-identity endpoint. */
  assumeIdentity?: AssumeIdentityClaims;
}

/** Parsed assume-identity session (from Firebase ID token custom claims). */
export interface AssumeIdentityClaims {
  assumeIdentity: true;
  assumeSessionId: string;
  assumeAdminUid: string;
  assumeAdminEmail: string;
  assumeReason: string;
  /** ISO timestamp — worker rejects the token after this time. */
  assumeExpiresAt: string;
}

/** Read assume_identity claims from a verified Firebase ID token payload. */
export function parseAssumeIdentityClaims(
  payload: Record<string, unknown>,
): AssumeIdentityClaims | undefined {
  if (payload.assume_identity !== true || !payload.assume_expires_at) return undefined;
  const expiresAt = new Date(String(payload.assume_expires_at)).getTime();
  if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
    throw Object.assign(
      new Error("Assume-identity session expired. Please sign in with your own credentials."),
      { status: 401, assumeIdentityExpired: true },
    );
  }
  return {
    assumeIdentity: true,
    assumeSessionId: String(payload.assume_session_id || ""),
    assumeAdminUid: String(payload.assume_admin_uid || ""),
    assumeAdminEmail: String(payload.assume_admin_email || ""),
    assumeReason: String(payload.assume_reason || ""),
    assumeExpiresAt: String(payload.assume_expires_at),
  };
}

async function verifyFirebaseToken(token: string, projectId: string): Promise<VerifiedUser> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token.");
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));

  const jwk = (await getJwks()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown token key id.");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(sigB64), data);
  if (!ok) throw new Error("Invalid token signature.");

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("Token audience mismatch.");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`)
    throw new Error("Token issuer mismatch.");
  if (typeof payload.exp !== "number" || payload.exp < now) throw new Error("Token expired.");
  if (!payload.email || payload.email_verified !== true)
    throw new Error("Email not verified.");

  const user: VerifiedUser = { email: String(payload.email).toLowerCase(), uid: String(payload.sub) };
  const assume = parseAssumeIdentityClaims(payload as Record<string, unknown>);
  if (assume) user.assumeIdentity = assume;
  return user;
}

/** True when API routes must verify Firebase ID tokens (production / Firebase SSO). */
export function firebaseAuthEnforced(env: Env): boolean {
  const projectId = (env.FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) return false;
  const flag = String(env.FIREBASE_AUTH_ENFORCED ?? "1")
    .trim()
    .toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "no";
}

export async function requireUser(request: Request, env: Env): Promise<VerifiedUser | null> {
  if (!firebaseAuthEnforced(env)) {
    // P0 SECURITY: dummy auth mode — client-claimed identity is trusted without
    // Firebase token verification. This is only acceptable for local development.
    // The boot guard in node-server.ts hard-fails if NODE_ENV=production.
    console.warn(
      "[auth] DUMMY MODE ACTIVE: FIREBASE_PROJECT_ID is not set. " +
        "Client-claimed identity is trusted without verification. " +
        "Do NOT use in production.",
    );
    return null;
  }
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw Object.assign(new Error("Sign-in required."), { status: 401 });
  const projectId = env.FIREBASE_PROJECT_ID!;
  const user = await verifyFirebaseToken(token, projectId);
  const domain = (env.ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase();
  if (domain && !user.email.endsWith(`@${domain}`)) {
    throw Object.assign(new Error(`Access limited to @${domain} accounts.`), { status: 403 });
  }
  setAssumeIdentityForRequest(user.assumeIdentity);
  return user;
}

function assertAllowedEmail(email: string, env: Env): string {
  const normalized = normalizeHistoryEmail(email);
  if (!normalized) throw Object.assign(new Error("email is required."), { status: 400 });
  const domain = (env.ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase();
  if (domain && !normalized.endsWith(`@${domain}`)) {
    throw Object.assign(new Error(`Access limited to @${domain} accounts.`), { status: 403 });
  }
  return normalized;
}

/** Firebase auth when configured; otherwise demo mode accepts email in query/body. */
export async function resolveHistoryEmail(
  request: Request,
  env: Env,
  fallbackEmail?: string,
): Promise<string> {
  const user = await requireUser(request, env);
  if (user) return user.email;
  if (firebaseAuthEnforced(env)) {
    throw Object.assign(new Error("Sign-in required."), { status: 401 });
  }
  return assertAllowedEmail(fallbackEmail || "", env);
}

/**
 * Demo-mode-only manager check. Only reachable when FIREBASE_PROJECT_ID is unset
 * (dummy auth mode). The boot guard in node-server.ts (buildEnv) hard-fails if
 * NODE_ENV=production and FIREBASE_PROJECT_ID is empty, so this code path is
 * unreachable in production. Kept for local dev convenience.
 */
function isDemoManagerEmail(email: string): boolean {
  const e = normalizeHistoryEmail(email);
  return e.startsWith("manager@") || /^ajay\.|^antony\.|^vipin\./.test(e.split("@")[0] || "");
}

/**
 * NEW-1 fix: resolve the caller's role from the DB/Firestore user profile.
 * In Firebase auth mode, the token proves *who* the caller is, not *that
 * they're a manager* — the role check must query the user profile. Uses a
 * dynamic import of resolveRequestContext to avoid a circular dependency
 * (scope.ts imports type { VerifiedUser } from auth.ts).
 *
 * Returns true if the caller is a manager or admin, false otherwise.
 * Throws with status 403 if the user profile is not found.
 */
async function isManagerOrAdmin(
  verified: { uid: string; email: string } | null,
  env: Env,
): Promise<boolean> {
  if (!verified) return false;
  try {
    const { resolveRequestContext } = await import("./data/scope");
    const ctx = await resolveRequestContext(verified, env);
    return ctx.role === "manager" || ctx.role === "admin";
  } catch {
    return false;
  }
}

/** History write target — supports manager proxy to team SE email. */
export async function resolveHistoryEmailForWrite(
  request: Request,
  env: Env,
  body: { email?: string; targetEmail?: string; proxySeActing?: boolean },
): Promise<string> {
  const callerEmail = await resolveHistoryEmail(request, env, body.email || "");
  const target = body.targetEmail ? normalizeHistoryEmail(body.targetEmail) : "";
  if (!target || target === callerEmail) return callerEmail;

  if (!body.proxySeActing) {
    throw Object.assign(new Error("Proxy history write requires proxySeActing."), { status: 403 });
  }

  const domain = (env.ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase();
  if (domain) {
    if (!target.endsWith(`@${domain}`) || !callerEmail.endsWith(`@${domain}`)) {
      throw Object.assign(new Error(`Access limited to @${domain} accounts.`), { status: 403 });
    }
  }

  if (firebaseAuthEnforced(env)) {
    // NEW-1 fix: in Firebase auth mode, verify the caller is actually a
    // manager/admin via the user profile. The old code returned target
    // with no role check — any authenticated user could proxy-write as
    // any other user.
    const verified = await requireUser(request, env);
    if (!await isManagerOrAdmin(verified, env)) {
      throw Object.assign(new Error("Only managers may write history on behalf of another SE."), {
        status: 403,
      });
    }
    return target;
  }

  if (!isDemoManagerEmail(callerEmail)) {
    throw Object.assign(new Error("Only managers may write history on behalf of another SE."), {
      status: 403,
    });
  }
  return target;
}

/** Reject cross-user proxy on post-call resolve when caller is not a manager. */
export async function assertManagerProxyOwnerEmail(
  request: Request,
  env: Env,
  ownerEmail?: string,
  callerEmailFallback?: string,
): Promise<void> {
  const normalized = ownerEmail ? normalizeHistoryEmail(ownerEmail) : "";
  if (!normalized) return;
  const callerEmail = await resolveHistoryEmail(request, env, callerEmailFallback || "");
  if (normalized === callerEmail) return;
  if (firebaseAuthEnforced(env)) {
    // NEW-1 fix: same pattern — verify the caller is a manager/admin via
    // the user profile, not just that they have a valid Firebase token.
    const verified = await requireUser(request, env);
    if (!await isManagerOrAdmin(verified, env)) {
      throw Object.assign(new Error("Only managers may act on behalf of another SE."), {
        status: 403,
      });
    }
    return;
  }
  if (!isDemoManagerEmail(callerEmail)) {
    throw Object.assign(new Error("Only managers may act on behalf of another SE."), {
      status: 403,
    });
  }
}
