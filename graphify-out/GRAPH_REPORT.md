# Graph Report - /Users/ssunil/Documents/init/Se Prep Portal/V2/singapaathai  (2026-07-16)

## Corpus Check
- Corpus is ~46,789 words - fits in a single context window. You may not need a graph.

## Summary
- 625 nodes · 1358 edges · 30 communities (24 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.74)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Frontend App Shell & Pre-call UI
- Dashboard & Manager Rollup
- VPS Deploy & Security Docs
- Domain Validation & Gemini Schema
- History Storage Backend
- Post-call Frontend Client
- Post-call Normalization
- Demo Links & Prep Helpers
- Post-call Analysis Worker
- Zoom Share Link Parsing
- Worker Package Config
- Quality Coach Render
- Worker TypeScript Config
- History Sync Frontend
- Mac Tunnel Start Script
- Zoom Debug Script 1
- Web package.json
- Zoom Debug Script 2
- Zoom Debug Script 3
- Theme UI
- Dev Server Config
- Post-call Render Tests
- Zoom Debug Script 4
- Zoom Debug Script 5
- Dev Node Script
- Test Models Script
- History API Test
- A/B Test Script
- VPS Setup Script
- VPS Start Script

## God Nodes (most connected - your core abstractions)
1. `How Lionpath Code Works` - 18 edges
2. `boot()` - 17 edges
3. `show()` - 16 edges
4. `fetch()` - 16 edges
5. `showApp()` - 15 edges
6. `fetchTranscriptFromShareLink()` - 15 edges
7. `renderPrep()` - 14 edges
8. `renderManagerDashboard()` - 14 edges
9. `listPostCallAnalyses()` - 13 edges
10. `renderPostCall()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `renderPrep()` --indirect_call--> `u()`  [INFERRED]
  web/app.js → worker/zoom-app.js
- `initFirebase()` --indirect_call--> `e()`  [INFERRED]
  web/app.js → worker/zoom-app.js
- `actionTextsSimilar()` --indirect_call--> `w()`  [INFERRED]
  web/postcall.js → worker/zoom-app.js
- `web nginx Docker service` --conceptually_related_to--> `Portal shell (web/index.html)`  [INFERRED]
  deploy/vps/docker-compose.yml → web/index.html
- `Quality Coach radar chart UI` --conceptually_related_to--> `Quality Coach six dimensions`  [INFERRED]
  web/qc-preview.html → docs/POST_CALL_OVERVIEW.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Pre-call prep data pipeline** — docs_code_logic_web_app_js, v2_singapaathai_readme_api_generate_prep, docs_code_logic_worker_src_index_ts, docs_code_logic_worker_src_prep_ts, docs_code_logic_worker_src_schema_ts, docs_code_logic_worker_src_word_limits_ts, v2_singapaathai_readme_gemini [EXTRACTED 1.00]
- **Post-call analysis data pipeline** — docs_code_logic_web_postcall_js, v2_singapaathai_readme_api_analyze_call, docs_code_logic_worker_src_zoomshare_ts, docs_code_logic_worker_src_postcall_ts, docs_code_logic_worker_src_quality_score_ts, v2_singapaathai_readme_quality_coach [EXTRACTED 1.00]
- **VPS production deployment stack** — docs_vps_deploy, deploy_vps_docker_compose, deploy_vps_docker_compose_caddy_service, deploy_vps_docker_compose_web_service, deploy_vps_docker_compose_worker_service, docs_vps_deploy_lionpath_urls [EXTRACTED 1.00]

## Communities (30 total, 6 thin omitted)

### Community 0 - "Frontend App Shell & Pre-call UI"
Cohesion: 0.06
Nodes (83): boot(), clearSidebarHistory(), closeSidebar(), dash(), dashboardOpts(), decisionDot(), DISPLACEMENT_LABELS, displayPrep() (+75 more)

### Community 1 - "Dashboard & Manager Rollup"
Cohesion: 0.06
Nodes (68): displayNameForEmail(), listTeamSeEmails(), callIdentityKey(), dedupeAnalysesByCallIdentity(), aggregateQualityMetrics(), barClass(), buildCoachingNudge(), buildDashboardMetrics() (+60 more)

### Community 2 - "VPS Deploy & Security Docs"
Cohesion: 0.07
Nodes (59): VPS Docker Compose stack, Caddy HTTPS reverse proxy, web nginx Docker service, worker Docker service, VPS Security Guide, GEMINI_API_KEY secret, Post-call history file storage, How Lionpath Code Works (+51 more)

### Community 3 - "Domain Validation & Gemini Schema"
Cohesion: 0.07
Nodes (41): isLikelyInvalidDomain(), levenshtein(), normalizeSlug(), suggestDomain(), TYPO_MARKERS, WELL_KNOWN_DOMAINS, GEMINI_RESPONSE_SCHEMA_KEYS, isPlainObject() (+33 more)

### Community 4 - "History Storage Backend"
Cohesion: 0.10
Nodes (35): createFileHistoryBackend(), HistoryBackend, HistoryEntry, HistoryEnv, historyKey(), historyKvAvailable(), historyStorageAvailable(), historyStorageKind() (+27 more)

### Community 5 - "Post-call Frontend Client"
Cohesion: 0.11
Nodes (44): savePostCallHistory, actionTextsSimilar(), analyzeCall(), animateScoreGauge(), authHeaders(), barClass(), boot(), CATEGORY_LABELS (+36 more)

### Community 6 - "Post-call Normalization"
Cohesion: 0.17
Nodes (29): actionTextsSimilar(), asAttendeeArray(), coalescePostCallAttendees(), dedupeNextSteps(), FIT_LABELS, followUpTexts(), GAP_VERDICT_DEFAULTS, inferSeOwner() (+21 more)

### Community 7 - "Demo Links & Prep Helpers"
Cohesion: 0.13
Nodes (21): containsKeyword(), CORE_KEYS, DEMO_LINKS, gatherPrepText(), isMidMarketPlus(), parseAgentCount(), pickDemoLinks(), checks (+13 more)

### Community 8 - "Post-call Analysis Worker"
Cohesion: 0.12
Nodes (23): ALLOWED_EFFORT, Env, parseAnalysis(), PostCallInput, POSTCALL_SCHEMA, PostCallAnalysis, PostCallResult, TranscriptMeta (+15 more)

### Community 9 - "Zoom Share Link Parsing"
Cohesion: 0.15
Nodes (16): extractField(), fetchTranscriptFromShareLink(), getPlayInfo(), getShareInfo(), isChapterOnlyVtt(), needsPassword(), ParsedShareUrl, parseRecordingPaste() (+8 more)

### Community 10 - "Worker Package Config"
Cohesion: 0.09
Nodes (22): @cloudflare/workers-types, tsx, @types/node, typescript, dependencies, tsx, devDependencies, @cloudflare/workers-types (+14 more)

### Community 11 - "Quality Coach Render"
Cohesion: 0.19
Nodes (19): barClass(), checks, esc(), failed, html, normalizeDimensionKey(), out, RADAR_DIMENSION_LABELS (+11 more)

### Community 12 - "Worker TypeScript Config"
Cohesion: 0.12
Nodes (16): @cloudflare/workers-types, ES2022, node, src/**/*.ts, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib (+8 more)

### Community 13 - "History Sync Frontend"
Cohesion: 0.43
Nodes (13): fetchHistoryFromWorker(), historyHeaders(), legacyStorageKey(), mergeHistoryLists(), migrateLegacyKey(), normalizeUserEmail(), pushRemoteEntries(), pushRemoteEntry() (+5 more)

### Community 14 - "Mac Tunnel Start Script"
Cohesion: 0.52
Nodes (4): start-all.sh script, start_background(), start_tmux(), stop_services()

### Community 15 - "Zoom Debug Script 1"
Cohesion: 0.33
Nodes (6): get(), headers, links, merge(), playUrl, transcriptMentions

### Community 16 - "Web package.json"
Cohesion: 0.33
Nodes (5): name, private, scripts, dev, type

### Community 17 - "Zoom Debug Script 2"
Cohesion: 0.40
Nodes (5): get(), headers, merge(), pi, playUrl

### Community 18 - "Zoom Debug Script 3"
Cohesion: 0.40
Nodes (5): get(), headers, merge(), pi, playUrl

### Community 19 - "Theme UI"
Cohesion: 0.80
Nodes (4): applyTheme(), initTheme(), preferredTheme(), toggleTheme()

### Community 20 - "Dev Server Config"
Cohesion: 0.50
Nodes (3): MIME, PORT, ROOT

### Community 21 - "Post-call Render Tests"
Cohesion: 0.67
Nodes (3): assertOrder(), cases, indexOf()

### Community 24 - "Dev Node Script"
Cohesion: 0.50
Nodes (3): child, devVarsPath, ROOT

### Community 25 - "Test Models Script"
Cohesion: 0.50
Nodes (3): m, models, vars

## Ambiguous Edges - Review These
- `lion.benjaminsquare.com tunnel` → `Team Share Pack (HTML)`  [AMBIGUOUS]
  docs/MAC_TUNNEL_SETUP.md · relation: conceptually_related_to

## Knowledge Gaps
- **128 isolated node(s):** `ab-test.sh script`, `setup.sh script`, `start.sh script`, `VIEW_TITLES`, `WELL_KNOWN_DOMAINS` (+123 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `lion.benjaminsquare.com tunnel` and `Team Share Pack (HTML)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `w()` connect `Demo Links & Prep Helpers` to `Domain Validation & Gemini Schema`, `Post-call Frontend Client`, `Post-call Normalization`?**
  _High betweenness centrality (0.232) - this node is a cross-community bridge._
- **Why does `actionTextsSimilar()` connect `Post-call Frontend Client` to `Demo Links & Prep Helpers`?**
  _High betweenness centrality (0.155) - this node is a cross-community bridge._
- **Why does `isLikelyInvalidDomain()` connect `Domain Validation & Gemini Schema` to `Demo Links & Prep Helpers`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `boot()` (e.g. with `generate()` and `updateDomainHint()`) actually correct?**
  _`boot()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ab-test.sh script`, `setup.sh script`, `start.sh script` to the rest of the system?**
  _128 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend App Shell & Pre-call UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05942571785268414 - nodes in this community are weakly interconnected._