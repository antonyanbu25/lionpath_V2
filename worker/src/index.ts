// Cloudflare Worker entry. Routes POST /api/generate-prep, applies CORS, and (when a
// Firebase project id is configured) verifies the caller's Firebase ID token and email
// domain before calling Claude. The ANTHROPIC_API_KEY never leaves the Worker.

import { generatePrep, type Env as PrepEnv, type PrepInput } from "./prep";

interface Env extends PrepEnv {
  ALLOWED_ORIGINS?: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
}

function corsHeaders(origin: string, allowed: string[]): Record<string, string> {
  const allow = allowed.includes("*")
    ? "*"
    : allowed.includes(origin)
      ? origin
      : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// ---- Firebase ID token verification (RS256 via Google JWK) ----

interface Jwk { kid: string; n: string; e: string; kty: string; alg?: string }
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

interface VerifiedUser { email: string; uid: string }

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, allowed);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/api/generate-prep") {
      return json({ error: "Not found." }, 404, cors);
    }

    try {
      // Auth — enforced only once a Firebase project id is configured.
      let user: VerifiedUser | null = null;
      if (env.FIREBASE_PROJECT_ID) {
        const auth = request.headers.get("Authorization") || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return json({ error: "Sign-in required." }, 401, cors);
        user = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
        const domain = (env.ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase();
        if (domain && !user.email.endsWith(`@${domain}`)) {
          return json({ error: `Access limited to @${domain} accounts.` }, 403, cors);
        }
      }

      const input = (await request.json()) as Partial<PrepInput>;
      if (!input.companyName || !input.prospectEmail) {
        return json({ error: "companyName and prospectEmail are required." }, 400, cors);
      }

      const prep = await generatePrep(env, input as PrepInput);
      return json({ prep, user }, 200, cors);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      const status = /sign-in|token|audience|issuer|expired|verified/i.test(message) ? 401 : 500;
      return json({ error: message }, status, cors);
    }
  },
};
