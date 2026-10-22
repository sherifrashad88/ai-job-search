# US Job Search Playbook for Friends

Operating guide for running this repo's job search for several friends in the **US market**, including visa-sponsored candidates (E-3, H-1B1, TN, H-1B).

- **Owner:** Sherif
- **Branch:** `claude/hopeful-goodall-uegtb0`
- **Last updated:** 2026-10-22

---

## 1. What this repo does (per friend)

One copy of the repo serves **one job seeker**. Each friend gets their own private copy and profile.

| Step | Command | Output |
|---|---|---|
| 1. Build profile | `/setup` | CV, skills, deal-breakers, **work authorization and visa path** (asked automatically) |
| 2. Enrich profile | `/expand` | Extra skills from GitHub, portfolio and certifications |
| 3. Find jobs | `/scrape` | New postings from LinkedIn, JSearch (US) and freehire, de-duplicated |
| 4. Shortlist | `/rank` | Ranked list with fit score, **sponsor verdict**, and eligibility vetoes |
| 5. Apply | `/apply <url or pasted text>` | Fit evaluation, tailored CV + cover letter (PDF), reviewer pass, ATS check, **work-authorization form answers** |
| 6. Interview | `/interview` | Prep pack, likely questions, mock interview |
| 7. Track | `/outcome`, `/outcome followup`, `/html-report` | Status log, follow-up drafts, dashboard |
| 8. Skill gaps | `/upskill` | Missing skills plus a learning plan |

---

## 2. Changes made in this session

| Area | Change | File(s) |
|---|---|---|
| Profile | New **Work Authorization & Sponsorship** block: target market, citizenship, status and expiry, sponsorship need, visa path, sponsor-data class, strictness, minimum record, drop/flag "no sponsorship", clearance, honest form answer | `CLAUDE.md` |
| Onboarding | `/setup` **Section 7b** asks those questions in all three paths, explains E-3 / H-1B1 / TN / H-1B, asks resume length, points at sponsor data | `.claude/commands/setup.md` |
| Sponsor tool | `tools/sponsor_lookup.py`: `import` (DOL LCA + USCIS files), `lookup`, `top`, `check-posting`, `info` | `tools/sponsor_lookup.py`, `tools/README_SPONSOR_TOOL.md` |
| Evaluation | **Sponsorship Gate** before scoring. New **Sponsor Strength** dimension worth 20% of the score when scored | `.claude/skills/job-application-assistant/04-job-evaluation.md` |
| Ranking | Sponsor lookups run in code, before any agent. **Eligibility veto**: before this, `/rank` had no eligibility check at all. New Sponsor column | `.claude/commands/rank.md`, `tools/rank_state.py`, `.claude/agents/posting-scorer.md` |
| Applying | Sponsorship checks in the fit evaluation. Work-authorization form answers always offered to visa candidates | `.claude/commands/apply.md` |
| Documents | US resume rules (no photo, no date of birth, no References section). E-3 / H-1B1 / TN sentence for the cover letter. Exact answers to screening questions. 150–200-word cover note | `05-cv-templates.md`, `06-cover-letter-templates.md`, `08-application-forms.md` |
| Search | **Priority 5 sponsor watchlist** (top E-3 filers by state and title). Scrape marks citizens-only and clearance postings Low | `.claude/skills/job-scraper/search-queries.md`, `.claude/skills/job-scraper/SKILL.md` |
| Job board | New **`jsearch-search`** portal: Google for Jobs results from LinkedIn, Indeed, Glassdoor and ZipRecruiter | `.agents/skills/jsearch-search/` |
| Safety | Permissions allowlisted, sponsor data gitignored | `.claude/settings.json`, `tools/security_guards.py`, `.gitignore` |
| Tests | 33 sponsor-tool tests, 6 ranking tests, 81 JSearch tests. Full suite green (839 Python tests) | `tests/`, `.agents/skills/jsearch-search/cli/tests/` |

---

## 3. US setup for your friends

### 3.1 Job boards

| Board | Status | How it's used |
|---|---|---|
| **JSearch** (LinkedIn, Indeed, Glassdoor, ZipRecruiter, company sites) | ✅ Built in, **needs an API key** | Set `JSEARCH_API_TOKEN`. Free tier is small, so one page per query |
| **LinkedIn** | ✅ Built in | `-l "Houston, TX"`, `-l "United States"` or `-l "Remote"`. Personal use, low volume |
| **freehire.me** (tech only) | ✅ Built in | `--country us`, `--remote remote` |
| **USAJOBS** (federal) | ➕ Add with `/add-portal` | Official API, needs a free key. Federal roles usually require citizenship |
| **Dice** (tech) | ➕ Add with `/add-portal` | IT, software, data |
| **Company career pages** (Greenhouse, Lever, Ashby, Workday) | ✅ Via `/apply <url>` | Best place to apply: keeps the requisition ID |
| Danish boards | ⛔ Off by default | Nothing to do (earlier advice to switch them off is not needed) |

### 3.2 Profile: asked by `/setup`, no manual typing

| Field | Example | Drives |
|---|---|---|
| Target market | United States | US resume and sponsor rules |
| Citizenship | Australian | Visa path suggestion |
| Current status + expiry | Outside US / F-1 STEM OPT until 2027-06 | Urgency, form answers |
| Needs sponsorship | now / future / no | Turns the gate on or off |
| Visa path | E-3 (primary), H-1B (fallback) | Data class, cover-letter sentence |
| Strictness | proven-only / prefer / any | Veto vs score vs ignore |
| Minimum record | 3 filings in 3 fiscal years | proven-only veto |
| "No sponsorship" postings | drop / flag | Gate verdict |
| Clearance | none | Clearance postings fail |
| Honest form answer | Yes | Copied into every application form |
| Resume length | 1 or 2 pages | 1 page → `/add-template` with `Page limit: 1` |

### 3.3 US resume rules (applied automatically)

| Rule | Detail |
|---|---|
| Length | Stock template is 2 pages, which suits about 10+ years of experience. Junior friends: register a 1-page template with `/add-template` |
| Leave off | Photo, date of birth, marital status, nationality, full street address, References section |
| Visa status | Not on the resume. One sentence in the cover letter, plus the form's own questions |
| Spelling | US English, "resume" |

### 3.4 Salary research

- `salary_lookup.py` needs data you load yourself (none ships for the US).
- Free sources: BLS wage data, Levels.fyi (tech), Glassdoor.
- The sponsor tool shows the **median wage employers filed** for E-3 / H-1B roles, which is a useful benchmark.
- Several states require pay ranges in postings, including CA, NY, WA, CO and IL.

---

## 4. E-3 path (first friend)

| Item | Detail |
|---|---|
| Who | Australian citizens |
| Job requirement | Specialty occupation: bachelor's degree or equivalent |
| Employer step | Files a **Labor Condition Application (LCA)** with the Department of Labor |
| Lottery | None. Annual cap of 10,500 initial visas |
| Duration | Up to 2 years, renewable in 2-year increments |
| Spouse | E-3D status, can work in the US (check USCIS for current documentation) |
| Sponsor data | DOL LCA disclosure files, rows tagged `E-3 Australian` |
| Second opinion | AmericaJosh E-3 employer data pages (manual check only, counts approximate) |

**How the repo handles a "we don't sponsor" line for an E-3 friend:**
- The line names **H-1B only** → **FLAG**, with the suggestion to ask the recruiter about an E-3 LCA.
- A general "no sponsorship" → **drop or flag**, per the friend's setting (recommend **flag** for E-3).
- "US citizens only" or "clearance required" → always **FAIL**.
- Posting silent on sponsorship → **UNVERIFIED**: check the careers page before applying.

**Cover-letter sentence (auto-added):**
> "As an Australian citizen I am eligible for the E-3 visa: it needs a Labor Condition Application rather than an H-1B petition, involves no lottery, and can be in place within weeks of an offer."

> Not legal advice. Each friend should confirm their route with an immigration attorney.

---

## 5. SOPs

### SOP-1: Onboard a new friend

| # | Trigger | Action | Condition | Tags / Fields | Owner | Stop logic | Escalation |
|---|---|---|---|---|---|---|---|
| 1 | Friend says yes | Collect CV PDF, LinkedIn PDF, target titles, cities, deal-breakers | — | `friend_name` | Sherif | All 4 received | Missing after 3 days → reminder |
| 2 | Materials received | Create a **private** repo `jobsearch-[friend-name]` from this branch (never a public fork) | Private visibility confirmed | repo URL | Sherif | Repo created | `/setup` warns if origin is a public fork |
| 3 | Repo ready | Put files in `documents/cv/` and `documents/linkedin/` | — | — | Sherif | Files in place | — |
| 4 | Files in place | Run `/setup` (Path A). Answer Section 7b with the friend | Friend available | Work Authorization block | Sherif + friend | Every field filled (no `[...]` left) | Unsure visa route → attorney |
| 5 | Needs sponsorship | Import sponsor data (SOP-2) | Class = e3 / h1b / h1b1 | `sponsor_data.json` | Sherif | `info` shows the class | Import error → check file type |
| 6 | Profile done | Run `/expand`, then `/scrape` + `/rank` | — | — | Sherif | First shortlist sent | Empty results → widen titles or cities |

### SOP-2: Sponsor data refresh (quarterly)

| # | Trigger | Action | Condition | Tags / Fields | Owner | Stop logic | Escalation |
|---|---|---|---|---|---|---|---|
| 1 | New quarter, or new friend with a visa need | Download DOL LCA disclosure `.xlsx` (last 3 fiscal years) from dol.gov → ETA → Foreign Labor → Performance Data | — | `sponsor_raw/` | Sherif | Files saved | Page moved → search "OFLC disclosure data" |
| 2 | H-1B friend only | Download USCIS H-1B Employer Data Hub files | Class = h1b | `sponsor_raw/` | Sherif | Files saved | — |
| 3 | Files saved | `python3 tools/sponsor_lookup.py import sponsor_raw/*` (add `--classes e3` for E-3 only) | `pip install openpyxl` for `.xlsx` | `sponsor_data.json` | Sherif | Summary prints | Slow → save as CSV first |
| 4 | Imported | `python3 tools/sponsor_lookup.py info` | — | fiscal years | Sherif | Latest FY present | Missing class → re-import with `--classes` |
| 5 | Verified | `top --visa e3 --state [ST] --title "[title]"` → refresh Priority 5 watchlist | Needs sponsorship | `[SPONSOR_COMPANY_n]` | Sherif | List updated | — |

### SOP-3: Weekly job-search cycle (per friend)

| # | Trigger | Action | Condition | Tags / Fields | Owner | Stop logic | Escalation |
|---|---|---|---|---|---|---|---|
| 1 | Monday | `/scrape` | Profile complete, JSearch key set | `seen_jobs.json` status `new` | Sherif | Results stored | Portal errors 2x → check key / `/scrape health` |
| 2 | Scrape done | `/rank` | ≥1 new job | `rank_score`, `eligibility_gate`, `sponsor_verdict` | Sherif | Shortlist printed | All vetoed → review drop/flag setting with friend |
| 3 | Shortlist ready | Send top 5 to friend (Strong Fit 75+ = apply, Good Fit 60–74 = maybe) | ≥1 job 60+ | — | Sherif | Friend picks 2–3 | No reply in 3 days → reminder |
| 4 | Friend picks | `/apply <url>` per job | Gate not FAIL | CV + cover letter PDFs, form answers | Sherif | Friend approves the documents | FLAG / UNVERIFIED → ask recruiter first |
| 5 | Approved | Friend submits **by hand** (never automate LinkedIn/Indeed) | — | `status = applied` | Friend | Submitted | Form error → screenshot to Sherif |
| 6 | Submitted | `/outcome` to log it. `/outcome followup` after 10 quiet days | — | tracker row | Sherif | Reply received | 2 follow-ups max, then stop |
| 7 | Interview invite | `/interview` prep pack + mock interview | Invite received | stage | Sherif + friend | Interview done | — |

### SOP-4: Application integrity rules (non-negotiable)

| Rule | Detail |
|---|---|
| Honest sponsorship answer | "Will you now or in the future require sponsorship?" is copied exactly from the profile, never shaded |
| No invented content | CV, letter and forms only claim what the profile supports |
| Untrusted postings | Every posting passes `posting_guard.py`. Hidden text is removed and flagged |
| Manual submit | Candidate clicks Submit. No bots on LinkedIn or Indeed |
| Private data | No passport or visa numbers in the repo. Private repo only |

---

## 6. Running it: Remote Control or cloud

| Option | Steps |
|---|---|
| **Remote Control** (your computer, phone as remote) | Install Claude Code, Python 3.10+, Bun, LaTeX → `git clone` → `cd` into the friend's folder → `python3 tools/install_portal_clis.py` → `claude remote-control` → open the Claude app |
| **Claude Desktop** | Open the friend's folder in the desktop app |
| **Cloud session** | Works for search, ranking and drafting. Can't reach your computer. Network policy may block some sites (the E-3 data site and dol.gov were blocked in this session) |

**Environment variables (set on the machine that runs it):**

| Variable | Needed for | Required |
|---|---|---|
| `JSEARCH_API_TOKEN` | JSearch portal | Yes, for JSearch |
| `JSEARCH_PROVIDER` | `openwebninja` if the key came direct (default `rapidapi`) | No |

---

## 7. Command reference: sponsor tool

```bash
# Build data (once per quarter)
python3 tools/sponsor_lookup.py import sponsor_raw/*.xlsx --classes e3
python3 tools/sponsor_lookup.py info

# One employer
python3 tools/sponsor_lookup.py lookup "Atlassian" --visa e3 --title "Data Analyst" --json

# Top E-3 sponsors in New York for a role
python3 tools/sponsor_lookup.py top --visa e3 --state NY --title "data analyst" --limit 30

# Check a posting's text
python3 tools/sponsor_lookup.py check-posting --in posting.txt --visa e3 --needs-sponsorship yes --no-sponsorship flag
```

| Verdict | Meaning | Score |
|---|---|---|
| Strong | At or above the bar (E-3: 5 filings in 3 FYs; H-1B: 25) | 90 (+10 same-title filing) |
| Some history | 1+ filings | 55–85 |
| None found | No filings under that name (weak evidence, not a refusal) | 30 (E-3/H-1B1), 15 (H-1B) |
| n/a | TN / O-1 / L-1: no public employer data | Skipped |

---

## 8. Open items

| # | Item | Owner | Next step |
|---|---|---|---|
| 1 | Get a JSearch API key (RapidAPI free tier) | Sherif | Subscribe → set `JSEARCH_API_TOKEN` |
| 2 | Download first DOL LCA files and run `import` | Sherif | SOP-2 |
| 3 | Daily automatic scan (e.g. 7:00 AM CST) per friend | Sherif | Ask Claude to set a scheduled task once repos exist |
| 4 | Telegram / email digest of daily matches | Sherif | Not built. Phase 2 of the web-app blueprint |
| 5 | Per-friend cost tracking | Sherif | One Anthropic API key per friend in a "Job Hunter" Console workspace, monthly usage report |
| 6 | Merge this branch | Sherif | Open a PR from `claude/hopeful-goodall-uegtb0` when ready |
| 7 | Web app (Next.js + Supabase + Stripe) | Later | Reuse `04-job-evaluation.md`, `apply.md`, `posting_guard.py`, `sponsor_lookup.py` as the brain |

---

## 9. Message template to friends

> Salam [Name], I'm using an AI job-search tool that finds matching US jobs, scores your fit and visa-sponsor chances, and writes a CV and cover letter tailored to each posting. Want me to set it up for you? Send me:
> 1. Your latest CV (PDF)
> 2. Your LinkedIn profile as a PDF (Profile → More → Save to PDF)
> 3. Target job titles and cities (or remote)
> 4. Your citizenship and current US visa status (if any)
> 5. Deal-breakers (minimum salary, commute, hours, etc.)
>
> I'll book a 20-minute call to finish your profile, then send your first ranked shortlist within [X days].
