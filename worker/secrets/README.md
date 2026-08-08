# Local Firebase Admin credentials (gitignored)

Drop your Firebase service account JSON here to enable worker Firestore admin on localhost
(`/api/accounts`, dashboard read-models, etc.).

1. Firebase Console → **se-singha-paathi** → Project settings → Service accounts
2. **Generate new private key** → save as e.g. `se-singha-paathi-adminsdk.json` in this folder
3. Restart: `npm run stop:dev && npm run dev:all`

`dev-node.mjs` auto-sets `GOOGLE_APPLICATION_CREDENTIALS` when exactly one `.json` file is present.

Browser CRM (prep/post-call dual-write) works with Google SSO alone; this file is for **worker** API reads.
