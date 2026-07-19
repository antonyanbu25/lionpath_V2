# Firebase Google SSO setup

Enable real login for SE Singha Paathai. When `firebaseConfig.projectId` is empty the portal stays in **dummy auth** mode (`se@freshworks.com` / `se123`).

## 1. Firebase Console

1. Open [Firebase Console](https://console.firebase.google.com/) and create a project (or select an existing one).
2. **Build → Authentication → Sign-in method → Google** — Enable.
3. **Authentication → Settings → Authorized domains** — Add:
   - `localhost` (local dev, port 8788)
   - Your production web host (e.g. `lionpath.benjaminsquare.com`)
4. **Build → Firestore Database** — Create database (production mode; rules deployed from this repo).
5. **Project settings → Your apps → Web** — Register app and copy:
   - `apiKey`, `authDomain`, `projectId`, `appId`

Optional: In Google Cloud Console, restrict the OAuth consent screen to your `@freshworks.com` workspace. The app also enforces `@freshworks.com` in code.

## 2. Local config (gitignored)

```bash
cp web/firebase-config.local.example.js web/firebase-config.local.js
# Edit web/firebase-config.local.js — paste Firebase web config

cp worker/.dev.vars.example worker/.dev.vars
# Set FIREBASE_PROJECT_ID to the same project id
```

Restart dev servers after changing config:

```bash
cd worker && npm run dev    # port 8787
cd web && npm run dev       # port 8788
```

## 3. Deploy Firestore rules and indexes

```bash
cp .firebaserc.example .firebaserc
# Edit .firebaserc — set your Firebase project id

firebase login
firebase deploy --only firestore:rules,firestore:indexes
```

Or from repo root:

```bash
npm run firebase:deploy
```

## 4. Bootstrap teams and roles

Firestore rules allow only **admin** to create/update `teams/*`. Bootstrap once with the Admin SDK:

```bash
# Service account JSON from Firebase Console → Project settings → Service accounts
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Create default demo team
node worker/scripts/seed-firestore-users.mjs --bootstrap-team

# Assign roles (users must exist in Firebase Auth — sign in once with Google first)
node worker/scripts/seed-firestore-users.mjs --csv worker/scripts/seed-users.example.csv
```

CSV columns: `email,role,teamId,displayName` (displayName optional).

Roles: `se`, `manager`, `admin`.

## 5. Verify

| Check | Expected |
|-------|----------|
| Login page | Email/password hidden; **Sign in with Google** visible |
| `@freshworks.com` Google account | App loads; `users/{uid}` in Firestore |
| Other domains | Rejected |
| Prep / post-call / history | Worker accepts `Authorization: Bearer` token |
| Manager (role set in Firestore) | Manager dashboard shows team SEs |

## 6. Production (VPS)

Set in `deploy/vps/.env`:

```
FIREBASE_PROJECT_ID=your-project-id
```

Deploy web with `web/firebase-config.local.js` merged at build time, or inline config in `web/firebase-config.js` for production Pages deploy.

## Dummy mode (local dev without Firebase)

Leave `web/firebase-config.local.js` absent or with empty `projectId`. Dummy logins and localStorage domain store continue to work.
