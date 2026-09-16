# Janus — Firestore removal: full gap list

**Purpose:** every method the browser store exposes, mapped to the Firestore
collection it touches, the Postgres table it must move to, and the screen(s)
that call it. This is the plan to approve before any code changes.

**Decisions taken (this round):** keep Firebase Auth, remove Firestore only ·
build tables for all 13 homeless collections · accept losing Firestore-only
data (D6 clean slate) · module by module with a coverage report and tests.

## Headline

| | |
|---|---|
| Browser store methods | **144** (55 writes, 89 reads) |
| Already wired to Postgres | **14** |
| Map to an existing Postgres table | 83 |
| **Need a NEW table built** | **39** |
| Helper / no collection detected | 18 |

So the work is not 144 methods. It is **39 methods needing new tables**,
plus **71 that have a table and need a read/write path**.

## Module order (your priority, largest screens first)

| # | Module | Screens | Methods |
|---|---|---|---|
| 1 | Pre-call | precall, lifecycle-view | pre_call, deal, account, contact |
| 2 | Post-call | postcall, call-view (15), calls-list-view (4) | post_call + analysis/detail |
| 3 | Scoring | score-disputes (4) | scorecard, themes, lines, overrides |
| 4 | User/usage | dashboard (5), app | app_user, org_unit, adoption views |
| 5 | Deal/account | deal-view (14), search-service (3) | deal, account, contact, deal_contact |
| 6 | New tables | call-view, deal-view | the 13 homeless collections |

## The 13 new tables to build

| Collection | Firestore rows | Methods | Screens |
|---|---|---|---|
| `videoFacts` | 0 | 3 | — |
| `timelineSegments` | 0 | 4 | — |
| `timelineMarkers` | 0 | 3 | — |
| `followUps` | 3 | 3 | — |
| `momDrafts` | 1 | 3 | — |
| `dealSignals` | 0 | 5 | dashboard deal-view |
| `arrLines` | 0 | 5 | deal-view |
| `arrOverrides` | 0 | 2 | — |
| `technicalCommits` | 0 | 4 | call-view dashboard deal-view postcall |
| `whatWorks` | 0 | 4 | call-view deal-view |
| `events` | 0 | 0 | — |
| `accountSummaries` | 0 | 2 | — |
| `dealSummaries` | 0 | 2 | deal-view |

Eleven have **zero rows**. They still need tables because the code calls them —
a missing table is a crash, not a blank screen.

## Every method

R = read · W = write. "wired" = already has a Postgres path via trySqlDomainWrite.

| Method | R/W | Firestore | Postgres target | Status | Screens |
|---|---|---|---|---|---|
| `createAccount` | W | — | — | wired | — |
| `updateAccount` | W | — | — | wired | — |
| `createContact` | W | contacts | contact | wired | — |
| `updateContact` | W | contacts | contact | wired | — |
| `createDealContact` | W | dealContacts | deal_contact | wired | — |
| `setPrimaryDealContact` | W | dealContacts | deal_contact | wired | — |
| `removeDealContact` | W | dealContacts | deal_contact | wired | — |
| `createDeal` | W | deals | deal | wired | — |
| `updateDeal` | W | deals | deal | wired | — |
| `createPrepBrief` | W | prepBriefs | pre_call | wired | — |
| `upsertPostCallWithSummary` | W | postCalls,callSummaries | post_call,post_call.analysis | wired | — |
| `addLifecycleEvent` | W | lifecycles | deal | wired | — |
| `upsertScorecard` | W | scorecards | scorecard | wired | — |
| `upsertScorecardLine` | W | scorecardLines | scorecard_theme+scorecard_line | wired | — |
| `findAccountBySlug` | R | accounts | account | — | postcall-contact-resolve |
| `findAccountsByDomain` | R | accounts | account | — | postcall-contact-resolve |
| `listAccounts` | R | accounts | account | — | calls-list-view postcall-resolve-context |
| `upsertUser` | W | users | app_user | — | — |
| `getUserByEmail` | R | users | app_user | — | dashboard |
| `listUsersByManagerId` | R | users | app_user | — | dashboard |
| `listUsersByOrg` | R | users | app_user | — | dashboard score-disputes |
| `findContactByAccountEmail` | R | contacts | contact | — | — |
| `findContactsByEmail` | R | contacts | contact | — | postcall-contact-resolve |
| `listContactsByAccount` | R | contacts | contact | — | call-view search-service |
| `getContactsByIds` | R | contacts | contact | — | — |
| `addContactEvent` | W | contacts | contact | — | — |
| `listContactEvents` | R | contacts | contact | — | — |
| `listActiveLifecyclesForAccount` | R | lifecycles | deal | — | — |
| `listLifecyclesByOrg` | R | lifecycles | deal | — | — |
| `findActiveLifecycle` | R | lifecycles | deal | — | — |
| `findActiveLifecycleByDeal` | R | lifecycles | deal | — | — |
| `findLifecycleByDealAndOwner` | R | lifecycles | deal | — | — |
| `findActiveDeal` | R | deals | deal | — | — |
| `listDealsByAccount` | R | deals | deal | — | postcall-contact-resolve |
| `listDealsByOwner` | R | deals | deal | — | — |
| `createLifecycle` | W | lifecycles | deal | — | — |
| `updateLifecycle` | W | lifecycles | deal | — | — |
| `listLifecyclesByOwner` | R | lifecycles | deal | — | postcall-resolve-context search-service |
| `listLifecyclesByTeam` | R | lifecycles | deal | — | — |
| `listLifecycleEvents` | R | lifecycles | deal | — | — |
| `findDealContact` | R | dealContacts | deal_contact | — | — |
| `listDealContactLinks` | R | dealContacts | deal_contact | — | — |
| `listDealsByContact` | R | dealContacts | deal_contact | — | — |
| `upsertMeddpiccDelta` | W | meddpiccDeltas | deal.*_value | — | — |
| `deleteMeddpiccDelta` | W | meddpiccDeltas | deal.*_value | — | — |
| `listMeddpiccDeltasByCall` | R | meddpiccDeltas | deal.*_value | — | call-view deal-view |
| `upsertTcDelta` | W | tcDeltas | deal.tc_* | — | — |
| `deleteTcDelta` | W | tcDeltas | deal.tc_* | — | — |
| `listTcDeltasByCall` | R | tcDeltas | deal.tc_* | — | call-view deal-view |
| `listTcDeltasByDeal` | R | tcDeltas | deal.tc_* | — | — |
| `findPostCallByIdentity` | R | postCalls | post_call | — | — |
| `upsertPostCall` | W | postCalls | post_call | — | — |
| `getPostCall` | R | postCalls | post_call | — | call-view |
| `getCall` | R | postCalls | post_call | — | call-view |
| `listPostCallsByLifecycle` | R | postCalls | post_call | — | — |
| `listPostCallsByTeam` | R | postCalls | post_call | — | — |
| `listPostCallsByOrg` | R | postCalls | post_call | — | — |
| `listPostCallsByOwner` | R | postCalls | post_call | — | — |
| `listPostCallsByDeal` | R | postCalls | post_call | — | — |
| `listPostCallsByAccount` | R | postCalls | post_call | — | — |
| `upsertCallSummary` | W | callSummaries | post_call.analysis | — | — |
| `listCallSummariesByOwner` | R | callSummaries | post_call.analysis | — | — |
| `listCallSummariesByTeam` | R | callSummaries | post_call.analysis | — | — |
| `listCallSummariesByOrg` | R | callSummaries | post_call.analysis | — | — |
| `listCallSummariesByDeal` | R | callSummaries | post_call.analysis | — | deal-view |
| `listCallSummariesByAccount` | R | callSummaries | post_call.analysis | — | — |
| `upsertObjection` | W | objections | post_call.detail | — | — |
| `deleteObjection` | W | objections | post_call.detail | — | — |
| `listObjectionsByCall` | R | objections | post_call.detail | — | — |
| `listPrepBriefsByLifecycle` | R | prepBriefs | pre_call | — | postcall-resolve-context |
| `upsertProductGap` | W | productGaps | product_signal | — | — |
| `listProductGapsByPostCall` | R | productGaps | product_signal | — | call-view |
| `listProductGapsByOrg` | R | productGaps | product_signal | — | — |
| `listProductGapsByDeal` | R | productGaps | product_signal | — | deal-view |
| `deleteScorecard` | W | scorecards | scorecard | — | — |
| `listScorecardsByCall` | R | scorecards | scorecard | — | call-view |
| `listScorecardLinesByCall` | R | scorecardLines | scorecard_theme+scorecard_line | — | call-view |
| `deleteScorecardLinesByScorecardId` | W | scorecardLines | scorecard_theme+scorecard_line | — | — |
| `listScorecardLinesByTeamTheme` | R | scorecardLines | scorecard_theme+scorecard_line | — | — |
| `upsertGapCluster` | W | gapClusters | signal_cluster | — | — |
| `listGapClustersByOrg` | R | gapClusters | signal_cluster | — | — |
| `getGapCluster` | R | gapClusters | signal_cluster | — | call-view |
| `createTask` | W | tasks | task | — | — |
| `updateTask` | W | tasks | task | — | — |
| `listTasksByLifecycle` | R | tasks | task | — | — |
| `upsertVideoFacts` | W | videoFacts | NEW | — | — |
| `deleteVideoFacts` | W | videoFacts | NEW | — | — |
| `listVideoFactsByCall` | R | videoFacts | NEW | — | — |
| `upsertTimelineSegment` | W | timelineSegments | NEW | — | — |
| `deleteTimelineSegmentsByVideoFactsId` | W | timelineSegments | NEW | — | — |
| `listTimelineSegmentsByCall` | R | timelineSegments | NEW | — | — |
| `upsertTimelineMarker` | W | timelineMarkers | NEW | — | — |
| `listTimelineMarkersByCall` | R | timelineMarkers | NEW | — | — |
| `deleteTranscriptTimelineByCall` | W | timelineSegments,timelineMarkers | NEW | — | — |
| `upsertFollowUp` | W | followUps | NEW | — | — |
| `deleteFollowUp` | W | followUps | NEW | — | — |
| `listFollowUpsByCall` | R | followUps | NEW | — | — |
| `upsertMomDraft` | W | momDrafts | NEW | — | — |
| `deleteMomDraft` | W | momDrafts | NEW | — | — |
| `listMomDraftsByCall` | R | momDrafts | NEW | — | — |
| `upsertDealSignal` | W | dealSignals | NEW | — | — |
| `deleteDealSignal` | W | dealSignals | NEW | — | — |
| `listDealSignalsByCall` | R | dealSignals | NEW | — | — |
| `listDealSignalsByDeal` | R | dealSignals | NEW | — | dashboard deal-view |
| `listDealSignalsForDeals` | R | dealSignals | NEW | — | deal-view |
| `upsertArrLine` | W | arrLines | NEW | — | — |
| `deleteArrLine` | W | arrLines | NEW | — | — |
| `listArrLinesByCall` | R | arrLines | NEW | — | — |
| `listArrLinesByDeal` | R | arrLines | NEW | — | deal-view |
| `listArrLinesForDeals` | R | arrLines | NEW | — | deal-view |
| `upsertArrOverride` | W | arrOverrides | NEW | — | — |
| `listArrOverridesByDeal` | R | arrOverrides | NEW | — | — |
| `upsertTechnicalCommit` | W | technicalCommits | NEW | — | — |
| `getTechnicalCommitByDeal` | R | technicalCommits | NEW | — | call-view dashboard deal-view postcall |
| `getTechnicalCommitByAccount` | R | technicalCommits | NEW | — | call-view |
| `upsertDealSummary` | W | dealSummaries | NEW | — | — |
| `getDealSummaryByDeal` | R | dealSummaries | NEW | — | deal-view |
| `upsertAccountSummary` | W | accountSummaries | NEW | — | — |
| `getAccountSummaryByAccount` | R | accountSummaries | NEW | — | — |
| `upsertWhatWorks` | W | whatWorks | NEW | — | — |
| `listWhatWorksByPostCall` | R | whatWorks | NEW | — | call-view |
| `listWhatWorksByOrg` | R | whatWorks | NEW | — | — |
| `listWhatWorksByDeal` | R | whatWorks | NEW | — | deal-view |
| `listTechnicalCommitsByOrg` | R | technicalCommits | NEW | — | deal-view |
| `getUser` | R | — | — | — | postcall-contact-resolve |
| `getTeam` | R | — | — | — | score-disputes |
| `upsertTeam` | W | — | — | — | — |
| `getOrg` | R | — | — | — | score-disputes |
| `upsertOrg` | W | — | — | — | — |
| `listTeamsByOrg` | R | — | — | — | score-disputes |
| `findAccountsByName` | R | — | — | — | postcall-contact-resolve |
| `createAccount` | W | — | — | wired | — |
| `updateAccount` | W | — | — | wired | — |
| `getAccount` | R | — | — | — | call-view calls-list-view deal-view lifecycle-view postcall-contact-resolve postcall-resolve-context |
| `listContactsByDeal` | R | — | — | — | call-view |
| `getDeal` | R | — | — | — | call-view calls-list-view deal-view |
| `getLifecycle` | R | — | — | — | app |
| `listTasksForLifecycles` | R | — | — | — | search-service |
| `listScorecardsForCalls` | R | — | — | — | — |
| `listScorecardLinesForCalls` | R | — | — | — | — |
| `getReadModel` | R | — | — | — | — |
| `getReadModels` | R | — | — | — | calls-list-view |
