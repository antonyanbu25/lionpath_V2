# Web config

## `nb-account-allowlist.json`

Accounts on this list are treated as **new business** pursuits when no manual override or session context applies (hybrid routing with **International - NB** and **North America - NB** team actors).

```json
{
  "accountIds": ["acc_..."],
  "slugs": ["acme-corp-acme-com"]
}
```

- **accountIds**: internal `acc_*` ids  
- **slugs**: account slug (case-insensitive match)

Populate with your ~21 NB IC accounts. Leave arrays empty until data is ready.

See [docs/adr/003-account-deal-engagement.md](../docs/adr/003-account-deal-engagement.md) for full routing order.
