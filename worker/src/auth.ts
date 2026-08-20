import { normalizeHistoryEmail } from "./history";
import type { Env } from "./env";

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
  const res = await fetch(JWK_URL);
  if (!res.ok) throw new Error("Could not fetch Firebase signing keys.");
  const data = (await res.json()) as { keys: Jwk[] };
  jwkCache = { keys: data.keys, fetchedAt: now };
  return data.keys;
}

export interface VerifiedUser {
  email: string;
  uid: string;
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

  return { email: String(payload.email).toLowerCase(), uid: String(payload.sub) };
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
    return target;
  }

  if (!isDemoManagerEmail(callerEmail)) {
    throw Object.assign(new Error("Only managers may write history on behalf of another SE."), {
      status: 403,
    });
  }
  return target;
}

/** Reject cross-user proxy on post-call resolve when caller is not a manager (demo mode). */
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
  if (firebaseAuthEnforced(env)) return;
  if (!isDemoManagerEmail(callerEmail)) {
    throw Object.assign(new Error("Only managers may act on behalf of another SE."), {
      status: 403,
    });
  }
}
