# Firebase Google SSO — SE Singha Paathai

Enable real Google login for `@freshworks.com` accounts on the portal.

## Prerequisites

- Firebase project **`se-singha-paathi`** with Firestore enabled
- Authentication → Sign-in method → **Google** enabled
- Authorized domains: `portal.benjaminsquare.com` and **`localhost`** (for local testing)
- Worker API env: `FIREBASE_PROJECT_ID=se-singha-paathi`

## 1. Web app — local Firebase config

Copy the example and fill values from Firebase Console → Project settings → Your apps → Web app:

```bash
cp web/firebase-config.local.example.js web/firebase-config.local.js
```

Edit `web/firebase-config.local.js`:

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "se-singha-paathi.firebaseapp.com",
  projectId: "se-singha-paathi",
  appId: "...",
};
```

This file is **gitignored**. Copy it to the VPS `web/` folder when deploying (not in git).

When `projectId` is set, the app shows **Sign in with Google** only (dummy email/password hidden).

## 2. Worker env (local)

Copy and edit `worker/.dev.vars`:

```
GEMINI_API_KEY=...
FIREBASE_PROJECT_ID=se-singha-paathi
ALLOWED_ORIGINS=http://localhost:8788,http://127.0.0.1:8788
ALLOWED_EMAIL_DOMAIN=freshworks.com
```

When `FIREBASE_PROJECT_ID` is set, API routes require a Firebase **Bearer** token (no demo email in query).

## 3. Worker env (VPS production)

In `deploy/vps/.env`:

```
FIREBASE_PROJECT_ID=se-singha-paathi
ALLOWED_ORIGINS=https://portal.benjaminsquare.com
ALLOWED_EMAIL_DOMAIN=freshworks.com
GEMINI_API_KEY=...
```

Recreate worker after editing:

```bash
cd deploy/vps && docker compose up -d --force-recreate worker
```

## 4. API URL (automatic)

| Web host | Worker API |
|----------|------------|
| `portal.benjaminsquare.com` | `https://portalapi.benjaminsquare.com` |
| `localhost:8788` | `http://localhost:8787` |

Configured in [`web/firebase-config.js`](../web/firebase-config.js) — no manual override needed for portal production.

## 5. Deploy Firestore rules (one-time)

From repo root:

```bash
cp .firebaserc.example .firebaserc
firebase login
firebase deploy --only firestore:rules
```

Rules include `preps`, `postcalls`, and `users/{uid}` (user profile bootstrap on first login).

## 6. Local test

**Terminal 1 — worker:**

```bash
cd worker && npm run dev:node
```

**Terminal 2 — web:**

```bash
cd web && npx wrangler pages dev . --port 8788
```

Open http://localhost:8788 → Sign in with Google using a `@freshworks.com` account.

**Verify:**

1. App loads after sign-in
2. DevTools → Network → `/api/config` returns 200 (with Bearer token on authenticated calls)
3. Firebase Console → Firestore → `users/{uid}` document created
4. Prep / post-call flows work without CORS errors

**Regression:** Remove or rename `firebase-config.local.js` → dummy login (`se@freshworks.com` / `se123`) still works.

## 7. VPS deploy checklist

```bash
cd /opt/se-singha-paathai
git checkout -- deploy/vps/start.sh deploy/vps/setup.sh 2>/dev/null
git pull origin main
# Create web/firebase-config.local.js on server (same as local)
cd deploy/vps
# Ensure .env has FIREBASE_PROJECT_ID and ALLOWED_ORIGINS
docker compose up -d --force-recreate web worker caddy
```

Hard-refresh https://portal.benjaminsquare.com (incognito recommended).

## Roles

After Google sign-in, role is inferred from email prefix:

- `manager@*` → manager dashboard
- All other `@freshworks.com` → SE

Optional future: seed roles via Firestore `users` documents.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Cannot reach API server" banner | Check CORS: `ALLOWED_ORIGINS` must match web origin exactly |
| Google popup blocked | Add `localhost` to Firebase authorized domains |
| 401 on API calls | Set `FIREBASE_PROJECT_ID` on worker; sign in again |
| Still shows dummy login | `firebase-config.local.js` missing or empty `projectId` |
| Old splash/theme | Pull latest + recreate `web` container + hard refresh |
