# Analysis — Pre-call brief scroll STILL broken after FIX D (branch 2.1)

Date: 2026-08-08 (late) | Branch: 2.1 | Repo: /root/lionpath_V2 | Author: Gideon

## User report (recurring, escalated)
On the generated pre-call brief, the content below "How big is this fish?" (Know your Customer tab)
and the whole Demo Prep tab are clipped / stuck — the region will not scroll. Two prior fixes shipped
today (99ea7f7 "bounded flex chain", 80024c1 "reset scroll on reveal") did NOT fix it. The user wants
the pre-call result to scroll like the post-call analysis page (which scrolls with the document).

## What was tried and why it failed
FIX D attempted to make `.prep-tab-panel-wrap` (overflow-y:auto) the scroll region by setting a
bounded flex chain: `#view-precall` / `#prep-result-view` / `#prep-tabs` / `fw-tab-panel` all got
`flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column`.

This fails because the chain passes through the **Crayons shadow DOM**, whose `.tabs` container
never gets a definite height.

## ROOT CAUSE (authoritative — verified against Crayons 4.3.0-dew source)
The pre-call result uses `fw-tabs` + `fw-tab-panel`, both `shadow:true` components:

1. `fw-tabs.tsx` renders:
   ```
   <div class="tabs">
     <div class="tabs__items__nav">…<slot name="tab"/></div>
     <slot/>            <!-- the fw-tab-panel elements are slotted here -->
   </div>
   ```
2. `tabs.scss`:
   ```
   .tabs { display:flex; flex-direction:column;
           height: var(--fw-tabs-height, 'inherit'); }
   ```
   `--fw-tabs-height` is NEVER set in the app, so `.tabs` uses `height: inherit`.
3. `inherit` copies the COMPUTED `height` of the parent host `#prep-tabs`, which is `auto`
   (flex item; `flex:1 1 auto` gives it a *used* height but its *computed* `height` property is `auto`).
   => `.tabs` resolves to `height: auto` → **unbounded**, grows with content.
4. `.prep-tab-panel-wrap` (`overflow-y:auto`) sits inside the slotted `fw-tab-panel` host inside that
   unbounded `.tabs`. Because every ancestor's height is auto, `.prep-tab-panel-wrap` never becomes
   shorter than its content → no internal scrollbar.
5. Meanwhile `#prep-result-view { overflow:hidden }` (and the `:has` chain forcing `100vh; overflow:hidden`
   on `.app-shell` / `.main-content`) clips the overflowing content. Result: content exists but is
   unreachable — exactly the "stuck below 'How big is this fish?'" symptom.

The `min-height:0; overflow:hidden; flex:1` on hosts did not help because the *shadow* `.tabs` container
(which is between the host and the slotted panels) has `height:auto`, so none of the min-height:0
constraints downstream get a bounded containing block.

## THE FIX (two viable approaches — GLM to decide)

### Approach 1 — Force the shadow `.tabs` container to a definite height (surgical, keeps tabbed layout)
Give `#prep-tabs` a *computed* definite `height` so the inherited `height:auto` in `.tabs` resolves
to a real value:

```css
#prep-tabs {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;            /* ADD — computed value becomes 100%, so .tabs height:inherit resolves */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```
`#prep-tabs`'s containing block for percentage is `#prep-result-view`, which is `flex:1` in the
`:has` chain and has a definite resolved height. With `height:100%`, the shadow `.tabs` inherits a
definite height, its flex children (`fw-tab-panel`, which already has `flex:1; min-height:0;
overflow:hidden`) shrink, and `.prep-tab-panel-wrap { overflow-y:auto }` finally scrolls.

Also confirm `#prep-tabs fw-tab-panel` keeps `flex:1; min-height:0; overflow:hidden; display:flex;
flex-direction:column` (already present in precall.css:1097-1103) and `.prep-tab-panel-wrap` keeps
`flex:1; min-height:0; overflow-y:auto; overflow-x:hidden` (precall.css:1105-1111).

### Approach 2 — Let the pre-call result scroll with the document like post-call (user's literal request)
The post-call result is a plain `fw-card` (#postcall-result, index.html:643) inside `.prep-form-wrap`
(overflow:auto) — no `100vh` lockdown, no nested custom-element scroll container. To truly mirror it:
- Remove the `.app-shell:has(#prep-result-view…) { height:100vh; overflow:hidden }` and
  `.main-content:has(#prep-result-view…) { overflow:hidden }` lockdowns (styles.css:2097-2122).
- Let `#prep-result-view` grow naturally; keep the tab bar in normal flow.
- Downside: tab bar scrolls away; needs `position:sticky` on `#prep-tabs` if stickiness matters.
- This is a bigger structural change and changes the current tabbed-internal-scroll UX.

## Recommendation
Approach 1 is surgical, low-risk, matches the existing tabbed design, and is a one-line-ish CSS fix
plus verification. Approach 2 matches the user's literal phrasing ("replicate post-call scroll") but is
a larger refactor. Recommend Approach 1 first (add `height:100%` to `#prep-tabs`), verify the inner
`.prep-tab-panel-wrap` scrolls; if GLM judges the shadow-height fix too fragile, fall back to Approach 2.

## Verification checklist
1. `cd /root/lionpath_V2 && npm run build` — must pass.
2. Grep: `grep -n "#prep-tabs" web/precall.css` — confirm `height:100%` present.
3. Manual: generate a long brief (taller than viewport), reveal, scroll the Know your Customer tab
   down past "How big is this fish?" and scroll the Demo Prep tab — both must scroll, scrollbar visible.
4. Resize browser small — still scrolls, no clip.
