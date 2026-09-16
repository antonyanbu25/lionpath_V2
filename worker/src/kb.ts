// Freshworks CX knowledge base — ported and condensed from
// ~/Projects/rfp-automation/knowledge/offerings.md, scoped to what pre-demo prep needs:
// products, capabilities, industry fit, competitor differentiators, references, compliance.
// This is the grounding context so the model's demo plan and differentiators are accurate,
// not invented. Keep in sync with offerings.md when the source is updated.

export const FRESHWORKS_KB = `# Freshworks CX — Solution Engineering Knowledge Base

## Products (CX suite)

### Freshdesk Omni
Omnichannel support platform unifying email, chat, voice, WhatsApp, social (Facebook,
Instagram), and web into a single agent workspace (Freshdesk Command Center). Combines
conversational support (Freshchat) + ticketing in one SKU with Freddy AI embedded.
Key capabilities:
- Unified inbox across all channels; Omniroute skill-based auto-routing
- Freddy AI Agent — autonomous chat/email deflection bot (no-code AI Agent Studio)
- Freddy AI Copilot — real-time agent assist: reply suggestions, ticket summaries, tone, live translation
- Freddy AI Insights — proactive analytics, anomaly detection, CSAT trends
- SLA management, workflow automation (no-code, event + time triggers)
- Multilingual knowledge base with AI-assisted articles; CSAT surveys; custom dashboards
- Collision detection; custom objects; WhatsApp campaigns (Pro+)
- 1,200+ marketplace apps; serverless custom-app SDK
- Target: mid-market (100–2,500) and enterprise (2,500+); primary SE motion is 50+ agents
- Deployment: cloud-only (AWS); data residency US/EU/India/Australia

### Freshdesk (email-first ticketing)
Foundational help desk for email/web support. Converts email, web forms, social into tickets.
No native live chat/voice (those need Omni or separate Freshchat/Freshcaller).
- Shared inbox, automations (Dispatch'r/Observer/Supervisor), SLA policies, KB/self-service
- Canned responses, custom fields/forms, CSAT, analytics
- Freddy Copilot + Agent available as add-ons
- Target: SMB to mid-market; email-only enterprise teams

## Freddy AI (differentiated, embedded — not a bolt-on)
- Agent (deflection), Copilot (agent assist), Insights (analytics)
- Deployments show 40–45% agent productivity gains; Panasonic NA handles 75%+ queries via Freddy
- No-code AI Agent Studio for bot customization without engineers

## Integrations
CRM: Salesforce, HubSpot, Freshsales, Zoho CRM, Pipedrive, MS Dynamics.
Collaboration: Slack, Teams, Jira (two-way), Azure DevOps.
E-commerce: Shopify, WooCommerce, Magento. SSO: Okta, OneLogin, Azure AD, Auth0, Google, SAML.
Telephony: Amazon Connect, Freshcaller, Twilio. REST API + webhooks + serverless SDK.

## Compliance / security
SOC 2 Type II, SOC 1 Type II, ISO 27001/27701, PCI DSS, GDPR (EU data residency + DPA),
HIPAA (Enterprise + BAA), CCPA. AES-256 at rest, TLS 1.2+ in transit, RBAC, audit logs,
annual pen testing. 99.9% uptime SLA.

## Industries served well (and the hook for each)
- Retail/e-commerce: high-volume chat + ticket deflection; Shopify/WooCommerce; Freddy handles ~53% of retail queries
- SaaS/technology: developer-friendly APIs, Jira/Slack, PLG-aligned pricing
- Financial services/fintech: HIPAA/PCI, audit logs, high CSAT (Fairmoney: 20% faster response)
- Education: institutions like Kent State, D'Youville (San Ramon Valley HS: 50% IT time saved via Copilot)
- Healthcare: HIPAA Enterprise + BAA, routine-query deflection
- Travel/hospitality: omnichannel, AI deflection >50%
- Logistics: WhatsApp + email, order-status automation
- Gaming/media: high-volume chat, multilingual bot deflection

## Poor fit (flag if the prospect needs these)
- On-premise / private-cloud or sovereign-cloud (no FedRAMP; cloud-only)
- Deep native ERP (SAP/Oracle) out of the box
- Voice-first CCaaS with IVR as the primary channel (Freshcaller is not a full Genesys/Amazon Connect replacement)

## Competitive differentiators
vs Zendesk:
- Unified CX platform (Omni combines chat + ticketing + AI in one SKU); Zendesk needs multiple products
- Lower TCO — Omni ~$29/agent vs Zendesk Suite $55+/agent for comparable coverage
- Freddy AI embedded, not a bolt-on; faster time-to-value (2–6 wks mid-market vs months)
- Switchers: Maisons du Monde, Landmark Group, Cineworld
vs Intercom:
- Full ticketing + phone, not chat-first; agent-focused (not just self-serve); true omnichannel
vs Zoho Desk:
- Deeper functionality + better UX; unified platform (not a suite patchwork); stronger enterprise + reporting

## Reference customers (for social proof in demos)
- Hobbycraft (UK retail): Freddy answers ~30% of questions
- Panasonic NA: Freddy Agent handles 75%+ of queries autonomously
- NASDAQ Europe: 97% resolution SLA adherence, 93% CSAT
- Fairmoney (fintech): 20% faster response, 15% CSAT improvement
- Maisons du Monde: migrated off Zendesk to Omni, reduced TCO
- Forrester TEI (composite): $1.3M savings from self-service/channel shift, $493K from agent efficiency
`;
