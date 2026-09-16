/** AUTO-GENERATED — do not edit. Run: node worker/scripts/generate-rubric-profiles.mjs */

export const GENERATED_QIP_PROFILES = [
  {
    "key": "demo",
    "motion": "new_business",
    "name": "Demo",
    "version": "2.1",
    "totalCredits": 34,
    "provisional": false,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Account, industry and role referenced specifically",
          "Something from public signal used (funding, launch, hire, news)",
          "Current stack or incumbent known before being asked",
          "Named person on the call addressed with context, not generically",
          "Prep showed in first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 3,
        "category": "discovery_qualification",
        "subParameters": [
          "Open-ended questions used, not just yes/no confirms",
          "Questions got sharper as the call went on, not flatter",
          "At least one question uncovered something not in the brief",
          "Follows up meaningfully with clarifying questions",
          "Silence was allowed; the SE didn't fill every pause"
        ]
      },
      {
        "key": "cde_build",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "Environment carried the customer's language — ticket types, categories, product names",
          "Data volume and shape resembled theirs, not the default sandbox",
          "At least one workflow shown was one they had described",
          "Integrations or channels visible matched their stack",
          "Nothing on screen contradicted what was said in discovery"
        ]
      },
      {
        "key": "solutioning",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Each capability tied to a specific pain the customer named",
          "Tell-show-tell — framed before, demonstrated, tied back after",
          "Features not relevant to their use case were skipped, not paraded",
          "Trade-offs acknowledged where fit was imperfect",
          "At least one moment landed as 'that solves X for us,' not narration"
        ]
      },
      {
        "key": "ai",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "AI shown solving a customer problem — Freddy Self-Service and Freddy Co-Pilot both demonstrated",
          "Mechanics explained honestly — where it draws from, what it can't do",
          "ROI or time saved was concrete, not 'faster'",
          "Data, privacy or model questions pre-empted, not dodged",
          "Integrated into the flow, not bolted on as a separate act"
        ]
      },
      {
        "key": "slide_deck",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "The deck was tailored — logo, industry, name of the account somewhere",
          "Slides advanced the argument, not filler between demos",
          "Time on slides proportionate — not more than 15 minutes cumulative",
          "Complex visuals were walked, not read",
          "Deck ended on something memorable, not 'thank you'"
        ]
      },
      {
        "key": "value",
        "credit": 3,
        "category": "business_value",
        "subParameters": [
          "Value quantified — hours, headcount, tickets, revenue — not adjectival",
          "Numbers were the customer's or clearly benchmarked, not invented",
          "At least one metric tied to the champion's KPI, not just company-wide",
          "Time-to-value addressed, not just eventual value",
          "Value language used at least three times across the call, not once"
        ]
      },
      {
        "key": "case_study",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Reference was industry-adjacent or size-adjacent to the customer",
          "A specific number was cited, not 'significant improvement'",
          "Story had a named company with a slide, or an honest NDA placeholder",
          "Parallel to customer's situation drawn explicitly",
          "Told at moment of relevance, with good storytelling"
        ]
      },
      {
        "key": "objections",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "The hard question was heard, not deflected or reframed",
          "The answer engaged the specific concern, not a nearby easier one",
          "Limitations named where they existed, not glossed",
          "Roadmap used only where genuine, not as a shield",
          "Pushback landed somewhere — acknowledged, parked with a date, or resolved"
        ]
      },
      {
        "key": "comp_pitch",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "The specific competitor in the deal was addressed, not 'the market'",
          "Differentiation was concrete, not adjective-based",
          "At least one point framed from customer outcome, not feature comparison",
          "Their tool treated with respect, not mocked",
          "A trap or landmine planted for the next competitive conversation"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Call opened with agenda and check on time",
          "Transitions between sections signposted, not abrupt",
          "Time managed — no rushed last ten minutes",
          "Detours bounded — parked or resolved, not sprawled",
          "Call ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Customer talked at least a third of the time",
          "Their name and words used back to them across the call",
          "Multiple stakeholders in the room addressed, not just the loudest",
          "Reactions read — pace or depth adjusted mid-flight",
          "At least one moment of genuine back-and-forth, not monologue-and-nod"
        ]
      },
      {
        "key": "storytelling",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "A narrative frame was set at the top, not a feature list",
          "Personas named and specific, not 'a user'",
          "Customer's industry and vocabulary carried through the story",
          "The thread was sustained past the opening",
          "Landed on business outcome, not workflow"
        ]
      },
      {
        "key": "summarise",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Key points recapped, not just next steps",
          "What the customer said was reflected back, not only what the SE showed",
          "Value restated in the customer's language",
          "Open questions surfaced, not buried",
          "Summary brief — under two minutes, not a second demo"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "A specific next step was proposed, not 'let's stay in touch'",
          "It had an owner and a date, not just a verb",
          "Advanced the deal — POC, stakeholder intro, security review",
          "Customer confirmed verbally or in meeting",
          "Captured in writing before the call ended or immediately after"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just the opening",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "discovery",
    "motion": "new_business",
    "name": "Discovery",
    "version": "2.1",
    "totalCredits": 32,
    "provisional": false,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 3,
        "category": "discovery_qualification",
        "subParameters": [
          "Account, industry and role referenced specifically",
          "Something from public signal used (funding, launch, hire, news)",
          "Current stack or incumbent hypothesized before being asked",
          "Named person on call addressed with context, not generically",
          "Prep showed in first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 3,
        "category": "discovery_qualification",
        "subParameters": [
          "Open-ended questions used, not just yes/no confirms",
          "Questions got sharper as call went on, not flatter",
          "At least one question uncovered something not in the brief",
          "Follows up meaningfully with clarifying questions",
          "Silence was allowed; SE didn't fill every pause"
        ]
      },
      {
        "key": "pain_qualification",
        "credit": 3,
        "category": "discovery_qualification",
        "subParameters": [
          "Pain was quantified — cost, time, headcount, tickets, revenue at risk",
          "The consequence of not solving it was drawn out, not just the symptom",
          "The customer's own words for the pain were captured, not paraphrased into product-speak",
          "Multiple angles of the pain were probed — where does it hurt, who, how often",
          "Pain was tied to something they already care about (KPI, initiative)"
        ]
      },
      {
        "key": "incumbent_competition",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "The current tool was named specifically, not 'a legacy system'",
          "What they like about it was uncovered, not just complaints",
          "Who else is being evaluated was surfaced honestly",
          "Buying process and timeline was mapped, not assumed",
          "Switching cost and inertia was acknowledged, not dismissed"
        ]
      },
      {
        "key": "stakeholder_mapping",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "The champion vs decision-maker vs blocker distinction was drawn",
          "Names of people not on the call were captured",
          "The buying committee's motivations were probed, not assumed",
          "Risks — who could kill this deal — were identified",
          "A path to reach absent stakeholders was agreed"
        ]
      },
      {
        "key": "solutioning",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "Where a capability naturally fit, it was gestured at, not paraded",
          "Nothing was over-promised — 'let me confirm and come back' over 'sure we can'",
          "The pattern-match to their world was made explicit ('this sounds like X we solve for...')",
          "Tangents into product weren't allowed to derail discovery",
          "What was mentioned in passing was noted for the follow-up demo"
        ]
      },
      {
        "key": "ai",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "AI was mentioned in context of a pain they described, not as a headliner",
          "It was framed as a capability to explore, not sold",
          "Their existing AI stack or attitude was probed",
          "Data or trust concerns were welcomed, not deflected",
          "It didn't dominate airtime relative to core pain"
        ]
      },
      {
        "key": "value",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Value framed as hypothesis to test, not proof to accept",
          "Their metrics were the anchor, not generic ROI stats",
          "Time-to-value set up as an eventual conversation, not answered",
          "Success criteria for a POC or trial were seeded",
          "Value language tied to the champion's KPI at least once"
        ]
      },
      {
        "key": "case_study",
        "credit": 1,
        "category": "business_value",
        "subParameters": [
          "If used, the reference was industry-adjacent or size-adjacent",
          "Used to draw them out ('does that sound familiar?'), not to close",
          "Didn't crowd out their story",
          "A named company or an honest NDA placeholder",
          "Brief — under two minutes"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Concerns were welcomed and probed, not batted away",
          "Answers acknowledged what was true about the objection first",
          "Limitations were named where they existed, not glossed",
          "Nothing was resolved with roadmap that shouldn't have been",
          "Pushback landed somewhere — acknowledged, parked, or resolved"
        ]
      },
      {
        "key": "comp_pitch",
        "credit": 1,
        "category": "credibility_objections",
        "subParameters": [
          "If it came up, the specific competitor was named",
          "Differentiation was concrete, not adjectival",
          "Their existing tool was treated with respect",
          "It was defensive, not aggressive",
          "It didn't derail into a competitive teardown"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with agenda and check on time",
          "Transitions signposted",
          "Time managed — no rushed last ten minutes",
          "Detours bounded",
          "Ended when it said it would, or renegotiated explicitly"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "The customer talked at least two-thirds of the time",
          "Their name and words used back to them",
          "Multiple stakeholders in the room were addressed",
          "Reactions read and pace adjusted",
          "At least one moment of genuine back-and-forth"
        ]
      },
      {
        "key": "summarise",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Their pain was recapped in their words, not the SE's",
          "What was learned about stakeholders and process was noted",
          "Value hypotheses were named as hypotheses to test",
          "Open questions and unknowns were surfaced honestly",
          "Under two minutes, and they nodded"
        ]
      },
      {
        "key": "cta",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "A specific next step was proposed (demo scheduled, stakeholder intro, data ask)",
          "Owner and date, not just a verb",
          "It advanced the deal",
          "Customer confirmed verbally",
          "Captured in writing"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just the opening",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "technical_deep_dive",
    "motion": "new_business",
    "name": "Technical deep dive",
    "version": "2.1",
    "totalCredits": 32,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Customer's tech stack researched — languages, cloud, key vendors",
          "Existing integrations and data flows understood before the call",
          "Named engineers or architects on the call addressed with context",
          "Recent technical announcements from customer surfaced (blog, GitHub, conference)",
          "Prep showed in first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Technical questions probed depth, not just surface",
          "Non-functional requirements surfaced (scale, latency, availability, compliance)",
          "Edge cases and failure modes explored, not just happy paths",
          "Follow-ups asked when answers were incomplete",
          "Silence allowed while they thought — SE didn't rush to fill it"
        ]
      },
      {
        "key": "solutioning",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Each capability tied to a specific technical requirement they named",
          "Trade-offs were named — what the design chose over what",
          "Extension points and customization were shown, not just default paths",
          "Multi-tenant, isolation, and permissions handled with specifics",
          "At least one moment landed as 'that matches how we work,' not narration"
        ]
      },
      {
        "key": "cde_build",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Environment reflected their scale — data volumes, user counts, integration surface",
          "APIs, webhooks, or custom code visible in the demo, not just UI",
          "Real data shapes present (not Lorem Ipsum), matching their domain",
          "Configuration state matched what a customer of their maturity would run",
          "Nothing on screen contradicted architectural claims"
        ]
      },
      {
        "key": "technical_accuracy",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Statements about how features work were correct and specific",
          "Numbers cited (rate limits, throughput, SLAs, uptime) were accurate, not ballpark",
          "Where the SE didn't know, they said so and committed to confirm",
          "Product terminology matched documentation, not colloquial approximations",
          "No positioning claims (integrations, capabilities) that would fail on inspection"
        ]
      },
      {
        "key": "architecture_fitment",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Their actual stack was diagrammed or referenced, not a generic architecture",
          "Data flows in and out of Freshworks were mapped, not implied",
          "Integration mechanisms (APIs, webhooks, native connectors) matched their existing tools",
          "Non-functional requirements (scale, latency, uptime) addressed with specifics",
          "Deployment model (hosting, region, isolation) aligned with their compliance needs"
        ]
      },
      {
        "key": "ai",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "Model architecture, training data, and inference path were explained honestly",
          "Data residency and privacy handling addressed with specifics",
          "Fine-tuning, RAG, and BYOM options positioned accurately",
          "Failure modes and hallucination handling explained, not deflected",
          "Integration points for their AI stack surfaced (MCP, APIs, model choice)"
        ]
      },
      {
        "key": "value",
        "credit": 1,
        "category": "business_value",
        "subParameters": [
          "Technical benefits were tied to business outcomes at least once",
          "Total cost of ownership addressed, not just license cost",
          "Operational overhead (maintenance, upgrades) named honestly",
          "Time-to-implementation was realistic, not aspirational",
          "Value language present but not dominant — audience was technical"
        ]
      },
      {
        "key": "objections",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Hard technical questions engaged head-on, not deflected",
          "Limitations named where they existed, with specifics",
          "Roadmap used only where committed, with realistic timelines",
          "Alternative approaches or workarounds offered when direct path was blocked",
          "Pushback landed — acknowledged, engineered around, or parked with an owner"
        ]
      },
      {
        "key": "comp_pitch",
        "credit": 1,
        "category": "credibility_objections",
        "subParameters": [
          "If competitors came up, technical differentiation was specific, not marketing-speak",
          "Where they matched, honesty was preferred to hedging",
          "Their tool was treated with technical respect",
          "Comparisons focused on capability, not vendor politics",
          "SE didn't derail into a competitive teardown"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with agenda and check on time",
          "Transitions between topics signposted",
          "Deep dives bounded so all planned topics got covered",
          "Time managed for questions — not everything crammed into last five minutes",
          "Ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Engineers on the call were addressed by name and role",
          "Silence from quieter engineers was invited, not steamrolled",
          "Reactions read — technical concerns pursued when they surfaced",
          "Multiple stakeholders' concerns balanced, not just the loudest voice",
          "At least one moment of genuine technical back-and-forth"
        ]
      },
      {
        "key": "summarise",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Technical decisions and open questions recapped clearly",
          "Commitments to confirm named with owners and dates",
          "Architectural choices from the discussion reflected back",
          "Concerns raised by the customer surfaced in the summary",
          "Under two minutes, and technical audience nodded"
        ]
      },
      {
        "key": "cta",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Specific next step proposed — POC scope, architecture review, security questionnaire",
          "Owner and date named on both sides",
          "Technical artifacts to share (docs, sandbox access) committed with timelines",
          "Confirmed by the customer, not just proposed",
          "Captured in writing with technical specificity"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just the opening",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "reverse_demo",
    "motion": "new_business",
    "name": "Reverse demo",
    "version": "2.1",
    "totalCredits": 28,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "observation_note_capture",
        "credit": 3,
        "category": "discovery_qualification",
        "subParameters": [
          "Points of struggle noted in real time, not reconstructed",
          "Positive discoveries captured too — what excited them",
          "Questions they asked during the exercise logged",
          "Non-verbal signals (frustration, hesitation) noted",
          "Notes shared or referenced in the summary, not held privately"
        ]
      },
      {
        "key": "task_design",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Tasks were realistic — drawn from workflows they actually run",
          "Difficulty appropriate — not too easy, not too advanced",
          "Ordering built from simple to complex, not random",
          "Each task had a clear success criterion — they knew when it was done",
          "Total time was achievable in the session, not rushed at the end"
        ]
      },
      {
        "key": "setup_framing",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "Purpose of the exercise was framed clearly at the start",
          "Ground rules stated — they'd drive, SE would observe, questions welcome",
          "Environment and permissions checked before starting, not mid-task",
          "What 'success' looks like for the session was named",
          "Time expectations set — how long, what happens at the end"
        ]
      },
      {
        "key": "value",
        "credit": 1,
        "category": "business_value",
        "subParameters": [
          "Value framing bookended the session, not squeezed mid-flow",
          "Their words about pain or ease were reflected back when relevant",
          "Value language present but sparse — this is not a value pitch",
          "Business outcomes referenced when a task validated one",
          "No hard ROI selling during hands-on time"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Concerns about the tool during hands-on welcomed, not defended against",
          "Genuine friction acknowledged, not spun",
          "Limitations named where the customer bumped into them",
          "Workarounds offered where honest, not as cover for gaps",
          "Pushback captured for follow-up, not batted away"
        ]
      },
      {
        "key": "coaching_without_taking_over",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Guidance was verbal and open-ended — 'what would you try next?', not 'click there'",
          "Silence was allowed when they were thinking, not filled",
          "Corrections happened after attempts, not before",
          "Praise was specific, not generic ('good job')",
          "When they got stuck, SE offered a hint before revealing the answer"
        ]
      },
      {
        "key": "handover_discipline",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Customer had control of screen and mouse from the start",
          "SE didn't grab back control when a task stalled",
          "When SE demonstrated, it was declared and time-boxed, not sneaked",
          "Multiple customer users got hands-on if present, not just one",
          "SE stayed off camera focus when unnecessary — no talking over their thinking"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with framing and time check",
          "Task transitions signposted",
          "Time per task managed — struggling tasks bounded, not sprawled",
          "Reserved time for reflection and Q&A at the end",
          "Ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Multiple customer users had hands-on time, not just one dominant user",
          "Their reactions during tasks were read and acknowledged",
          "SE checked in between tasks — 'how did that feel?'",
          "Silences during their thinking were respected, not filled",
          "Energy in the room stayed engaged — no glazed eyes"
        ]
      },
      {
        "key": "summarise",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "What they struggled with was named clearly, not glossed",
          "What excited them was named clearly, not just wins",
          "Their words used back in the recap",
          "Open questions and things to test next were captured",
          "Under three minutes, and they added or corrected"
        ]
      },
      {
        "key": "cta",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Next step tied to what surfaced in the exercise, not generic",
          "Owner and date named",
          "Documentation or config help committed with a timeline",
          "Customer confirmed the plan verbally",
          "Captured in writing"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on for the framing and debrief portions",
          "Camera state supported observation, not disrupted the customer's flow",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees on camera during framing and debrief"
        ]
      }
    ]
  },
  {
    "key": "use_case_discussion",
    "motion": "new_business",
    "name": "Use case discussion",
    "version": "2.1",
    "totalCredits": 31,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Prior use cases the customer flagged were remembered, not asked again",
          "Their industry-specific workflows understood before the call",
          "Public signal about the account referenced where relevant",
          "Named people addressed with role context",
          "Prep showed in first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 3,
        "category": "discovery_qualification",
        "subParameters": [
          "Questions probed how the use case is done today, not just what they want",
          "Edge cases and exceptions surfaced, not just the happy path",
          "Metrics for the use case explored — volume, frequency, criticality",
          "Who owns the use case and who depends on it was uncovered",
          "Silence allowed when they were thinking through the workflow"
        ]
      },
      {
        "key": "pain_qualification",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "The specific pain within the use case quantified, not just described",
          "Consequence of the current approach named — cost, delay, error rate",
          "Their own words for the frustration captured",
          "Frequency of the pain established — daily, weekly, edge case",
          "Tied to a KPI or initiative if one existed"
        ]
      },
      {
        "key": "solutioning",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Platform capability mapped to their exact use case, not a nearby one",
          "Trade-offs of different approaches named — not just 'we can do this'",
          "Configuration or customization needed was explicit",
          "Where the fit was imperfect, honesty preferred to hedging",
          "At least one moment landed as 'yes, that's exactly it,' not narration"
        ]
      },
      {
        "key": "cde_build",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "If shown, environment matched the use case being discussed",
          "Data or config resembled what their reality would look like",
          "Nothing shown contradicted what was said",
          "Screens supported the conversation, didn't hijack it",
          "The whiteboard or diagram tool used matched the working-session tone"
        ]
      },
      {
        "key": "ai",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "AI positioned honestly within the use case — where it helps, where it doesn't",
          "Which AI capability (self-service, co-pilot, agents) tied to this use case named specifically",
          "Data flow and privacy for AI on this use case addressed",
          "Time and effort savings were concrete, not aspirational",
          "Their existing AI approach for this use case probed"
        ]
      },
      {
        "key": "value",
        "credit": 3,
        "category": "business_value",
        "subParameters": [
          "Business outcome of solving this use case named — revenue, cost, risk",
          "Metrics tied to the champion's KPIs, not company-wide",
          "Time-to-value for this use case addressed, not just eventual value",
          "ROI framed with their numbers or explicit benchmarks",
          "Value language reinforced across the conversation, not once"
        ]
      },
      {
        "key": "case_study",
        "credit": 1,
        "category": "business_value",
        "subParameters": [
          "If referenced, the case was industry-adjacent and use-case-adjacent",
          "Specific numbers cited",
          "Named company or honest NDA placeholder",
          "Parallel to their use case drawn explicitly",
          "Brief — used to reinforce, not to close"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Concerns about the fit engaged head-on, not deflected",
          "Where the use case exceeded platform capability, that was named",
          "Roadmap used only where committed, with realistic dates",
          "Workarounds offered honestly, not as cover",
          "Pushback landed — acknowledged, parked, or resolved"
        ]
      },
      {
        "key": "comp_pitch",
        "credit": 1,
        "category": "credibility_objections",
        "subParameters": [
          "If a competitor came up in the use case, specific comparison was made",
          "Differentiation was concrete for this use case, not generic",
          "Their current approach treated with respect",
          "Defensive, not aggressive",
          "Didn't derail the working session into a competitive pitch"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with framing of what the session was for",
          "Transitions between use cases or facets signposted",
          "Time managed — didn't sprawl on one facet at the cost of others",
          "Detours captured for follow-up, not chased forever",
          "Ended when it said it would, or renegotiated"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Customer talked at least half the time — this is a working session",
          "Their words and diagrams used back to them",
          "Multiple stakeholders on the call brought in",
          "Reactions read — pace or direction adjusted when they went quiet",
          "At least one moment of genuine collaboration, not presentation"
        ]
      },
      {
        "key": "storytelling",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "If stories used, they served the use case, not the SE's performance",
          "Personas specific to their world",
          "Industry language carried through",
          "Stories brief — supporting, not dominating",
          "Landed on business outcome relevant to the use case"
        ]
      },
      {
        "key": "summarise",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "The use case as understood was recapped in the customer's words",
          "Solution approach and trade-offs recapped honestly",
          "Open questions and things to confirm surfaced",
          "Next actions tied to the use case, not generic",
          "Under two minutes, and they nodded or corrected"
        ]
      },
      {
        "key": "cta",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Next step tied to advancing this specific use case",
          "Owner and date named",
          "POC scope or confirmation ask made concrete",
          "Customer confirmed the next step verbally",
          "Captured in writing"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just opening",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "trial_setup",
    "motion": "new_business",
    "name": "Trial setup",
    "version": "2.1",
    "totalCredits": 33,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Prior discovery and demo context remembered, not asked again",
          "Customer's use cases understood before the call",
          "Named stakeholders addressed with role context",
          "Any technical or organizational constraints from prior calls acknowledged",
          "Prep showed in first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Questions confirmed what success looks like, not just what to build",
          "Constraints (technical, organizational, timeline) probed explicitly",
          "Assumptions from earlier calls verified, not carried over",
          "Silent stakeholders on the call invited into the conversation",
          "Follow-ups asked when answers were vague"
        ]
      },
      {
        "key": "pain_qualification",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "The pain the trial is meant to solve was reconfirmed with numbers",
          "Consequence of trial failure named — what happens if this doesn't work",
          "Customer's words for what 'good' looks like captured",
          "Frequency and criticality of the target use case verified",
          "Tied to a KPI or initiative the customer already owns"
        ]
      },
      {
        "key": "stakeholder_mapping",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Champion, decision-maker, blocker, and end-user roles named",
          "Names of people who need to sign off but aren't on the call captured",
          "Buying committee's incentives and worries surfaced",
          "Deal-killer risks named — who could stop this and why",
          "Path to absent stakeholders agreed"
        ]
      },
      {
        "key": "solutioning",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "Solutioning happened only where trial scope needed clarification",
          "No new capabilities introduced — trial focused on what was scoped",
          "Trade-offs re-acknowledged where relevant",
          "Deferred conversations noted for post-trial",
          "The call wasn't derailed by 'while we're here, can we also...'"
        ]
      },
      {
        "key": "exit_criteria_defined",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Criteria are measurable — a number, a state, a demonstrated behavior",
          "Both success AND failure paths are named — what a 'no' looks like",
          "Criteria agreed by the champion, not just proposed by the SE",
          "Written down, not just discussed",
          "Criteria are specific to this customer, not templated"
        ]
      },
      {
        "key": "success_metrics_agreed",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Each metric has a target — a number, not 'improved'",
          "Each metric has an owner on the customer side, named",
          "Baseline is captured — where they are today, not just aspirational",
          "Metrics tie to business outcomes, not vanity numbers",
          "Timeframe agreed for each metric — by when, not 'eventually'"
        ]
      },
      {
        "key": "admin_access_enablement",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "Who gets admin access is named, not 'the team'",
          "Training scheduled with dates, not 'we'll figure it out'",
          "Data and integration setup owners identified",
          "Timeline to full enablement is realistic, not aspirational",
          "Contingency named if the admin blocks or leaves"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Concerns about trial scope, timing, or resources engaged head-on",
          "Trade-offs of the agreed scope acknowledged, not glossed",
          "Timeline uncertainty named honestly, not overpromised",
          "Trial success requires customer effort — that was communicated, not hidden",
          "Pushback landed — parked with owner or resolved"
        ]
      },
      {
        "key": "risk_identification",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Top risks named — technical, organizational, timing",
          "Each risk has an owner — who watches for it, not 'we'll monitor'",
          "Mitigation plan exists for each material risk",
          "Trigger conditions specified — what signals the risk is materializing",
          "Killer risks that would end the trial are explicit, not hidden"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with agenda and expected outcomes of the call",
          "Transitions between setup topics signposted",
          "Time managed — every planned item got covered",
          "Detours parked for follow-up, not chased",
          "Ended when it said it would, with a clear plan"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Multiple stakeholders on the call contributed",
          "Champion's voice not the only one heard",
          "Concerns from end-user or admin surfaced",
          "Reactions read — pace adjusted when energy dropped",
          "At least one moment of genuine agreement or negotiation"
        ]
      },
      {
        "key": "cadence_checkpoints",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Checkpoint frequency set — weekly, biweekly, not 'check in'",
          "First checkpoint has a date and calendar invite",
          "Attendees for checkpoints named on both sides",
          "What each checkpoint covers agreed — usage, blockers, questions",
          "Escalation path if checkpoints slip is named"
        ]
      },
      {
        "key": "summarise",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Exit criteria, success metrics, and timelines recapped clearly",
          "Owners on both sides named again in the recap",
          "Risks and open items surfaced",
          "Customer's confirmation on the plan captured",
          "Under three minutes, and they nodded or added"
        ]
      },
      {
        "key": "cta",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Immediate next actions named with owner and date",
          "First checkpoint scheduled during the call, not 'we'll find a time'",
          "Access and enablement steps confirmed with a start date",
          "Written summary committed to be sent within 24 hours",
          "Customer confirmed the plan verbally"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "troubleshooting",
    "motion": "new_business",
    "name": "Troubleshooting",
    "version": "2.1",
    "totalCredits": 33,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Ticket, prior interactions, and account context reviewed before the call",
          "Recent changes to the customer's environment known if available",
          "Named people on the call addressed with context, not generically",
          "Prior escalations or unresolved issues from the account known",
          "Prep showed in first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Questions targeted the problem, not tangents",
          "Reproducibility explicitly probed — one-time, intermittent, or consistent",
          "Recent changes on the customer's side surfaced — what changed before it broke",
          "Impact scope confirmed — who's affected, how many users",
          "Follow-ups asked when answers were incomplete"
        ]
      },
      {
        "key": "problem_diagnosis",
        "credit": 3,
        "category": "discovery_qualification",
        "subParameters": [
          "Symptoms separated from causes — what happened vs why",
          "Reproducibility tested — one-time, intermittent, or consistent",
          "Recent changes surfaced — what changed before it broke",
          "Impact quantified — who's blocked, how many users, revenue at risk",
          "Diagnosis completed before proposing fixes"
        ]
      },
      {
        "key": "technical_accuracy",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Statements about how the product works were correct",
          "Log messages, error codes, and behavior described accurately",
          "Where SE didn't know, they said so — no bluffing",
          "Terminology matched documentation, not colloquial",
          "Any workaround or fix path was accurately described"
        ]
      },
      {
        "key": "resolution_or_clear_path",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "If resolved on call, verification was done — not just 'should be fixed'",
          "If not resolved, next step has an owner and a date",
          "Root cause explained, not just the fix — so it doesn't recur",
          "Workarounds provided if the full fix will take time",
          "Follow-up communication plan agreed"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Customer pushback on the diagnosis engaged, not defended against",
          "Timeline objections acknowledged, not glossed",
          "Where the customer contributed to the issue, that was said gently but honestly",
          "Alternative resolution paths offered when the primary was rejected",
          "Pushback landed — acknowledged, escalated, or resolved"
        ]
      },
      {
        "key": "expectation_setting",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Realistic timelines given, not optimistic ones",
          "Uncertainty acknowledged where it existed",
          "Trade-offs of different fix paths explained",
          "What the customer needs to do vs what the SE will do — clear",
          "No overpromising to calm the room"
        ]
      },
      {
        "key": "escalation_handling",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Right escalation path identified — product, engineering, support",
          "Escalation initiated on the call if warranted, not 'I'll ask'",
          "What the escalated team needs was captured — logs, screenshots, repro",
          "SLA on escalation response was communicated",
          "SE stayed in the loop as the customer's advocate, not handed off"
        ]
      },
      {
        "key": "customer_reassurance",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Customer's frustration acknowledged, not deflected",
          "What is being done, right now, was communicated",
          "Customer was not blamed, even when they contributed to the issue",
          "Confidence expressed without being dismissive of impact",
          "A human, not a script — the SE was present in the conversation"
        ]
      },
      {
        "key": "documentation_followup",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "What was diagnosed and agreed was written up, not just said",
          "Sent to the customer within an agreed timeframe",
          "Contains reproduction steps if the issue recurs",
          "Names the owner for next steps clearly",
          "Referenced by ticket ID or record for continuity"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with acknowledgment of the issue and framing of the call",
          "Diagnosis and resolution phases signposted",
          "Time managed — call didn't sprawl on diagnosis at the cost of resolution",
          "Detours parked, not chased",
          "Ended when it said it would, with a clear plan"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Customer was heard — their frustration acknowledged verbally",
          "Technical folks on the customer side were invited to contribute",
          "SE didn't monologue diagnostic thinking — customer stayed in the loop",
          "Reactions read — pace or direction adjusted when concerns showed",
          "At least one moment of collaborative diagnosis"
        ]
      },
      {
        "key": "summarise",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Diagnosis, resolution or path forward, and owners recapped",
          "Timeline for follow-up named",
          "Customer's original concerns addressed in the recap",
          "Any open items or verifications surfaced",
          "Under two minutes, and customer confirmed"
        ]
      },
      {
        "key": "cta",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Specific next step named — what happens next and when",
          "Owner on the Freshworks side named, not just 'we'll get back'",
          "Documentation and follow-up commitment with timeline",
          "Customer confirmed the plan verbally",
          "Captured in writing referenced to ticket ID"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just opening",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "qa_session",
    "motion": "new_business",
    "name": "Q&A session",
    "version": "2.1",
    "totalCredits": 25,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Prior questions or open items from the customer were remembered",
          "The customer's known priorities were kept in mind",
          "Named people on the call addressed with context",
          "Their industry and use cases informed the framing of answers",
          "Prep showed in the framing of answers, not retrofitted later"
        ]
      },
      {
        "key": "solutioning",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "Where a question warranted a capability walkthrough, it was crisp and tied to their context",
          "Trade-offs named honestly, not spun",
          "Configuration or customization implications were flagged when relevant",
          "Where the fit was imperfect, it was named",
          "Answers didn't sprawl into unrelated capability tours"
        ]
      },
      {
        "key": "value",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Where value questions came up, answers cited concrete outcomes",
          "Numbers were the customer's or clearly benchmarked",
          "Time-to-value addressed if asked",
          "Business impact tied to the specific capability being discussed",
          "Value language present where relevant, not forced everywhere"
        ]
      },
      {
        "key": "question_handling",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Questions answered accurately, not confidently-adjacent",
          "Answers at the right depth — not too shallow, not lecturing",
          "Where the SE didn't know, they said so — no bluffing",
          "Complex questions broken into parts, not answered in one blob",
          "Follow-up commitments (data, docs, confirmation) captured"
        ]
      },
      {
        "key": "technical_accuracy",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Statements about how features work were correct and specific",
          "Numbers cited (rate limits, SLAs, capacity) were accurate",
          "Where the SE didn't know, they said so and committed to confirm",
          "Product terminology matched documentation",
          "No positioning claims that fail on inspection"
        ]
      },
      {
        "key": "objections",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Hard questions engaged head-on, not deflected",
          "Answers engaged the specific concern, not a nearby easier one",
          "Limitations named where they existed, not glossed",
          "Roadmap used only where committed",
          "Pushback landed — acknowledged, parked, or resolved"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with framing of what the Q&A would cover",
          "Transitions between questions were smooth, not abrupt",
          "Time managed — questions weren't rushed at the end",
          "SE didn't let one question dominate at the cost of others",
          "Ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Multiple askers were invited — not just the loudest",
          "Follow-up questions welcomed and answered",
          "Silent participants brought in with light invitations",
          "Reactions read — depth adjusted mid-flight",
          "At least one moment of genuine back-and-forth"
        ]
      },
      {
        "key": "summarise",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Key themes from the Q&A recapped, not just the last question",
          "Follow-up commitments and owners named",
          "Open items or unresolved questions surfaced",
          "Customer's concerns addressed in the summary",
          "Under two minutes, and audience nodded"
        ]
      },
      {
        "key": "cta",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Specific next step named — follow-up docs, meeting, POC scope",
          "Owner and date named for each commitment",
          "Confirmed by the customer verbally",
          "Captured in writing",
          "Advances the deal, not just 'we'll be in touch'"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "demo_plan_upgrade",
    "motion": "expansion",
    "name": "Demo — Plan Upgrade",
    "version": "2.1",
    "totalCredits": 24,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Current product usage and adoption level referenced specifically — modules live, user count, volume",
          "Known product issues or open tickets on the account acknowledged before being raised by the customer",
          "Usage or health data reviewed before the call, not learned on the fly",
          "Named stakeholder on the call addressed with context, not generically",
          "Prep showed in the framing of the demo's opening, not retrofitted later"
        ]
      },
      {
        "key": "cde_build",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "Environment reflects the customer's industry, not a generic sandbox",
          "Data and terminology recognizable to their world, even if not their exact instance",
          "Setup was fit for a positioning demo — not over-built for the time available",
          "Nothing on screen contradicted what's known about their actual account",
          "Environment was ready before the call started, no live setup fumbling"
        ]
      },
      {
        "key": "solutioning",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "Each feature shown tied to a specific expansion opportunity, not a generic tour",
          "Tell-show-tell used even briefly — framed, shown, tied back",
          "Features irrelevant to their current usage were skipped, not paraded",
          "At least one moment landed as 'that would help us,' not narration",
          "Demo stayed proportionate to a positioning call, not a rebuild of the whole platform"
        ]
      },
      {
        "key": "ai",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Every Freddy AI capability relevant to their plan or usage was shown, not just one",
          "Mechanics explained honestly — where it draws from, what it can't do",
          "ROI or time saved was concrete and tied to their own usage, not generic",
          "Data, privacy, or model questions were pre-empted, not dodged",
          "AI was positioned as the primary expansion hook of the call, not a footnote"
        ]
      },
      {
        "key": "slide_deck",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "Deck was tailored — logo, industry, or account name somewhere",
          "Slides supported the value story, not filler between demo screens",
          "Time on slides proportionate — a few minutes, not the majority of the call",
          "Complex visuals were walked, not read",
          "Deck ended on the expansion ask, not 'thank you'"
        ]
      },
      {
        "key": "value",
        "credit": 3,
        "category": "business_value",
        "subParameters": [
          "Value quantified — hours, tickets, cost, headcount — not adjectival",
          "Numbers anchored to their own usage or clearly benchmarked",
          "At least one value point tied to the champion's or admin's actual KPI",
          "Value framed as what expansion adds, not just what they already have",
          "Value language repeated at least twice across the call, not once"
        ]
      },
      {
        "key": "microstory",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Brief — under 30 seconds, not a slide-backed case study",
          "A specific number or outcome cited, not 'significant improvement'",
          "Industry- or size-adjacent to the customer",
          "Told at the exact moment it reinforced a feature just shown",
          "Didn't stall the demo's pace — in and out, not lingered on"
        ]
      },
      {
        "key": "objections",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Frustration about existing product issues acknowledged first, not argued with",
          "The specific issue raised was engaged, not deflected to 'the team is aware'",
          "A path to resolution or a status update was given, not just sympathy",
          "Limitations were named honestly where they existed",
          "The conversation was steered back to expansion value, not left on the complaint"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Call opened with a clear purpose — positioning, not a generic check-in",
          "Transitions between features signposted, not abrupt",
          "Time managed — no rushed final minutes",
          "Product-issue detours bounded, not allowed to consume the call",
          "Call ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Customer talked at least a third of the time, even without formal discovery",
          "Their name and known usage referenced back to them",
          "Multiple stakeholders on the call addressed, not just the loudest",
          "Reactions read — pace or depth adjusted mid-flight",
          "At least one moment of genuine back-and-forth, not monologue-and-nod"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Key expansion opportunities recapped, not just features shown",
          "Value points restated in the customer's language",
          "Any open product concerns surfaced, not buried",
          "Next step tied to the expansion opportunity discussed",
          "Summary brief — under two minutes"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "A specific next step proposed — feature trial, follow-up, or approval ask",
          "It had an owner and a date, not just a verb",
          "Advanced the expansion — not 'let's stay in touch'",
          "Customer confirmed verbally",
          "Captured in writing before or immediately after the call"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just the opening",
          "Background and professional framing",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "discovery",
    "motion": "expansion",
    "name": "Discovery",
    "version": "2.1",
    "totalCredits": 27,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 3,
        "category": "discovery_qualification",
        "subParameters": [
          "Current usage, adoption level, and modules live on the account reviewed before the call",
          "Health score, ticket history, or renewal timeline pulled from CSM records, not asked cold",
          "Prior expansion conversations or shelved upsell/cross-sell asks remembered",
          "Named stakeholder on the call addressed with context — role, tenure with product, past interactions",
          "Prep showed in the framing of the opening, not retrofitted later"
        ]
      },
      {
        "key": "incumbent_competition",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "The tool or workaround currently used for the adjacent need was named specifically, not assumed",
          "What they like about that workaround was uncovered, not just its gaps",
          "Any parallel evaluation of a point solution or competitor for this use case surfaced honestly",
          "Switching or consolidation cost onto the existing platform was acknowledged, not dismissed",
          "Budget owner and buying process for the expansion were mapped, not assumed to mirror the original deal"
        ]
      },
      {
        "key": "stakeholder_mapping",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Champion vs. economic buyer vs. blocker for the expansion distinguished — often different from the original deal's",
          "New stakeholders introduced by growth (new team, new region, new use case owner) were captured by name",
          "CSM's existing relationship map was used and built on, not rebuilt from scratch",
          "Risk to the expansion — budget freeze, reorg, competing priority — was identified",
          "A path to reach stakeholders not on the call was agreed with the CSM"
        ]
      },
      {
        "key": "solutioning",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Where a capability naturally fit the new pain, it was gestured at, not paraded",
          "Nothing over-promised — \"let me confirm and come back\" over \"sure, that's included\"",
          "The pattern-match to their world was explicit, anchored in what they already run in the product",
          "Tangents into a full platform tour weren't allowed to derail the expansion-specific discovery",
          "What was mentioned in passing was logged for the follow-up demo"
        ]
      },
      {
        "key": "ai",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "AI was mentioned only where it mapped to a pain just described, not as a headliner",
          "Their current Freddy usage or attitude toward AI (if any modules are live) was checked first",
          "It was framed as a capability to explore, not sold",
          "Data, privacy, or trust questions were welcomed, not deflected",
          "It didn't dominate airtime relative to the core expansion pain"
        ]
      },
      {
        "key": "value",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Value framed as a hypothesis to test against the new pain, not proof to accept",
          "Their own usage data or account metrics anchored the value story, not generic ROI stats",
          "Time-to-value for the expansion was set up as a conversation, not answered outright",
          "Success criteria for a pilot or expansion trial were seeded",
          "Value language tied to the champion's or admin's KPI at least once"
        ]
      },
      {
        "key": "case_study",
        "credit": 1,
        "category": "business_value",
        "subParameters": [
          "If used, the reference was an account that expanded from a similar starting footprint",
          "Used to draw them out — \"does that path sound familiar?\" — not to close",
          "Didn't crowd out their own story",
          "A named account or an honest anonymized placeholder",
          "Brief — under two minutes"
        ]
      },
      {
        "key": "objections",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Concerns about cost, timing, or \"we're not using what we already have\" were welcomed, not batted away",
          "Answers acknowledged what was true about the objection first",
          "Underused modules or adoption gaps were named honestly, not glossed over",
          "Nothing resolved with roadmap that shouldn't have been",
          "Pushback landed somewhere — acknowledged, parked, or resolved"
        ]
      },
      {
        "key": "comp_pitch",
        "credit": 1,
        "category": "credibility_objections",
        "subParameters": [
          "If a point solution or competitor came up for the adjacent use case, it was named specifically",
          "Differentiation was concrete — why consolidating on the existing platform beats a bolt-on tool",
          "Their current workaround was treated with respect",
          "It was defensive, not aggressive",
          "It didn't derail into a competitive teardown"
        ]
      },
      {
        "key": "call_flow",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Opened with agenda and time check, framed as an expansion conversation, not a check-in",
          "Transitions signposted",
          "Time managed — no rushed last ten minutes",
          "Detours into support issues or open tickets bounded, not chased",
          "Ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Customer talked at least two-thirds of the time",
          "Their name, usage patterns, and words used back to them",
          "Multiple stakeholders in the room addressed, not just the loudest",
          "Reactions read and pace adjusted",
          "At least one moment of genuine back-and-forth"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "New pain recapped in the customer's words, not the SE's",
          "What was learned about stakeholders, budget, and timing was noted",
          "Value hypotheses named as hypotheses to test, tied to expansion",
          "Open questions and unknowns surfaced honestly",
          "Under two minutes, and they nodded"
        ]
      },
      {
        "key": "cta",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "A specific next step proposed — expansion demo, pilot scope, stakeholder intro, or business case",
          "Owner and date named, not just a verb",
          "It advanced the expansion, coordinated with the CSM's account plan",
          "Customer confirmed verbally",
          "Captured in writing, and shared with the CSM"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just the opening",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees (CSM included) also on camera"
        ]
      }
    ]
  },
  {
    "key": "technical_deep_dive",
    "motion": "expansion",
    "name": "Technical deep dive",
    "version": "2.1",
    "totalCredits": 26,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Customer's current configuration, integrations, and scale on the platform reviewed before the call",
          "New technical requirement driving the expansion (new system, higher volume, new region) understood in advance",
          "Named engineers or architects on the call addressed with context from prior tickets or calls",
          "Recent technical changes on their side (migration, new vendor, org change) surfaced from CSM notes",
          "Prep showed in the first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Technical questions probed the specific gap driving the expansion ask, not generic capability",
          "Non-functional requirements for the new use case surfaced — scale, latency, compliance",
          "Edge cases specific to how they already run the platform were explored, not generic ones",
          "Follow-ups asked when answers about the new requirement were incomplete",
          "Silence allowed while they thought it through"
        ]
      },
      {
        "key": "solutioning",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Each capability tied to the specific expansion requirement they named, not a platform tour",
          "Trade-offs named — what the new configuration chooses over what they run today",
          "Extension points or customization for the new use case shown, not just default paths",
          "How the new module interacts with their existing setup (permissions, data model, tenancy) handled with specifics",
          "At least one moment landed as \"that solves it without disrupting what we have,\" not narration"
        ]
      },
      {
        "key": "cde_build",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "Environment reflected their actual account — existing config, data shapes, integration surface",
          "APIs, webhooks, or custom code relevant to the expansion shown, not just UI",
          "Real data resembling their domain used, not a generic sandbox",
          "Configuration state matched what a customer of their maturity and current usage would run",
          "Nothing on screen contradicted what they already have live"
        ]
      },
      {
        "key": "technical_accuracy",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Statements about how the new capability interacts with their current setup were correct and specific",
          "Numbers cited (limits, throughput, SLAs) were accurate for their current plan/tier, not ballpark",
          "Where the SE didn't know, they said so and committed to confirm",
          "Product terminology matched documentation, not colloquial approximations",
          "No positioning claims about the expansion that would fail on inspection"
        ]
      },
      {
        "key": "ai",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Model architecture, training data, and inference path for the AI capability being added were explained honestly",
          "Data residency and privacy handling addressed with specifics relevant to their existing setup",
          "Fine-tuning, RAG, or BYOM options positioned accurately against what they already use",
          "Failure modes and hallucination handling explained, not deflected",
          "Integration points for their existing AI stack surfaced (MCP, APIs, model choice)"
        ]
      },
      {
        "key": "value",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Technical benefit of the expansion tied to a business outcome at least once",
          "Total cost of the addition addressed, not just license cost, relative to what they already pay",
          "Operational overhead (maintenance, upgrades) named honestly",
          "Time-to-implementation for the expansion was realistic, not aspirational",
          "Value language present but not dominant — audience was technical"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Hard technical questions about the expansion engaged head-on, not deflected",
          "Limitations named where they existed, with specifics",
          "Roadmap used only where committed, with realistic timelines",
          "Alternative approaches offered when the direct path conflicted with their existing setup",
          "Pushback landed — acknowledged, engineered around, or parked with an owner"
        ]
      },
      {
        "key": "comp_pitch",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "If a point solution or competitor came up for the new use case, technical differentiation was specific",
          "Where they matched, honesty was preferred to hedging",
          "Their existing tool or workaround was treated with technical respect",
          "Comparisons focused on capability, not vendor politics",
          "Didn't derail into a competitive teardown"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with agenda and time check",
          "Transitions between topics signposted",
          "Deep dives bounded so all planned topics got covered",
          "Time managed for questions",
          "Ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Engineers on the call addressed by name and role",
          "Silence from quieter engineers invited, not steamrolled",
          "Reactions read — technical concerns pursued when they surfaced",
          "Multiple stakeholders' concerns balanced, not just the loudest voice",
          "At least one moment of genuine technical back-and-forth"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Technical decisions and open questions about the expansion recapped clearly",
          "Commitments to confirm named with owners and dates",
          "Architectural choices from the discussion reflected back",
          "Concerns raised by the customer surfaced in the summary",
          "Under two minutes, and the technical audience nodded"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Specific next step proposed — POC scope for the expansion, architecture review, security questionnaire",
          "Owner and date named on both sides, including the CSM",
          "Technical artifacts to share (docs, sandbox access) committed with timelines",
          "Confirmed by the customer, not just proposed",
          "Captured in writing with technical specificity"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "reverse_demo",
    "motion": "expansion",
    "name": "Reverse demo",
    "version": "2.1",
    "totalCredits": 17,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "observation_note_capture",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Points of struggle with the new module noted in real time, not reconstructed",
          "Positive discoveries captured too — what excited them about the expansion feature",
          "Questions they asked during the exercise logged",
          "Non-verbal signals (frustration, hesitation) noted, especially where it touches their existing workflow",
          "Notes shared or referenced in the summary, not held privately"
        ]
      },
      {
        "key": "setup_framing",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Purpose of the exercise — evaluating the new module/use case — framed clearly at the start",
          "Ground rules stated — they'd drive, SE would observe",
          "Environment and permissions (including any sandbox tied to their real account) checked before starting",
          "What \"success\" looks like for the expansion decision was named",
          "Time expectations set — how long, what happens at the end"
        ]
      },
      {
        "key": "value",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Value framing bookended the session, not squeezed mid-flow",
          "Their words about ease or friction with the new module reflected back when relevant",
          "Value language present but sparse — this is not a value pitch",
          "Business outcomes referenced when a task validated one",
          "No hard ROI selling during hands-on time"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Concerns about the new module during hands-on welcomed, not defended against",
          "Genuine friction with the new capability acknowledged, not spun",
          "Limitations named where the customer bumped into them",
          "Workarounds offered honestly, not as cover for gaps",
          "Pushback captured for follow-up, not batted away"
        ]
      },
      {
        "key": "coaching_without_taking_over",
        "credit": 1,
        "category": "credibility_objections",
        "subParameters": [
          "Guidance was verbal and open-ended, not \"click there\"",
          "Silence was allowed when they were thinking, not filled",
          "Corrections happened after attempts, not before",
          "Praise was specific, not generic",
          "When they got stuck, SE offered a hint before revealing the answer"
        ]
      },
      {
        "key": "handover_discipline",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Customer had control of screen and mouse from the start",
          "SE didn't grab back control when a task stalled",
          "When SE demonstrated, it was declared and time-boxed, not sneaked",
          "Multiple customer users got hands-on time if present, not just one",
          "SE stayed off camera focus when unnecessary"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with framing and time check",
          "Task transitions signposted",
          "Time per task managed — struggling tasks bounded, not sprawled",
          "Reserved time for reflection and Q&A at the end, tied to the expansion decision",
          "Ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Multiple customer users had hands-on time, not just one dominant user",
          "Their reactions during tasks were read and acknowledged",
          "SE checked in between tasks — \"how did that feel against what you do today?\"",
          "Silences during their thinking were respected, not filled",
          "Energy in the room stayed engaged"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "What they struggled with on the new module was named clearly, not glossed",
          "What excited them was named clearly, not just wins",
          "Their words used back in the recap",
          "Open questions and things to test next were captured, tied to the expansion decision",
          "Under three minutes, and they added or corrected"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Next step tied to what surfaced in the exercise, not generic",
          "Owner and date named, including the CSM",
          "Documentation or config help committed with a timeline",
          "Customer confirmed the plan verbally",
          "Captured in writing"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on for the framing and debrief portions",
          "Camera state supported observation, not disrupted the customer's flow",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees on camera during framing and debrief"
        ]
      }
    ]
  },
  {
    "key": "use_case_discussion",
    "motion": "expansion",
    "name": "Use case discussion",
    "version": "2.1",
    "totalCredits": 24,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Prior use cases already live on the account were remembered, not asked again",
          "The team or workflow behind the new use case understood before the call",
          "Usage or health data relevant to adoption of the new use case reviewed",
          "Named people addressed with role context",
          "Prep showed in first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Questions probed how the new use case is done today, not just what they want",
          "Edge cases and exceptions surfaced, not just the happy path",
          "Metrics for the use case explored — volume, frequency, criticality",
          "Who owns the use case and who depends on it was uncovered",
          "Silence allowed when they were thinking through the workflow"
        ]
      },
      {
        "key": "pain_qualification",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "The specific pain within the new use case quantified, not just described",
          "Consequence of the current approach named — cost, delay, error rate",
          "Their own words for the frustration captured",
          "Frequency of the pain established",
          "Tied to a KPI or initiative if one existed, ideally one the CSM already tracks"
        ]
      },
      {
        "key": "solutioning",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Platform capability mapped to their exact new use case, not a nearby one",
          "Trade-offs of different approaches named",
          "Configuration or customization needed made explicit, including impact on existing setup",
          "Where the fit was imperfect, honesty preferred to hedging",
          "At least one moment landed as \"yes, that's exactly it,\" not narration"
        ]
      },
      {
        "key": "cde_build",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "If shown, environment matched the use case being discussed and their existing account",
          "Data or config resembled what their reality would look like",
          "Nothing shown contradicted what was said",
          "Screens supported the conversation, didn't hijack it",
          "The whiteboard or diagram tool used matched the working-session tone"
        ]
      },
      {
        "key": "ai",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "AI positioned honestly within the new use case — where it helps, where it doesn't",
          "Which AI capability (self-service, co-pilot, agents) ties to this use case named specifically",
          "Data flow and privacy for AI on this use case addressed",
          "Time and effort savings were concrete, tied to their own volume",
          "Their existing AI approach or adoption elsewhere in the account probed"
        ]
      },
      {
        "key": "value",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Business outcome of solving this use case named — revenue, cost, risk",
          "Metrics tied to the champion's or admin's KPIs, not company-wide",
          "Time-to-value for this use case addressed",
          "ROI framed with their numbers or explicit benchmarks",
          "Value language reinforced across the conversation, not once"
        ]
      },
      {
        "key": "case_study",
        "credit": 1,
        "category": "business_value",
        "subParameters": [
          "If referenced, the case was industry- and use-case-adjacent, ideally an expansion story",
          "Specific numbers cited",
          "Named account or honest anonymized placeholder",
          "Parallel to their use case drawn explicitly",
          "Brief — used to reinforce, not to close"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Concerns about the fit engaged head-on, not deflected",
          "Where the use case exceeded current plan or platform capability, that was named",
          "Roadmap used only where committed, with realistic dates",
          "Workarounds offered honestly, not as cover",
          "Pushback landed — acknowledged, parked, or resolved"
        ]
      },
      {
        "key": "comp_pitch",
        "credit": 1,
        "category": "credibility_objections",
        "subParameters": [
          "If a point tool or competitor came up in the use case, specific comparison was made",
          "Differentiation was concrete for this use case, not generic",
          "Their current approach treated with respect",
          "Defensive, not aggressive",
          "Didn't derail the working session into a competitive pitch"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with framing of what the session was for",
          "Transitions between facets signposted",
          "Time managed — didn't sprawl on one facet at the cost of others",
          "Detours captured for follow-up",
          "Ended when it said it would, or renegotiated"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Customer talked at least half the time — this is a working session",
          "Their words and diagrams used back to them",
          "Multiple stakeholders on the call brought in",
          "Reactions read — pace or direction adjusted when they went quiet",
          "At least one moment of genuine collaboration, not presentation"
        ]
      },
      {
        "key": "storytelling",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "If stories used, they served the use case, not the SE's performance",
          "Personas specific to their world",
          "Industry language carried through",
          "Stories brief — supporting, not dominating",
          "Landed on a business outcome relevant to the use case"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "The use case as understood was recapped in the customer's words",
          "Solution approach and trade-offs recapped honestly",
          "Open questions and things to confirm surfaced",
          "Next actions tied to the use case, not generic",
          "Under two minutes, and they nodded or corrected"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Next step tied to advancing this specific use case",
          "Owner and date named, including the CSM",
          "Pilot scope or confirmation ask made concrete",
          "Customer confirmed the next step verbally",
          "Captured in writing"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "trial_setup",
    "motion": "expansion",
    "name": "Trial setup",
    "version": "2.1",
    "totalCredits": 24,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Prior discovery and demo context on the expansion module remembered, not asked again",
          "Customer's current usage and health status understood before the call",
          "Named stakeholders addressed with role context",
          "Any technical or organizational constraints from prior calls acknowledged",
          "Prep showed in first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Questions confirmed what success on the new module looks like, not just what to build",
          "Constraints (technical, organizational, timeline) probed explicitly",
          "Assumptions from earlier calls verified, not carried over",
          "Silent stakeholders on the call invited into the conversation",
          "Follow-ups asked when answers were vague"
        ]
      },
      {
        "key": "stakeholder_mapping",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Champion, decision-maker, blocker, and end-user roles for the expansion named",
          "Names of people who need to sign off but aren't on the call captured",
          "Buying committee's incentives and worries for the expansion spend surfaced",
          "Deal-killer risks named — who could stop this and why",
          "Path to absent stakeholders agreed with the CSM"
        ]
      },
      {
        "key": "solutioning",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Solutioning happened only where trial scope needed clarification",
          "No new capabilities introduced — trial focused on what was scoped",
          "Trade-offs re-acknowledged where relevant",
          "Deferred conversations noted for post-trial",
          "The call wasn't derailed by \"while we're here, can we also...\""
        ]
      },
      {
        "key": "exit_criteria_defined",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "Criteria are measurable — a number, a state, a demonstrated behavior",
          "Both success AND failure paths are named",
          "Criteria agreed by the champion, not just proposed by the SE",
          "Written down, not just discussed",
          "Criteria are specific to this account's actual usage, not templated"
        ]
      },
      {
        "key": "success_metrics_agreed",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "Each metric has a target, not \"improved\"",
          "Each metric has an owner on the customer side, named",
          "Baseline is captured from their existing account data, not just aspirational",
          "Metrics tie to business outcomes, not vanity numbers",
          "Timeframe agreed for each metric"
        ]
      },
      {
        "key": "admin_access_enablement",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "Who gets admin access for the new module is named, not \"the team\"",
          "Training scheduled with dates",
          "Data and integration setup owners identified, coordinated with the CSM",
          "Timeline to full enablement is realistic, not aspirational",
          "Contingency named if the admin blocks or leaves"
        ]
      },
      {
        "key": "objections",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Concerns about trial scope, timing, or resources engaged head-on",
          "Trade-offs of the agreed scope acknowledged, not glossed",
          "Timeline uncertainty named honestly, not overpromised",
          "Trial success requires customer effort — that was communicated, not hidden",
          "Pushback landed — parked with owner or resolved"
        ]
      },
      {
        "key": "risk_identification",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Top risks named — technical, organizational, timing, or competing internal priority",
          "Each risk has an owner",
          "Mitigation plan exists for each material risk",
          "Trigger conditions specified",
          "Killer risks that would end the trial (budget cycle, renewal timing) are explicit"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with agenda and expected outcomes of the call",
          "Transitions between setup topics signposted",
          "Time managed — every planned item got covered",
          "Detours parked for follow-up, not chased",
          "Ended when it said it would, with a clear plan"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Multiple stakeholders on the call contributed",
          "Champion's voice not the only one heard",
          "Concerns from end-user or admin surfaced",
          "Reactions read — pace adjusted when energy dropped",
          "At least one moment of genuine agreement or negotiation"
        ]
      },
      {
        "key": "cadence_checkpoints",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Checkpoint frequency set — weekly, biweekly, not \"check in\"",
          "First checkpoint has a date and calendar invite, with the CSM included",
          "Attendees for checkpoints named on both sides",
          "What each checkpoint covers agreed — usage, blockers, questions",
          "Escalation path if checkpoints slip is named"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Exit criteria, success metrics, and timelines recapped clearly",
          "Owners on both sides named again in the recap",
          "Risks and open items surfaced",
          "Customer's confirmation on the plan captured",
          "Under three minutes, and they nodded or added"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Immediate next actions named with owner and date",
          "First checkpoint scheduled during the call",
          "Access and enablement steps confirmed with a start date",
          "Written summary committed to be sent within 24 hours, copied to the CSM",
          "Customer confirmed the plan verbally"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "troubleshooting",
    "motion": "expansion",
    "name": "Troubleshooting",
    "version": "2.1",
    "totalCredits": 25,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Ticket, prior interactions, and account health reviewed before the call",
          "Recent changes to the customer's environment or usage known if available",
          "Named people on the call addressed with context, not generically",
          "Prior escalations or unresolved issues from the account known, including any renewal risk flagged by the CSM",
          "Prep showed in first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Questions targeted the problem, not tangents",
          "Reproducibility explicitly probed — one-time, intermittent, or consistent",
          "Recent changes on the customer's side surfaced — what changed before it broke",
          "Impact scope confirmed — who's affected, how many users, whether it touches an expansion-critical workflow",
          "Follow-ups asked when answers were incomplete"
        ]
      },
      {
        "key": "problem_diagnosis",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Symptoms separated from causes",
          "Reproducibility tested",
          "Recent changes surfaced",
          "Impact quantified — who's blocked, how many users, revenue or renewal at risk",
          "Diagnosis completed before proposing fixes"
        ]
      },
      {
        "key": "technical_accuracy",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Statements about how the product works were correct",
          "Log messages, error codes, and behavior described accurately",
          "Where the SE didn't know, they said so — no bluffing",
          "Terminology matched documentation, not colloquial",
          "Any workaround or fix path was accurately described"
        ]
      },
      {
        "key": "resolution_or_clear_path",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "If resolved on call, verification was done, not just \"should be fixed\"",
          "If not resolved, next step has an owner and a date",
          "Root cause explained, not just the fix",
          "Workarounds provided if the full fix will take time",
          "Follow-up communication plan agreed, coordinated with the CSM"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Customer pushback on the diagnosis engaged, not defended against",
          "Timeline objections acknowledged, not glossed",
          "Where the customer contributed to the issue, that was said gently but honestly",
          "Alternative resolution paths offered when the primary was rejected",
          "Pushback landed — acknowledged, escalated, or resolved"
        ]
      },
      {
        "key": "expectation_setting",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Realistic timelines given, not optimistic ones",
          "Uncertainty acknowledged where it existed",
          "Trade-offs of different fix paths explained",
          "What the customer needs to do vs. what the SE will do — clear",
          "No overpromising to calm the room, especially near a renewal date"
        ]
      },
      {
        "key": "escalation_handling",
        "credit": 1,
        "category": "credibility_objections",
        "subParameters": [
          "Right escalation path identified — product, engineering, support",
          "Escalation initiated on the call if warranted",
          "What the escalated team needs was captured — logs, screenshots, repro",
          "SLA on escalation response was communicated",
          "SE stayed in the loop as the customer's advocate, alongside the CSM"
        ]
      },
      {
        "key": "customer_reassurance",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Customer's frustration acknowledged, not deflected",
          "What is being done, right now, was communicated",
          "Customer was not blamed, even when they contributed to the issue",
          "Confidence expressed without being dismissive of impact on their expansion plans or renewal",
          "A human, not a script — the SE was present in the conversation"
        ]
      },
      {
        "key": "documentation_followup",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "What was diagnosed and agreed was written up, not just said",
          "Sent to the customer within an agreed timeframe",
          "Contains reproduction steps if the issue recurs",
          "Names the owner for next steps clearly",
          "Referenced by ticket ID and shared with the CSM for continuity"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with acknowledgment of the issue and framing of the call",
          "Diagnosis and resolution phases signposted",
          "Time managed — call didn't sprawl on diagnosis at the cost of resolution",
          "Detours parked, not chased",
          "Ended when it said it would, with a clear plan"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Customer was heard — their frustration acknowledged verbally",
          "Technical folks on the customer side were invited to contribute",
          "SE didn't monologue diagnostic thinking — customer stayed in the loop",
          "Reactions read — pace or direction adjusted when concerns showed",
          "At least one moment of collaborative diagnosis"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Diagnosis, resolution or path forward, and owners recapped",
          "Timeline for follow-up named",
          "Customer's original concerns addressed in the recap",
          "Any open items or verifications surfaced",
          "Under two minutes, and customer confirmed"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Specific next step named — what happens next and when",
          "Owner on the Freshworks side named, not just \"we'll get back\"",
          "Documentation and follow-up commitment with timeline",
          "Customer confirmed the plan verbally",
          "Captured in writing, referenced to ticket ID, and shared with the CSM"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just opening",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "qa_session",
    "motion": "expansion",
    "name": "Q&A session",
    "version": "2.1",
    "totalCredits": 20,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Prior questions or open items from the customer about the expansion were remembered",
          "The customer's current usage and known priorities were kept in mind",
          "Named people on the call addressed with context",
          "Their industry and use cases informed the framing of answers",
          "Prep showed in the framing of answers, not retrofitted later"
        ]
      },
      {
        "key": "solutioning",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Where a question warranted a capability walkthrough, it was crisp and tied to their existing setup",
          "Trade-offs named honestly, not spun",
          "Configuration or customization implications flagged when relevant to their account",
          "Where the fit was imperfect, it was named",
          "Answers didn't sprawl into unrelated capability tours"
        ]
      },
      {
        "key": "value",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Where value questions came up, answers cited concrete outcomes",
          "Numbers were anchored to their own usage or clearly benchmarked",
          "Time-to-value addressed if asked",
          "Business impact tied to the specific expansion capability being discussed",
          "Value language present where relevant, not forced everywhere"
        ]
      },
      {
        "key": "question_handling",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Questions answered accurately, not confidently-adjacent",
          "Answers at the right depth — not too shallow, not lecturing",
          "Where the SE didn't know, they said so — no bluffing",
          "Complex questions broken into parts, not answered in one blob",
          "Follow-up commitments (data, docs, confirmation) captured"
        ]
      },
      {
        "key": "technical_accuracy",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Statements about how the expansion features work were correct and specific",
          "Numbers cited (limits, SLAs, capacity) were accurate for their plan",
          "Where the SE didn't know, they said so and committed to confirm",
          "Product terminology matched documentation",
          "No positioning claims that fail on inspection"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Hard questions about the expansion engaged head-on, not deflected",
          "Answers engaged the specific concern, not a nearby easier one",
          "Limitations named where they existed, not glossed",
          "Roadmap used only where committed",
          "Pushback landed — acknowledged, parked, or resolved"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with framing of what the Q&A would cover",
          "Transitions between questions were smooth, not abrupt",
          "Time managed — questions weren't rushed at the end",
          "SE didn't let one question dominate at the cost of others",
          "Ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Multiple askers were invited — not just the loudest",
          "Follow-up questions welcomed and answered",
          "Silent participants brought in with light invitations",
          "Reactions read — depth adjusted mid-flight",
          "At least one moment of genuine back-and-forth"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Key themes from the Q&A recapped, not just the last question",
          "Follow-up commitments and owners named",
          "Open items or unresolved questions surfaced",
          "Customer's concerns about the expansion addressed in the summary",
          "Under two minutes, and audience nodded"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Specific next step named — follow-up docs, meeting, pilot scope",
          "Owner and date named for each commitment, including the CSM",
          "Confirmed by the customer verbally",
          "Captured in writing",
          "Advances the expansion, not just \"we'll be in touch\""
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just the opening",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  },
  {
    "key": "churn_mitigation",
    "motion": "expansion",
    "name": "Churn mitigation & retention",
    "version": "2.1",
    "totalCredits": 24,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Health score trend, usage decline, and support ticket history reviewed before the call",
          "CSM notes, renewal date, and any competitor or replacement-vendor signal reviewed, not learned on the fly",
          "Named stakeholders addressed with context — especially any new champion after turnover",
          "Root cause hypotheses (adoption gap, unresolved bug, competitive pressure) prepared in advance",
          "Prep showed in first five minutes, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Questions probed why usage or sentiment dropped, not just what's broken today",
          "Whether the drop is technical, adoption, or organizational (champion left, budget cut) was distinguished",
          "Silent or newly-involved stakeholders were drawn into the conversation",
          "Follow-ups pursued vague answers about \"it's just not working for us\"",
          "Silence allowed while they explained frustration, not filled with reassurance too early"
        ]
      },
      {
        "key": "problem_diagnosis",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Symptoms (low adoption, unresolved tickets, missed value) separated from root causes",
          "Whether the risk is product, people, or price was established before proposing a fix",
          "Usage and ticket data used to confirm or challenge the customer's account of the problem",
          "Impact quantified — what's actually at risk: seats, revenue, renewal date",
          "Diagnosis completed and aligned with the CSM before proposing a save plan"
        ]
      },
      {
        "key": "technical_accuracy",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Statements about unresolved issues or bugs were correct and specific, not defensive spin",
          "Status of any open tickets or escalations described accurately",
          "Where the SE didn't know current ticket status, they said so and committed to confirm",
          "Terminology matched documentation and support records, not colloquial approximations",
          "No claims about fixes or timelines that would fail on inspection"
        ]
      },
      {
        "key": "resolution_or_clear_path",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "If a technical issue is the driver, a concrete fix or workaround was proposed with a date",
          "If adoption is the driver, a re-enablement or training plan was proposed with a date",
          "Root cause explained back to the customer, not just the remedy",
          "Interim relief offered if the full fix will take time",
          "Follow-up communication plan agreed, jointly owned with the CSM"
        ]
      },
      {
        "key": "objections",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "\"We're thinking of leaving\" or \"this isn't working\" was heard, not argued down",
          "Answers acknowledged what was true about the complaint first",
          "Where the account was mishandled previously, that was named honestly, not glossed",
          "Nothing resolved with a promise the SE/CSM couldn't keep",
          "Pushback landed — acknowledged, escalated, or resolved with a date"
        ]
      },
      {
        "key": "expectation_setting",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Realistic timelines for the save plan given, not optimistic ones to buy time",
          "Uncertainty about outcome (e.g., pending internal budget decision) acknowledged",
          "What the customer needs to do vs. what Freshworks will do was made explicit",
          "Trade-offs of different remediation paths explained honestly",
          "No overpromising just to get through the call"
        ]
      },
      {
        "key": "escalation_handling",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "Right escalation path identified — product, support, leadership sponsor",
          "Escalation initiated on the call if warranted, not deferred",
          "What the escalated team needs was captured — account history, tickets, usage data",
          "SLA or timeline on the escalation response communicated",
          "SE stayed engaged as the customer's advocate alongside the CSM, not handed off silently"
        ]
      },
      {
        "key": "customer_reassurance",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Customer's frustration and any trust already lost were acknowledged, not deflected",
          "What is being done, right now, to address the risk was communicated",
          "Customer was not blamed, even where their own adoption contributed to the gap",
          "Confidence expressed without minimizing how close to leaving they are",
          "A human, not a script — the SE was present and specific, not generic reassurance"
        ]
      },
      {
        "key": "documentation_followup",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "The save plan — root cause, actions, owners, dates — was written up, not just discussed",
          "Sent to the customer within an agreed timeframe",
          "Internal record updated so the CSM and account team have one source of truth",
          "Names the owner for each next step clearly",
          "Referenced to the account or ticket history for continuity"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Opened with acknowledgment of the relationship's current state, not a generic agenda",
          "Diagnosis and resolution phases signposted",
          "Time managed — call didn't dwell on blame at the cost of the plan",
          "Detours into unrelated feature requests parked, not chased",
          "Ended with a clear, mutually agreed plan"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Customer was heard fully before any defense or explanation was offered",
          "Multiple stakeholders' concerns (champion, admin, exec sponsor) surfaced, not just one voice",
          "SE and CSM coordinated in the room, not talking over each other",
          "Reactions read — tone adjusted when the customer's frustration peaked",
          "At least one moment of genuine, unscripted acknowledgment"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Root cause and agreed save plan recapped in plain terms",
          "Owners and dates for every action named again",
          "Customer's original concerns addressed explicitly in the recap",
          "Any remaining open items or risks surfaced honestly",
          "Under two minutes, and the customer confirmed or corrected"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Specific next step named — what happens next and when, ahead of the renewal date",
          "Owner on the Freshworks side named, not just \"we'll follow up\"",
          "Next checkpoint scheduled during the call, not left open-ended",
          "Customer confirmed the plan verbally",
          "Captured in writing and shared with the account team"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just the opening",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "CSM and other Freshworks attendees also on camera, presenting a united front"
        ]
      }
    ]
  },
  {
    "key": "ai_vision_demo",
    "motion": "expansion",
    "name": "AI Vision Demo",
    "version": "2.1",
    "totalCredits": 29,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Current Freddy/AI module adoption (if any) and account-wide AI readiness reviewed before the call",
          "Ticket volume, deflection rate, or repetitive-query patterns pulled as AI opportunity signals",
          "Named stakeholder's attitude toward AI (champion, skeptic) known from prior notes",
          "Any existing AI initiatives elsewhere in their org referenced specifically",
          "Prep showed in the framing of the opening, not retrofitted later"
        ]
      },
      {
        "key": "questions",
        "credit": 2,
        "category": "discovery_qualification",
        "subParameters": [
          "Open-ended questions probed where manual, repetitive work is happening today",
          "Current attitudes or blockers to AI adoption (trust, budget, data governance) surfaced directly",
          "At least one question uncovered a workflow suited to Freddy Copilot, Self-Service, or Agents",
          "Follow-up questions pursued vague answers about \"we're exploring AI\" internally",
          "Silence was allowed; the SE didn't rush to pitch a feature"
        ]
      },
      {
        "key": "ai_readiness_fit",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Data quality and structure needed for the AI capability were assessed honestly, not assumed",
          "The specific workflow was matched to the right AI lever — self-service, co-pilot, or agent — not a generic pitch",
          "Team's change-readiness (training capacity, process maturity) was gauged",
          "Where fit was weak, that was said plainly rather than oversold",
          "A realistic starting scope (single team, single workflow) was proposed over a big-bang rollout"
        ]
      },
      {
        "key": "ai_solutioning",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "The AI capability was shown solving the specific pain just described, not a generic showcase",
          "Tell-show-tell used — framed, demonstrated, tied back to their own workflow",
          "At least one moment landed as \"that would save us real time,\" not narration",
          "Irrelevant AI features were skipped, not paraded",
          "Demo used data or scenarios resembling their actual account, not a generic sandbox"
        ]
      },
      {
        "key": "technical_accuracy",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Mechanics explained honestly — where the model draws from, what it can't do",
          "Data residency, privacy, and security handling addressed with specifics, not reassurance alone",
          "Where the SE didn't know a technical detail, they said so and committed to confirm",
          "Hallucination risk and human-in-the-loop safeguards explained plainly",
          "No claims about accuracy or capability that would fail on inspection"
        ]
      },
      {
        "key": "cde_build",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "Environment reflected their actual data shapes and terminology, not a generic sandbox",
          "Setup was proportionate to a positioning conversation, not over-built",
          "Nothing on screen contradicted what's known about their real ticket or usage data",
          "Configuration matched their current plan/tier honestly",
          "Environment was ready before the call, no live setup fumbling"
        ]
      },
      {
        "key": "value",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Value quantified in hours, tickets deflected, or headcount saved — not adjectival",
          "Numbers anchored to their own ticket or usage volume, not generic industry stats",
          "At least one value point tied to the champion's or admin's actual KPI",
          "Time-to-value for AI adoption addressed honestly — pilot period, ramp time",
          "Value language repeated more than once, tied consistently to their own data"
        ]
      },
      {
        "key": "case_study",
        "credit": 1,
        "category": "business_value",
        "subParameters": [
          "If used, the reference is an account that adopted the same AI lever from a similar starting point",
          "A specific, credible number cited, not \"significant improvement\"",
          "Industry- or size-adjacent to the customer",
          "Told at the moment it reinforced a capability just shown",
          "Brief — didn't stall the conversation's pace"
        ]
      },
      {
        "key": "objections",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Data privacy, model training, or \"will this replace jobs\" objections engaged directly, not deflected",
          "The specific concern raised was answered, not a nearby easier one",
          "Limitations of the AI capability named honestly where they existed",
          "Roadmap used only where genuinely committed, not as a shield",
          "Pushback landed somewhere — acknowledged, parked with a date, or resolved"
        ]
      },
      {
        "key": "expectation_setting",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Realistic rollout and change-management timeline given, not an optimistic one",
          "Training and enablement needs named explicitly, not glossed",
          "What \"good\" adoption looks like in the first 30/60/90 days was defined",
          "Trade-offs between AI levers (self-service vs. co-pilot vs. agent) explained honestly",
          "No overpromising on accuracy or time savings to close the conversation"
        ]
      },
      {
        "key": "call_flow",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Call opened with a clear purpose — positioning the AI lever, not a generic check-in",
          "Transitions between discovery, demo, and value signposted",
          "Time managed — no rushed final minutes on objections",
          "Skepticism or objection detours bounded, not allowed to consume the call",
          "Call ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Customer talked at least a third of the time, sharing their own AI attitudes and use cases",
          "Their language and examples used back to them",
          "Multiple stakeholders (including skeptics) addressed, not just the enthusiast",
          "Reactions read — pace or depth on technical detail adjusted mid-flight",
          "At least one moment of genuine back-and-forth, not a feature monologue"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Key AI opportunity and expected value recapped, not just features shown",
          "Value points restated in the customer's own language and numbers",
          "Any open trust, data, or governance concerns surfaced, not buried",
          "Next step tied to the specific AI lever discussed",
          "Summary brief — under two minutes"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "A specific next step proposed — AI pilot scope, sandbox trial, or stakeholder demo",
          "It had an owner and a date, not just a verb",
          "Advanced the AI expansion, coordinated with the CSM's account plan",
          "Customer confirmed verbally",
          "Captured in writing before or immediately after the call"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just the opening",
          "Background and framing professional",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees, including the CSM, also on camera"
        ]
      }
    ]
  },
  {
    "key": "demo_cross_sell",
    "motion": "expansion",
    "name": "Demo — Cross sell",
    "version": "2.1",
    "totalCredits": 26,
    "provisional": true,
    "active": true,
    "themes": [
      {
        "key": "research",
        "credit": 1,
        "category": "discovery_qualification",
        "subParameters": [
          "Current product usage and adoption level referenced specifically — modules live, user count, volume",
          "Known product issues or open tickets on the account acknowledged before being raised by the customer",
          "Usage or health data reviewed before the call, not learned on the fly",
          "Named stakeholder on the call addressed with context, not generically",
          "Prep showed in the framing of the demo's opening, not retrofitted later"
        ]
      },
      {
        "key": "cde_build",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "Environment reflects the customer's industry, not a generic sandbox",
          "Data and terminology recognizable to their world, even if not their exact instance",
          "Setup was fit for a positioning demo — not over-built for the time available",
          "Nothing on screen contradicted what's known about their actual account",
          "Environment was ready before the call started, no live setup fumbling"
        ]
      },
      {
        "key": "solutioning",
        "credit": 2,
        "category": "solution_technical_fit",
        "subParameters": [
          "Each feature shown tied to a specific expansion opportunity, not a generic tour",
          "Tell-show-tell used even briefly — framed, shown, tied back",
          "Features irrelevant to their current usage were skipped, not paraded",
          "At least one moment landed as 'that would help us,' not narration",
          "Demo stayed proportionate to a positioning call, not a rebuild of the whole platform"
        ]
      },
      {
        "key": "ai",
        "credit": 3,
        "category": "solution_technical_fit",
        "subParameters": [
          "Every Freddy AI capability relevant to their plan or usage was shown, not just one",
          "Mechanics explained honestly — where it draws from, what it can't do",
          "ROI or time saved was concrete and tied to their own usage, not generic",
          "Data, privacy, or model questions were pre-empted, not dodged",
          "AI was positioned as the primary expansion hook of the call, not a footnote"
        ]
      },
      {
        "key": "slide_deck",
        "credit": 1,
        "category": "solution_technical_fit",
        "subParameters": [
          "Deck was tailored — logo, industry, or account name somewhere",
          "Slides supported the value story, not filler between demo screens",
          "Time on slides proportionate — a few minutes, not the majority of the call",
          "Complex visuals were walked, not read",
          "Deck ended on the expansion ask, not 'thank you'"
        ]
      },
      {
        "key": "value",
        "credit": 3,
        "category": "business_value",
        "subParameters": [
          "Value quantified — hours, tickets, cost, headcount — not adjectival",
          "Numbers anchored to their own usage or clearly benchmarked",
          "At least one value point tied to the champion's or admin's actual KPI",
          "Value framed as what expansion adds, not just what they already have",
          "Value language repeated at least twice across the call, not once"
        ]
      },
      {
        "key": "microstory",
        "credit": 2,
        "category": "business_value",
        "subParameters": [
          "Brief — under 30 seconds, not a slide-backed case study",
          "A specific number or outcome cited, not 'significant improvement'",
          "Industry- or size-adjacent to the customer",
          "Told at the exact moment it reinforced a feature just shown",
          "Didn't stall the demo's pace — in and out, not lingered on"
        ]
      },
      {
        "key": "objections",
        "credit": 3,
        "category": "credibility_objections",
        "subParameters": [
          "Frustration about existing product issues acknowledged first, not argued with",
          "The specific issue raised was engaged, not deflected to 'the team is aware'",
          "A path to resolution or a status update was given, not just sympathy",
          "Limitations were named honestly where they existed",
          "The conversation was steered back to expansion value, not left on the complaint"
        ]
      },
      {
        "key": "comp_pitch",
        "credit": 2,
        "category": "credibility_objections",
        "subParameters": [
          "If a competitor came up, it was addressed specifically, not generically",
          "Differentiation was concrete, not defensive",
          "Their existing tool or workflow was treated with respect",
          "Didn't derail the call into a competitive teardown",
          "Redirected back to their own product's expansion value"
        ]
      },
      {
        "key": "call_flow",
        "credit": 2,
        "category": "communication_control",
        "subParameters": [
          "Call opened with a clear purpose — positioning, not a generic check-in",
          "Transitions between features signposted, not abrupt",
          "Time managed — no rushed final minutes",
          "Product-issue detours bounded, not allowed to consume the call",
          "Call ended when it said it would, or with explicit renegotiation"
        ]
      },
      {
        "key": "customer_engagement",
        "credit": 3,
        "category": "communication_control",
        "subParameters": [
          "Customer talked at least a third of the time, even without formal discovery",
          "Their name and known usage referenced back to them",
          "Multiple stakeholders on the call addressed, not just the loudest",
          "Reactions read — pace or depth adjusted mid-flight",
          "At least one moment of genuine back-and-forth, not monologue-and-nod"
        ]
      },
      {
        "key": "summarise",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "Key expansion opportunities recapped, not just features shown",
          "Value points restated in the customer's language",
          "Any open product concerns surfaced, not buried",
          "Next step tied to the expansion opportunity discussed",
          "Summary brief — under two minutes"
        ]
      },
      {
        "key": "cta",
        "credit": 1,
        "category": "communication_control",
        "subParameters": [
          "A specific next step proposed — feature trial, follow-up, or approval ask",
          "It had an owner and a date, not just a verb",
          "Advanced the expansion — not 'let's stay in touch'",
          "Customer confirmed verbally",
          "Captured in writing before or immediately after the call"
        ]
      },
      {
        "key": "camera_on",
        "credit": 1,
        "category": "communication_control",
        "requiresVideo": true,
        "subParameters": [
          "SE's camera was on",
          "Stayed on for full call, not just the opening",
          "Background and professional framing",
          "Lighting made face visible, not silhouetted",
          "Other Freshworks attendees also on camera"
        ]
      }
    ]
  }
];
