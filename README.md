# Intain Verify

Loan Data Verification Copilot. Three role-based portals + AI-assisted exception review + hash-chained audit trail.

## Prerequisites

- **Node.js 18+** (24 also works) — [nodejs.org](https://nodejs.org)
- **MongoDB** — local or an Atlas connection string
- **npm 9+**

---

## Setup

```powershell
# 1. Copy the env template
Copy-Item .env.example .env

# 2. Open .env and fill in MONGODB_URI and JWT_SECRET (see template below)
notepad .env

# 3. Install + verify env + seed the demo dataset in one command
npm run setup

# 4. Boot backend (:4000) and frontend (:5173)
npm run dev
```

Open **http://localhost:5173** and click any credential shown on the home page — the login form auto-fills.

### `.env` template

```env
# --- Backend server ---
PORT=4000

# --- MongoDB ---
# Local:  mongodb://localhost:27017/intain_lvc
# Atlas:  mongodb+srv://<user>:<pass>@<cluster>/<dbname>?retryWrites=true&w=majority
MONGODB_URI=mongodb://localhost:27017/intain_lvc

# --- Auth ---
# Any random 32+ char string
JWT_SECRET=change_me_to_a_long_random_string

# --- AI Review Assistant ---
# false → deterministic fallback (fully demoable, no key needed)
# true  → real LLM via the OpenAI-compatible endpoint below
AI_ENABLED=false
AI_API_KEY=
AI_API_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

**Live AI providers** (all use the same OpenAI-compatible wire format):

| Provider | `AI_API_BASE_URL` | Example `AI_MODEL` |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai/deployments/<dep>` | your deployment name |

---

## Testing + running with seed data

```powershell
# End-to-end assertion pass (39 assertions, ~2 min)
npm run smoke

# Wipe DB and rebuild the demo dataset (~30 s):
# 60 loans, 15 rules, 40 exceptions, 3 curated verified records, 18 dev-log entries
npm run reset

# All-in-one: reset then boot both servers
npm run start:demo

# Verify env before running anything
npm run check:env
```

**Seeded logins** (auto-filled from the home page):

| Email | Password | Role |
|---|---|---|
| `operator@intain.test` | `Operator@123` | operator |
| `reviewer@intain.test` | `Reviewer@123` | reviewer |
| `consumer@intain.test` | `Consumer@123` | consumer |
| `admin@intain.test` | `Admin@1234` | admin |

---

## Top features

- **Three role-based portals** with distinct visual language (Operator / Reviewer / Consumer), plus an admin surface for rule authoring.
- **Config-driven validation engine** — 15 rules loaded from `samples/validation_rules.json` at runtime, with a small expression grammar (`isEmpty`, `equals`, `crossFieldCompare`, `conflictsWithOtherSource`, etc.).
- **AI Review Assistant** with a visible reasoning chain, per-field Accept / Edit / Reject controls, a source-hint line, and a confidence bar. Fully provider-agnostic (OpenAI / Gemini / Azure), with a deterministic fallback that keeps the UI demoable when no key is present.
- **Side-by-side reconciliation view** between the loan tape and the fresher servicer update, with one-click resolution per field.
- **Hash-chained audit trail** — every state change is a hash-linked event; `chain-check`, `verifyChain`, and a live `demo:tamper` script demonstrate tamper-evidence.
- **Trust score** per verified loan (completeness + consistency + freshness + review coverage) plus a portfolio aggregate on the Consumer dashboard.
- **Converse-with-data** — natural-language queries translated to a sanitized Mongo filter, restricted to verified loans only.
- **In-app development log** at `/dev-log` with a "caught bad AI" surface for auditability of the build itself.
- **Read-only exports** — CSV and JSON bundle downloads, the JSON bundle sealed with a portable hash the client can re-verify.

---

## Where to look

| URL | What you'll see |
|---|---|
| `/operator/uploads` | Three-CSV ingest with client-side sha256 + preview → commit |
| `/operator/dashboard` | Import health, freshness bar, recent imports |
| `/reviewer/queue` | Blocking-first exception queue with `j`/`k` keyboard nav |
| `/reviewer/loans/:loanId?exception=…` | **The AI Review Panel** — reasoning chain, per-field controls, AI history tab |
| `/reviewer/reconciliation` | Side-by-side loan-tape vs servicer-update diff |
| `/reviewer/dashboard` | Queue health, AI-usage stacked bar, top rules |
| `/consumer/verified` | Verified records browse with trust badges + chain-ok chips |
| `/consumer/verified/:loanId` | Snapshot, chain proof, full audit timeline, trust breakdown |
| `/consumer/trust` | Portfolio gauge + distribution + lowest-trust leaderboard |
| `/consumer/audit` | Any verified loan's full hash-chained history |
| `/consumer/converse` | Natural-language query surface |
| `/consumer/export` | Bundle preview with client-side hash re-verification |
| `/admin/rules` (admin only) | Ask AI to draft a rule → dry-run → approve → activate |
| `/dev-log` | 18-entry development log |
| `/dev-log/caught-bad-ai` | Where the AI was caught being wrong |

---

## Troubleshooting

**`MongoServerError: connection refused`** — MongoDB not running or wrong URI. Test with `npm run check:env`. If using Atlas, whitelist your IP.

**Port 4000 already in use:**
```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

**AI panel stuck on the "fallback" chip after enabling a key** — kill the backend and `npm run dev` again; env is read at startup.

**`concurrently: command not found`** — `npm install` didn't finish. Re-run `npm install` from the repo root.
