# Release 2.1-org-hierarchy (portal build 2.1.29)

**GitHub branch:** `2.1-org-hierarchy`  
**Portal / worker build stamps:** `2.1.29` (internal cache-bust only — not the branch name)  
**Tag (optional):** `v2.1-org-hierarchy`

## Summary

This release unifies pre-call and post-call CRM writes, adds Freshworks org hierarchy with segment-scoped RBAC, and fixes contact deduplication when the same person appears with different emails across prep and post-call.

## Highlights

| Area | Change |
|------|--------|
| **CRM parity** | Shared `resolveEngagementEntities` in `web/domain/engagement-entities.js` for prep + post-call |
| **Contact dedupe** | Confirm-gate names parsed; dot-normalized name matching; alternate emails on merge |
| **Org hierarchy** | Director → segment leaders → team managers → ICs; org structure editor; proxy SE |
| **Pre-call** | Dual-write fixes, fish sizing context, CRM domain resolution |
| **Rules / RBAC** | Firestore rules for org structure, account team, cross-team proxy |

## Verify

```bash
cd web && npm test
node web/scripts/test-prep-postcall-crm-parity.mjs
node web/scripts/test-precall-dual-write-e2e.mjs
curl -s http://localhost:8787/api/config | jq '{workerBuild}'
curl -s http://localhost:8788/ | rg 'portal-build'
```

Expect both builds to report **`2.1.29`**.

## Docs

- [PRECALL_POSTCALL_CRM_PARITY.md](./PRECALL_POSTCALL_CRM_PARITY.md)
- [PRECALL_FIX_REPORT.md](./PRECALL_FIX_REPORT.md)
- [ACCOUNT_DEAL_CONTACT_FIX_REPORT.md](./ACCOUNT_DEAL_CONTACT_FIX_REPORT.md)
- [README.md](../README.md)

## Deploy note

Production VPS currently tracks **`origin/2.1`**. Publish with `git push -u origin 2.1-org-hierarchy`, review, then merge into `2.1`.
