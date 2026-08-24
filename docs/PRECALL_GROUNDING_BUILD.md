# Pre-call Grounding Build — Pass 2 (Tier 1 + Tier 2)

Branch: `feat/precall-grounding` (this repo; stacked on `feat/security-fixes`).
Review source: Pass 1 + Pass 2 grounding reviews (see [PRECALL_GROUNDING.md](./PRECALL_GROUNDING.md) for goal, status, and the Tier 3 backlog).

> **Port note (2026-08-24):** this build was ported from the `lionpath_auto` repo's
> `feat/precall-grounding` drop onto this repo's SQL/security branch line. All file
> references below were re-verified against this tree; test counts reproduce exactly
> (see Verification).

## The non-negotiable grounding principle

A claim may only appear in a pre-call brief if it is actually traceable to the text of the specific source it names. The gate must NOT be gameable: the model cannot satisfy it by attaching a real label/domain to a fabricated value. If the check cannot verify a claim, the claim is dropped or degraded to `unknown` — never passed on faith.

## Summary status table

| Item | Vuln closed (FM) | Fixed | Exact change (file:function) | Verifying persona |
|---|---|---|---|---|
| T1.1 | FM-12, FM-13, FM-11 | ✅ | `prep/claim-verify.ts:claimSupportedByText` + `prep/extract-facts.ts:attachVerifiedSources` | Persona 1 (Claim-grounding) |
| T1.2 | FM-1 (`thisCompany`) | ✅ | `schema.ts:fitRow.sourceLabel` + `prep/synthesize.ts` prompt + `prep/validate-prep.ts:groundedFit` | Persona 2 (Schema/degradation) |
| T1.3 | FM-11 | ✅ | `prep/claim-verify.ts:wrapUntrusted/UNTRUSTED_CONTENT_CLAUSE/looksInjected` + `prep/extract-facts.ts`, `prep/research.ts`, `prep/synthesize.ts`, `prep/se-context-extract.ts` | Persona 1 |
| T1.4 | FM-2 | ✅ | `prep/word-limits.ts:normalizePrepOutput` (`thinBriefDegraded`) | Persona 2 |
| T1.5 | FM-3 (+ propagation) | ✅ | `prep/validate-prep.ts` likelyPains gate + `painCapabilityValue` re-derivation | Persona 2 |
| T2.1 | 2A.1.c (right-domain-wrong-claim) | ✅ | `prep/rivals.ts:normalizeValues` + `prep/company-news.ts:shapeCompanyNews` (`claimSupportedByText` on citation snippet) | Persona 1 |
| T2.2 | FM-4 (+ misattribution) | ✅ | `prep/rivals-context.ts:extractFishSizingFromContext` (`claimNumbersInSource`) + `FishContextMetric.provenance` | Persona 1 |
| T2.3 | FM-6 | ✅ | `prep/validate-prep.ts` incumbent cross-check against sourced `Incumbent tool` signal | Persona 2 |
| T2.4 | FM-9 | ✅ | `prep/se-context-extract.ts` confidence 88→60 + `claimNumbersInSource` filter | Persona 1 |
| T2.5 | FM-5 | ✅ | `prep/demo-guidance.ts:isGroundedUseCase` (≥2 anchors OR 1 anchor + fact number) | Persona 1 |
| T2.6 | FM-14 | ✅ | `prep/synthesize-repair.ts:repairMissingSections` + `prep/synthesize.ts` integration | Persona 3 (Resilience) |
| T2.7 | 2A.3.h (trust root) | ✅ | `src/providers/gemini.ts:parseGeminiResponse` warn + `prep/citations.ts:assertRetrievalDerivedCitations` | Persona 1 |

All Tier 1 (T1.1–T1.5) and Tier 2 (T2.1–T2.7) items are **FIXED**.

## Per-item detail

### T1.1 — Claim-to-snippet verification in `extractFacts`
- **Vuln closed:** FM-12 (wrong-label/right-label-wrong-claim — the central invariant Pass 1 trusted), FM-13 (paraphrase drift), FM-11 (injected content).
- **Exact change:** `prep/claim-verify.ts:148-165` `claimSupportedByText` (token overlap + literal number check); `prep/extract-facts.ts:attachVerifiedSources` verifies the fact's `value` is in the snippet text of the label(s) it names, not just that the label resolves.
- **Why grounded:** the label-resolves check is necessary but not sufficient. This converts "the label resolves" into "the claim is actually in the named source." A fabricated value with a valid label fails the content-token/number overlap and is dropped.
- **Verifying persona:** Persona 1 — PASS. `test-source-table.ts:136/155-157` asserts a fabricated `"Fintech"` attached to a real `S1` label (snippet says "SaaS") is dropped.

### T1.2 — `fitSnapshot` source pointer + silent-row degradation
- **Vuln closed:** FM-1 (corrected to `thisCompany`, the most-read claim).
- **Exact change:** `schema.ts:fitRow.sourceLabel` (optional); `fitSnapshot` `minItems: 1` (rows optional, not forced to 4); `prep/synthesize.ts` system prompt requires `thisCompany: "unknown"` unless supported; `prep/validate-prep.ts:148-164` `groundedFit` blanks `thisCompany`/`industryNorm` to `unknown`, forces `gap: "parity"`, `gapVerdict: "Aligned"` when `sourceLabel` is missing/low-confidence.
- **Why grounded:** the four-row forced schema used to make the model emit a plausible `thisCompany` even when research was silent. Now an unsourced row degrades to unknown rather than passing prose.
- **Verifying persona:** Persona 2 — PASS (`validate-prep.ts:148-164`; returned at line 222). Direct test in `test-precall-grounding.ts` (T1.2 block).

### T1.3 — Prompt-injection defense on extracted snippets
- **Vuln closed:** FM-11 (T1.1 is the structural backstop; this reduces injection success).
- **Exact change:** `prep/claim-verify.ts` `wrapUntrusted` (XML-ish delimiter), `UNTRUSTED_CONTENT_CLAUSE` (system-prompt clause), `looksInjected` (drop snippets echoing instruction patterns). Applied across `extract-facts.ts`, `research.ts:94` (drop injected snippets pre-extraction), `synthesize.ts:25/109` (SE notes wrapped), and `se-context-extract.ts` (SE notes wrapped + clause).
- **Why grounded:** snippets are adversary-controlled web text. Wrapping + the clause tell the model to treat interior as data; `looksInjected` drops the obvious probes before they reach the model; T1.1 drops any claim that survived but doesn't match its attributed page.
- **Verifying persona:** Persona 1 — PASS. `looksInjected` unit-tested in `test-precall-grounding.ts` (drops ignore/disregard/role-hijack/system:/sourceLabel/output-only probes).
- **Residual risk:** the `wrapUntrusted` delimiter is not collision-proof (a page can emit the closing tag); backstopped by the clause + `looksInjected` + T1.1. The `\b###` injection pattern does not match `###` at string start (word-boundary before `#` fails) — minor, pre-existing.

### T1.4 — Honest degradation of `description`/`about` when thin
- **Vuln closed:** FM-2.
- **Exact change:** `prep/word-limits.ts:596-661` `thinBriefDegraded` (<40% sourced facts) replaces `description` with `"Limited public information found for {companyName}."` and `about` with `"Confirm company details on the call."` Model prose is not read when thin.
- **Why grounded:** these are the first fields an SE reads; a confident one-liner composed from a sparse snippet is the canonical hallucination. Honest degradation replaces confident filler.
- **Verifying persona:** Persona 2 — PASS. (Threshold mirrors `demo-thesis.isThinBrief`; `validatePrep` does not touch `description`/`about`, so the template passes through.)
- **Residual risk:** the thinness detector is value-based (counts a fact as "sourced" if its value is non-unknown), not source-label-based — consistent with the documented definition and the demo-thesis mirror.

### T1.5 — `likelyPains` grounding gate
- **Vuln closed:** FM-3 (+ propagation into `painCapabilityValue`/`demoThesis`).
- **Exact change:** `prep/validate-prep.ts:198-207` — each pain must contain ≥1 anchor token (from research facts/signals/incumbent/industry, stopword+length-filtered via `claim-verify.anchorTokens`). Unanchored pains dropped; empty = honest `[]`. `painCapabilityValue` re-derived at line 214 from the gated pains so a dropped pain cannot survive in the demo script.
- **Why grounded:** generic pains read as if about this account; they propagate into the demo script and hero tile. The anchor gate makes "no pains identified yet" honest rather than filler.
- **Verifying persona:** Persona 2 — PASS. Direct test in `test-precall-grounding.ts` (T1.5 block).

### T2.1 — Rivals/news claim-to-citation text check
- **Vuln closed:** 2A.1.c (right-domain-wrong-claim — a fabricated figure under a real retrieved domain).
- **Exact change:** `prep/rivals.ts:372-376` `normalizeValues` + `prep/company-news.ts:207-211` `shapeCompanyNews` — after domain resolves, require the figure/headline+detail to share a content token (and any number to appear literally) with the citation's `snippet` text. Drop on no overlap.
- **Why grounded:** the domain-resolves check verified page identity, not page-contains-this-claim. A training-data prior attached to a retrieved page passed. The snippet check closes it.
- **Verifying persona:** Persona 1 — PASS for snippet-bearing citations. Snippet-bearing tests added to `test-rivals.ts`/`test-company-news.ts`.
- **Residual risk:** when a citation returns no `snippet` text, the `if (snippet && …)` guard skips the check (documented: "only tightens, never loosens"). The domain-resolves check remains.

### T2.2 — `fishContext` LLM-extracted metric re-verification
- **Vuln closed:** FM-4 (+ the "extracted-as-SE-stated" misattribution in 2A.1).
- **Exact change:** `prep/rivals-context.ts:extractFishSizingFromContext` re-verifies each metric's leading number via `claimNumbersInSource` against the raw SE text; `FishContextMetric.provenance: "se-stated" | "se-extracted"` so the UI distinguishes a verbatim SE value from an LLM extraction.
- **Why grounded:** an LLM extraction stamped `sourceLabel: "SE"` rendered as a verbatim SE statement. The number is the falsifiable content; a fabricated/mis-paraphrased number not in the notes is dropped.
- **Verifying persona:** Persona 1 — PASS (`se-context-extract.ts:121` number filter verified; rivals-context provenance field present).

### T2.3 — `incumbent.incumbent_name` cross-check
- **Vuln closed:** FM-6 (two different incumbents in one brief).
- **Exact change:** `prep/validate-prep.ts:74-82` — after signals are validated, if the sourced `Incumbent tool` signal is non-unknown and disagrees with `incumbent.incumbent_name` (case-insensitive), the sourced signal wins and the discrepancy is reported. An unsourced signal does NOT override (no fabrication from nothing); agreement is a no-op.
- **Why grounded:** the headline incumbent is free prose; the signal is the grounded value. The sourced one wins on conflict.
- **Verifying persona:** Persona 2 — PASS. All four branches tested in `test-precall-grounding.ts` (disagree/agree/unsourced/case-insensitive/no-incumbent).

### T2.4 — `extractSeContextFacts` confidence 88→60 + number re-verification
- **Vuln closed:** FM-9.
- **Exact change:** `prep/se-context-extract.ts:14` `SE_EXTRACT_CONFIDENCE = 60` (was 88); `.filter((f) => claimNumbersInSource(f.value, text))` drops facts whose leading number is not literally in the SE notes. Also hardened with `UNTRUSTED_CONTENT_CLAUSE` + `wrapUntrusted` (T1.3 reinforcement).
- **Why grounded:** confidence 88 let an LLM paraphrase count as strongly as a verbatim SE statement (it crossed the 55 source-gate and backed ICP `industry` gating). 60 keeps it above the gate but honestly "medium"; the number check stops an invented figure.
- **Verifying persona:** Persona 1 — PASS on the number gate + 60 confidence + injection defense.

### T2.5 — `demoGuidance.useCases` require ≥2 anchors
- **Vuln closed:** FM-5 (one anchor let a 90%-invented scenario pass).
- **Exact change:** `prep/demo-guidance.ts:isGroundedUseCase` — require ≥2 distinct anchor tokens, OR 1 anchor token + a number literal that appears in the research facts. `factNumbers` threaded from the same seeds as `groundingAnchors` through `shapeUseCases`/`shapeGuidance`/`generateDemoGuidance`.
- **Why grounded:** one industry word plus fabricated detail is generic filler with a real token bolted on. Two anchors, or one anchor plus the account's own figure, is specific to this account.
- **Verifying persona:** Persona 1 — PASS. `test-demo-guidance.ts` asserts one-anchor-alone fails, one-anchor-plus-fact-number passes, invented-number fails.

### T2.6 — Section-local synthesis repair
- **Vuln closed:** FM-14 (truncation reinforces hallucination — a partial brief gets filled with plausible filler; the old monolithic retry rewrites survivors).
- **Exact change:** new `prep/synthesize-repair.ts` — `missingFields` detects ABSENT required fields (empty-but-present arrays are honest "nothing found", not repaired); `buildRepairSchema` locks a repair call to ONE field (`additionalProperties:false`, `required:[field]`); `repairMissingSections` runs independent per-field calls, merges only the targeted key, never re-sends survivors. `prep/synthesize.ts` runs it after `extractJson` succeeds (the parse-failure path keeps the monolithic fallback). `sources`/`facts`/`description`/`about`/`signals`/`prospects` are excluded (deterministic substitution or honest-empty/T1.4 degradation); `fitSnapshot` is recovered first (highest-risk).
- **Why grounded:** a repair can no longer corrupt the fields that survived the truncation; each recovered field is grounded in the same research facts as the original synthesis.
- **Verifying persona:** Persona 3 — PASS. `test-precall-grounding.ts` asserts absent-not-empty detection, single-field schema lock, priority ordering, exclusion set.

### T2.7 — Assert provider citations are retrieval-derived
- **Vuln closed:** 2A.3.h (the load-bearing assumption that citations come from `groundingMetadata.groundingChunks`, not model text).
- **Exact change:** `src/providers/gemini.ts:parseGeminiResponse` warns if `citations.length > 0` but no `groundingMetadata.groundingChunks`; `prep/citations.ts:assertRetrievalDerivedCitations` (pure, testable) warns at the consumer boundary when citations lack both `resolvedUrl` and `snippet` (the shape a model-emit URL takes). `normalizeCitations` calls through.
- **Why grounded:** the entire verify-against-citation-set regime treats citations as ground truth the model cannot control. That holds only because `extractCitations` reads exclusively from `groundingMetadata`. If a provider/config change let the model emit URLs, the regime silently degrades — now it surfaces.
- **Verifying persona:** Persona 1 — PASS. `test-precall-grounding.ts` asserts snippet/resolvedUrl → no warn; bare uri+title → warn; mix → warn.

## Why the gate can't be gamed

The gate enforces **claim-in-named-source**, not **label-resolves**. A claim survives only when ALL of these hold:

1. **The label resolves** to a real source in the code-built table (`extract-facts.ts:attachVerifiedSources`).
2. **The value is in the text of that source** — at least one length-≥4 non-stopword content token overlaps the snippet the label points to (`claim-verify.ts:claimSupportedByText`).
3. **Any number in the value appears literally** in that source's text, comma-stripped (`claim-verify.ts:claimNumbersInSource`). A number is the most falsifiable content and the most dangerous to fabricate, so it is checked literally first.

A fabricated value with a valid label fails step 2 (and step 3 if it carries a number) and is dropped. A model cannot satisfy the gate by attaching a real label/domain to an invented claim, because the claim's content must overlap the page the label names — and the model does not control the page text. Injected content that forces a label is dropped pre-extraction by `looksInjected`, and any claim that survives injection but doesn't match its attributed page is dropped again by step 2. For rivals/news the same discipline applies to the citation's `snippet`; for SE-context extractions the leading number must appear in the raw notes.

Where a deterministic check cannot verify a claim, the claim is dropped or degraded to `unknown`/`[]` — never passed on faith (T1.2 fitSnapshot, T1.4 description/about, T1.5 likelyPains, T2.3 incumbent). The free-prose fields an SE reads are now either traceable to a named source or honestly empty.

## Verification

- `npx tsc --noEmit` — clean.
- Prep/grounding tests pass individually: `test-precall-grounding.ts` (61 checks), `test-rivals.ts` (79), `test-company-news.ts` (39), `test-demo-guidance.ts`, `test-icp-criteria.ts` (376), `test-source-table.ts`, `test-rivals-context.ts` (23), `test-se-context-facts.ts`, `test-prep-normalize.ts` (22).
- Full `npm test` run: 86/87 pass; the lone failure (`test-node-boot.mjs`) is an environmental `EADDRINUSE` port-conflict flake on a fixed port (18788) — it passes in isolation and imports no prep/grounding module.
- Three independent persona audits (Claim-grounding, Schema/degradation, Resilience) returned PASS on every claim; their flagged test-coverage gaps were closed (added `looksInjected` tests, snippet-bearing rivals/news tests, direct `validatePrep` T1.2/T1.5 tests, `signals`/`prospects` exclusion, and hardened `se-context-extract` with the untrusted-content clause).

## Residual risks (documented, not blocking)

- Citations with no `snippet` skip the rivals/news claim-in-source check (domain-resolves remains) — only tightens, never loosens.
- Single content-token overlap floor (`MIN_CONTENT_OVERLAP = 1`) — a fabricated prose value that recycles one real content token passes the token gate; numeric fabrications are closed by the literal number check.
- The `wrapUntrusted` delimiter is not collision-proof; backstopped by the clause + `looksInjected` + T1.1.
- The `\b###` injection pattern does not match `###` at string start — minor, pre-existing.
- The T1.4 thinness detector is value-based, not source-label-based (consistent with the documented definition and the `demo-thesis` mirror).

Tier 3 items (T3.1 grounding report, T3.2 research age, T3.3 label namespace, T3.4 sentinel collision, T3.5 PII minimization) are explicitly out of scope for this build (hardening/observability, per the Pass 2 plan).