# SE Singha Paathai — Team Share Pack

**Freshworks Solution Engineering · Internal MVP**

**GitHub:** https://github.com/kuttas246/se-singha-paathai

---

## What is SE Singha Paathai?

SE Singha Paathai is an internal portal for Freshworks Solution Engineers. It brings **pre-call prep** and **post-call analysis** into one dashboard.

- **Pre-call** — Enter a company and prospect email to get a researched demo prep brief.
- **Post-call** — Paste a Zoom recording link to get a call summary, next steps (including a follow-up email draft), and a Quality Coach scorecard.

The goal is to save SEs time after every customer conversation and give consistent, evidence-based coaching feedback — without replacing the SE or the manager.

---

## Post-Call Analysis — What It Does (Non-Technical)

After a customer demo or discovery call, an SE pastes the **Zoom cloud recording share link** (and passcode if needed). In about **10–25 seconds**, the system:

1. Fetches the audio transcript from Zoom
2. Reads what was actually said on the call
3. Returns three outputs:

### 1. Call Summary

A factual recap — not a generic CRM blurb. Includes customer context, attendees, key topics, pain points, objections, competitive mentions, decisions made, and open questions.

### 2. Next Steps

Action-oriented output the SE can use immediately:

- Prioritized SE tasks (High / Medium / Low)
- AE actions and customer commitments
- A suggested follow-up email (ready to copy)
- Paste-ready CRM notes

### 3. Quality Coach Scorecard

Coaching feedback modeled on how an SE manager would QA a recorded demo:

- Overall score (0–10) with a label (Excellent, Strong, Good, Developing, Needs focus)
- Scores across six dimensions: Discovery, Demo alignment, Objections, Value articulation, Next-step clarity, Talk balance
- Written feedback with transcript evidence for each dimension
- Strengths, improvements, and missed opportunities

**Important:** The SE does not upload files manually in the default flow. They paste the Zoom link from the "recording is ready" email or from Zoom → Cloud Recordings → Share.

**Dashboard and history:** Every analyzed call is saved under the SE's login. The dashboard shows cumulative metrics (average score, strongest dimension, focus area, score trend). History appears in the sidebar (newest first).

---

## How SEs Use It (Daily — No Setup)

SEs do **not** need Node.js, terminals, API keys, or git. They only need a browser.

| Step | Action |
|------|--------|
| 1 | Open the portal URL in Chrome or Edge |
| 2 | Log in with demo credentials (see below) |
| 3 | Go to **New analysis** |
| 4 | Paste the Zoom recording URL (and passcode if not embedded in the link) |
| 5 | Click **Analyze call** and wait ~10–25 seconds |
| 6 | Review summary, next steps, and Quality Coach; copy email or print/PDF |
| 7 | Check **My dashboard** and **History** for past calls |

### Portal URL (team demo / VPS)

**https://lionpath.benjaminsquare.com**

Hosted on a Netcup VPS via Docker — see **[docs/VPS_DEPLOY.md](./docs/VPS_DEPLOY.md)** for setup.

*(Local developer testing: http://localhost:8788 — developers only)*

### Demo login credentials

| Role | Email | Password |
|------|-------|----------|
| SE | se@freshworks.com | se123 |
| SE (alt) | se1@freshworks.com or se2@freshworks.com | se123 |
| Manager | manager@freshworks.com | mgr123 |

These are dummy credentials for MVP demos — not production SSO. SEs never handle API keys; all AI calls run through the server.

### What SEs need on their laptop

**Nothing** once the portal is hosted. Just the URL and login above.

---

## Windows Setup for Developers (Local Testing)

For developers who want to run the app on their own Windows laptop. **No administrator rights required** — install Node.js for your user account only.

### Prerequisites

- **Node.js 18+** — LTS installer from https://nodejs.org/ (user-level install, no admin)
- **Git** — to clone the repo
- **Gemini API key** — from https://aistudio.google.com/apikey (developers only; never share in Slack, email, or git)

### Step 1 — Clone the repo

```powershell
git clone https://github.com/kuttas246/se-singha-paathai.git
cd se-singha-paathai
```

### Step 2 — Add your API key (never commit this file)

```powershell
cd worker
copy .dev.vars.example .dev.vars
```

Open `worker\.dev.vars` in a text editor and set your key:

```
GEMINI_API_KEY = "your-key-from-google-ai-studio"
```

The `.dev.vars` file is gitignored and stays only on your machine.

### Step 3 — Open two terminal windows

You need **both** servers running at the same time.

**Terminal A — Worker (API)**

```powershell
cd worker
npm.cmd install
npm.cmd run dev
```

Wait for: `Ready on http://localhost:8787`

**Terminal B — Web (UI)**

```powershell
cd web
npx wrangler pages dev .
```

Wait for: `Ready on http://localhost:8788`

**Why npm.cmd?** On Windows PowerShell, `npm.cmd` avoids execution-policy issues. Use `npm.cmd` instead of `npm` if `npm` is blocked.

### Step 4 — Open the app

1. Go to **http://localhost:8788** in Chrome or Edge (not 8787)
2. Log in with **se@freshworks.com** / **se123**

**8788 vs 8787:** Open **8788** in your browser (the app). **8787** is the API running in the background; the web UI calls it automatically.

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|--------------|-----|
| **8788 not loading** / blank page | Web server not running | Start Terminal B: `cd web` → `npx wrangler pages dev .` — wait for Ready on 8788 |
| **8788 not loading** / connection refused | Wrong URL | Use **http://localhost:8788**, not 8787 |
| **Failed to fetch** in the app | Worker API not running | Start Terminal A: `cd worker` → `npm.cmd run dev` — wait for Ready on 8787, then refresh the browser |
| **Failed to fetch** / CORS error | Mixed hostnames | Use **localhost** consistently — do not mix `localhost` and `127.0.0.1` in the same session |
| Login page loads but prep/analysis fails | Missing API key | Check `worker\.dev.vars` has a valid `GEMINI_API_KEY`; restart the worker after editing |
| Port already in use | Old process on 8787/8788 | Close old terminals (Ctrl+C) or stop the process using that port |
| Changes not picked up | Dev server cached | Stop both terminals (Ctrl+C) and restart |
| **Incognito / private window** | History not saved | Use a **normal browser window** for saved history. Incognito clears site data when closed. The login page shows this reminder. |
| Tunnel URL down (lionpath.benjaminsquare.com) | VPS offline or DNS issue | Check `docker compose ps` on VPS — see docs/VPS_DEPLOY.md |

---

## Boss FAQ — One-Liners

**Why a Cloudflare Worker instead of calling the AI from the browser?**

API keys must never live in the browser. Firebase's free tier blocks outbound LLM calls from Cloud Functions; the Worker's free tier allows them. One server-side pipeline gives every SE the same schema, scoring, and prompt calibration.

**Why Gemini for post-call?**

Post-call is structured JSON extraction from a transcript — no web research needed. Gemini Flash Lite is fast (~8–20 seconds), cost-efficient at SE volume, and supports enforced JSON schema output. Claude remains available as a fallback in the same Worker.

**Google AI Studio vs Vertex AI?**

**AI Studio** — Used for MVP and local dev. Free-tier friendly, instant API key setup, no GCP billing project required for demos.

**Vertex AI** — The production path at scale. Same Gemini models, but with enterprise GCP billing, IAM, audit logs, and SLAs. Migrate when volume and compliance require it.

**How long does analysis take?**

~10–25 seconds total: 2–5 seconds to fetch the Zoom transcript, 8–20 seconds for AI analysis.

**Where is call data stored?**

On the VPS: post-call history is saved server-side as JSON files under `/var/lib/se-paathai/history` (one file per SE email, restricted permissions). Zoom links and transcripts are processed in memory and not stored as raw files. For local dev without VPS, history may use browser localStorage.

**Is the Quality Coach score official?**

Not yet. It is MVP AI-assisted QA designed to spark coaching conversations — not to replace manager judgment or formal performance reviews.

**What does an SE need on their laptop?**

Nothing once deployed. SEs open the portal URL in a browser — no npm, no API keys, no local setup.

---

## Quick Reference

| What | Value |
|------|-------|
| Team portal URL | https://lionpath.benjaminsquare.com |
| SE login | se@freshworks.com / se123 |
| Local dev URL (developers) | http://localhost:8788 |
| Local API (background) | http://localhost:8787 |
| GitHub repo | https://github.com/kuttas246/se-singha-paathai |
| API key location (devs only) | worker\.dev.vars (gitignored, never commit) |

---

## Who Does What

| Task | SE | Developer / IT |
|------|----|----------------|
| Open portal and log in | Yes | — |
| Paste Zoom link and review results | Yes | — |
| Run npm / local servers | — | Yes (testing only) |
| Store Gemini API key | — | Yes (server-side only) |
| Enable Zoom cloud recording + transcript | — | Zoom admin |
| Host VPS / production deploy | — | Yes |

---

*Document version: MVP demo pack. For full technical setup, see TEAM_SETUP.md and docs/POST_CALL_OVERVIEW.md in the GitHub repo.*
