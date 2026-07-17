// Cloudflare Worker entry. Routes:
//   POST /api/generate-prep   — pre-call research brief
//   POST /api/analyze-call    — post-call summary + next steps + quality coach
//   GET  /api/zoom/status     — whether Zoom OAuth is configured
//   GET  /api/zoom/auth       — start Zoom OAuth (phase 2)

import { generatePrep, resolveProspectEmails, type Env as PrepEnv, type PrepInput } from "./prep";
import { analyzePostCall, type PostCallInput } from "./postcall";
import { zoomAuthUrl, zoomConfigured, type ZoomEnv } from "./zoom";
import { fetchTranscriptFromShareLink } from "./zoomShare";
import {
  historyStorageAvailable,
  historyStorageKind,
  loadHistory,
  normalizeHistoryEmail,
  replaceHistory,
  saveHistoryEntry,
  type HistoryEntry,
  type HistoryEnv,
} from "./history";
import {
  deleteTask,
  loadTasks,
  patchTask,
  saveTasks,
  tasksStorageAvailable,
  upsertTask,
  type Task,
} from "./tasks";
import { appendFeedback, feedbackStorageAvailable, loadGlobalFeedback, loadFeedback, normalizeFeedbackCategory, type FeedbackEntry } from "./feedback";

interface Env extends PrepEnv, ZoomEnv, HistoryEnv {
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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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

async function requireUser(request: Request, env: Env): Promise<VerifiedUser | null> {
  if (!env.FIREBASE_PROJECT_ID) return null;
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw Object.assign(new Error("Sign-in required."), { status: 401 });
  const user = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
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
async function resolveHistoryEmail(
  request: Request,
  env: Env,
  fallbackEmail?: string,
): Promise<string> {
  const user = await requireUser(request, env);
  if (user) return user.email;
  if (env.FIREBASE_PROJECT_ID) {
    throw Object.assign(new Error("Sign-in required."), { status: 401 });
  }
  return assertAllowedEmail(fallbackEmail || "", env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, allowed);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/api/zoom/status") {
        return json({ configured: zoomConfigured(env) }, 200, cors);
      }

      if (request.method === "GET" && path === "/api/config") {
        return json(
          {
            prep: { provider: env.LLM_PROVIDER || "gemini", model: env.MODEL || "gemini-3.5-flash" },
            postcall: {
              provider: env.POSTCALL_LLM_PROVIDER || env.LLM_PROVIDER || "gemini",
              model: env.POSTCALL_MODEL || "gemini-3.5-flash",
            },
            zoom: { configured: zoomConfigured(env) },
            keys: {
              anthropic: !!env.ANTHROPIC_API_KEY,
              gemini: !!env.GEMINI_API_KEY || !!(env.GOOGLE_CLOUD_PROJECT || env.VERTEX_PROJECT),
              zoominfo: !!env.ZOOMINFO_API_KEY,
            },
            history: {
              available: historyStorageAvailable(env),
              storage: historyStorageKind(env),
            },
            tasks: {
              available: tasksStorageAvailable(env),
              storage: historyStorageKind(env),
            },
            feedback: {
              available: feedbackStorageAvailable(env),
              storage: historyStorageKind(env),
            },
          },
          200,
          cors,
        );
      }

      if (request.method === "GET" && path === "/api/zoom/auth") {
        await requireUser(request, env);
        const state = crypto.randomUUID();
        const authUrl = zoomAuthUrl(env, state);
        return json({ authUrl, state }, 200, cors);
      }

      if (request.method === "GET" && path === "/api/history") {
        if (!historyStorageAvailable(env)) {
          return json({ error: "History storage is not configured." }, 503, cors);
        }
        const email = await resolveHistoryEmail(request, env, url.searchParams.get("email") || "");
        const entries = await loadHistory(env, email);
        return json({ email, entries }, 200, cors);
      }

      if (request.method === "POST" && path === "/api/generate-prep") {
        await requireUser(request, env);
        const input = (await request.json()) as Partial<PrepInput>;
        if (!input.companyName) {
          return json({ error: "companyName is required." }, 400, cors);
        }
        const emails = resolveProspectEmails(input as PrepInput);
        if (!emails.length && !input.prospectEmail?.trim()) {
          return json({ error: "At least one valid prospect email is required." }, 400, cors);
        }
        const prep = await generatePrep(env, {
          ...(input as PrepInput),
          prospectEmail: emails[0] || String(input.prospectEmail).trim(),
          prospectEmails: emails.length ? emails : undefined,
        });
        return json({ prep }, 200, cors);
      }

      if (request.method === "POST" && path === "/api/fetch-transcript") {
        await requireUser(request, env);
        const body = (await request.json()) as { recordingUrl?: string; recordingPassword?: string };
        if (!body.recordingUrl?.trim()) {
          return json({ error: "recordingUrl is required." }, 400, cors);
        }
        const result = await fetchTranscriptFromShareLink(
          body.recordingUrl.trim(),
          body.recordingPassword?.trim(),
        );
        return json(result, 200, cors);
      }

      if (request.method === "POST" && path === "/api/analyze-call") {
        await requireUser(request, env);
        const input = (await request.json()) as Partial<PostCallInput>;
        if (!input.transcript?.trim() && !input.recordingUrl?.trim()) {
          return json({ error: "Paste a transcript or a Zoom recording link (with passcode if needed)." }, 400, cors);
        }
        const result = await analyzePostCall(env, input as PostCallInput);
        return json(result, 200, cors);
      }

      if (request.method === "GET" && path === "/api/tasks") {
        if (!tasksStorageAvailable(env)) {
          return json({ error: "Task storage is not configured." }, 503, cors);
        }
        const email = await resolveHistoryEmail(request, env, url.searchParams.get("email") || "");
        const tasks = await loadTasks(env, email);
        return json({ email, tasks }, 200, cors);
      }

      const taskPatchMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
      if (request.method === "PATCH" && taskPatchMatch) {
        if (!tasksStorageAvailable(env)) {
          return json({ error: "Task storage is not configured." }, 503, cors);
        }
        const body = (await request.json()) as Partial<Task> & { email?: string };
        const email = await resolveHistoryEmail(request, env, body.email || "");
        const task = await patchTask(env, email, taskPatchMatch[1], body);
        if (!task) return json({ error: "Task not found." }, 404, cors);
        return json({ email, task }, 200, cors);
      }

      if (request.method === "DELETE" && taskPatchMatch) {
        if (!tasksStorageAvailable(env)) {
          return json({ error: "Task storage is not configured." }, 503, cors);
        }
        const body = (await request.json().catch(() => ({}))) as { email?: string };
        const email = await resolveHistoryEmail(
          request,
          env,
          body.email || url.searchParams.get("email") || "",
        );
        const ok = await deleteTask(env, email, taskPatchMatch[1]);
        if (!ok) return json({ error: "Task not found." }, 404, cors);
        return json({ email, deleted: taskPatchMatch[1] }, 200, cors);
      }

      if (request.method === "POST" && path === "/api/tasks") {
        if (!tasksStorageAvailable(env)) {
          return json({ error: "Task storage is not configured." }, 503, cors);
        }
        const body = (await request.json()) as {
          email?: string;
          task?: Task;
          tasks?: Task[];
        };
        const email = await resolveHistoryEmail(request, env, body.email || "");

        if (Array.isArray(body.tasks)) {
          const tasks = await saveTasks(env, email, body.tasks);
          return json({ email, tasks, count: tasks.length }, 200, cors);
        }

        if (!body.task?.id || !body.task.title) {
          return json({ error: "task with id and title is required." }, 400, cors);
        }
        const tasks = await upsertTask(env, email, body.task);
        return json({ email, task: body.task, count: tasks.length }, 200, cors);
      }

      if (request.method === "GET" && path === "/api/feedback") {
        if (!feedbackStorageAvailable(env)) {
          return json({ error: "Feedback storage is not configured." }, 503, cors);
        }
        const global = url.searchParams.get("global") === "1";
        if (global) {
          const entries = await loadGlobalFeedback(env);
          return json({ entries, count: entries.length }, 200, cors);
        }
        const email = await resolveHistoryEmail(request, env, url.searchParams.get("email") || "");
        const entries = await loadFeedback(env, email);
        return json({ email, entries, count: entries.length }, 200, cors);
      }

      if (request.method === "POST" && path === "/api/feedback") {
        if (!feedbackStorageAvailable(env)) {
          return json({ error: "Feedback storage is not configured." }, 503, cors);
        }
        const body = (await request.json()) as {
          email?: string;
          entry?: Partial<FeedbackEntry> & { body?: string };
          message?: string;
          body?: string;
          category?: string;
          id?: string;
          page?: string;
          createdAt?: number;
        };
        const email = await resolveHistoryEmail(request, env, body.email || body.entry?.email || "");
        const nested = body.entry || {};
        const message = String(
          nested.message || nested.body || body.message || body.body || "",
        ).trim();
        if (!message) {
          return json({ error: "entry.message is required." }, 400, cors);
        }
        const entry: FeedbackEntry = {
          id: nested.id || body.id || crypto.randomUUID(),
          category: normalizeFeedbackCategory(String(nested.category || body.category || "Idea")),
          message: message.slice(0, 4000),
          page: nested.page || body.page,
          email,
          createdAt: nested.createdAt || body.createdAt || Date.now(),
        };
        const entries = await appendFeedback(env, email, entry);
        console.info(
          `[feedback] ${entry.category} from ${email}: ${entry.message.slice(0, 80)}${entry.message.length > 80 ? "…" : ""}`,
        );
        return json({ email, entry, count: entries.length }, 200, cors);
      }

      if (request.method === "POST" && path === "/api/history") {
        if (!historyStorageAvailable(env)) {
          return json({ error: "History storage is not configured." }, 503, cors);
        }
        const body = (await request.json()) as {
          email?: string;
          entry?: HistoryEntry;
          entries?: HistoryEntry[];
        };
        const email = await resolveHistoryEmail(request, env, body.email || "");

        if (Array.isArray(body.entries)) {
          const entries = await replaceHistory(env, email, body.entries);
          return json({ email, entries, count: entries.length }, 200, cors);
        }

        if (!body.entry?.id || typeof body.entry.timestamp !== "number") {
          return json({ error: "entry with id and timestamp is required." }, 400, cors);
        }
        const entries = await saveHistoryEntry(env, email, body.entry);
        return json({ email, entry: body.entry, count: entries.length }, 200, cors);
      }

      return json({ error: "Not found." }, 404, cors);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      const status =
        (err as { status?: number }).status ??
        (/sign-in|token|audience|issuer|expired|verified/i.test(message) ? 401 : 500);
      return json({ error: message }, status, cors);
    }
  },
};
