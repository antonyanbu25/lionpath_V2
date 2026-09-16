# Agent council — pre-rebase (Pre-Call + Assume Identity)

| Finding | Agent | Evidence | Severity | Blocking? | Decision |
|---------|-------|----------|----------|-----------|----------|
| Orphan precall branch cannot merge/rebase onto main | Release blocker | `git merge-base` fails | HIGH | Yes | Apply precall via file checkout from `fix/precall-fixes`, not merge branch |
| AI branch stale `domain-reads.ts` vs main PG reads | Adversarial integrator | `git diff main..AI` removes `pgReadRepositoryFor` | CRITICAL | Yes | Merge AI first; never take AI domain-reads wholesale; port precall scoped GETs onto main PG file |
| Assume + precall both touch `api-store.js` / `app.js` | Integration architect | Overlap list in FILE_MAP | HIGH | No | Merge AI first, then precall; verify `dispatchAssumeIdentityExpiredIfNeeded` retained |
| Precall requires co-deploy web+worker | Pre-call advocate | Scoped routes in worker | MEDIUM | No | Document in release report |
| Assume exit reauth must survive precall nav changes | Security | ASSUME_IDENTITY_DESIGN | HIGH | No | Post-merge grep `requireReauth`, `assumeIdentityExpired` |
| 304 commits on main since AI base | Rebase reviewer | `git log AI..main` count | MEDIUM | No | Integrate via merge/cherry-pick onto current main tip |

**Strongest objection:** Stale AI `domain-reads` could revert SQL reads during merge.

**Resolution:** Integration order = `origin/main` + merge `feat/assume-identity-hardening` + manual domain-reads + precall file ports.

Proceed to integration branch creation.
