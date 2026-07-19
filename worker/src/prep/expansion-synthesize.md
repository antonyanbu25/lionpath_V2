# Expansion prep synthesize template (placeholder — Phase 4)
#
# When prepType=expansion is enabled, this template will:
# - Merge Bikal account data + Salesforce read-only fields
# - Use expansion-specific discovery hooks
# - Reference Account.metadata.sfAccountId and bikalAccountId
#
# Not wired in v2 Phase 1 — POST with prepType=expansion returns 501.
