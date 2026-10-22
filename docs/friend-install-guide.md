# Install Guide: AI Job Search on Your Own Laptop

Assalamu Alaikum, and welcome. This guide sets up the job-search assistant on **your laptop**, under **your own Claude account**. Your CV, profile and applications stay on your computer. Nothing is shared with Sherif or anyone else unless you choose to.

- **Time:** about 30–45 minutes, most of it downloads
- **Works on:** macOS, or Windows 10/11
- **Cost:** a Claude **Pro or Max** plan (the free plan does not include Claude Code). The US job-board key has a free tier.

---

## What you'll end up with

| You type | It does |
|---|---|
| `/setup` | Interviews you and builds your profile from your CV, including your **visa situation** (e.g. E-3) |
| `/scrape` | Finds new US jobs (LinkedIn, Indeed, Glassdoor, ZipRecruiter, company sites) |
| `/rank` | Ranks them by fit and **visa-sponsor track record**, and drops jobs you can't legally take |
| `/apply <job link>` | Writes a tailored CV + cover letter (PDF) and your answers for the application form |
| `/interview` | Interview prep and a mock interview |
| `/outcome` | Tracks replies and drafts follow-ups |

You always read everything and click **Submit** yourself. The tool never applies for you.

---

## Step 1: Claude account (5 min)

1. Go to **claude.ai** and sign up or log in with **your own** email.
2. Upgrade to **Pro** (or Max) under Settings → Billing.

## Step 2: Install Git and Python (10 min)

| | macOS | Windows |
|---|---|---|
| **Git** | Open **Terminal** and run `xcode-select --install`, then click Install | Open **PowerShell** and run `winget install --id Git.Git -e` |
| **Python 3.10+** | Download from **python.org/downloads** and run the installer | Download from **python.org/downloads**. ✅ Tick **"Add python.exe to PATH"** |

Close the terminal window and open a new one afterwards.

## Step 3: Download the job-search folder (2 min)

In a new Terminal (Mac) or PowerShell (Windows):

```bash
cd ~/Documents
git clone -b claude/hopeful-goodall-uegtb0 https://github.com/sherifrashad88/ai-job-search.git my-job-search
cd my-job-search
```

This creates a folder called `my-job-search` in your Documents. (Once Sherif merges his changes into the main branch, `-b claude/hopeful-goodall-uegtb0` can be dropped.)

## Step 4: Run the installer (10–20 min)

| macOS | Windows (PowerShell) |
|---|---|
| `bash scripts/install-mac.sh` | `powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1` |

It installs, skipping anything you already have:
1. **Claude Code**, from Anthropic's official installer
2. **Bun**, which runs the job-board search tools
3. **LaTeX**, which turns your CV into a PDF. It asks first, because it's a big download (about 5 GB on Mac). Say **y**.
4. Two small Python packages
5. **Privacy lock:** it disconnects your copy from Sherif's shared repository, so your profile can never be uploaded there by mistake. You can still pull updates from it (Step 10).
6. A readiness check showing what's left

**Windows only:** after MiKTeX installs, open **MiKTeX Console** once. Under Settings, set "Install missing packages" to **Always**.

## Step 5: Check everything is ready

Open a **new** terminal window, go back to the folder, and run:

```bash
cd ~/Documents/my-job-search
python3 tools/doctor.py        # Windows: py tools\doctor.py
```

Every line marked `MISSING` has a `fix:` command under it. Lines marked `TODO` are the next steps below and are fine for now.

## Step 6: Start Claude and build your profile (20 min)

1. Put your **CV (PDF)** in `documents/cv/` and your **LinkedIn PDF** in `documents/linkedin/`. To get the LinkedIn PDF: LinkedIn → your profile → More → Save to PDF.
2. In the terminal, inside the folder, type:

   ```bash
   claude
   ```

3. The first time, it opens your browser to **log in with your Claude account**. Approve it.
4. Type **`/setup`** and choose **Path A** (read my documents folder).
5. Answer its questions. It will ask about:
   - target job titles, cities, remote preference and minimum salary
   - **citizenship and visa route.** For Australian citizens it suggests **E-3**.
   - how strict to be about employers' sponsor history (**prefer** is recommended)
   - whether to **drop** or **flag** postings that say "no sponsorship" (**flag** is recommended for E-3, because many of those lines only mean H-1B)
   - your honest answer to "Will you now or in the future require sponsorship?", which every application form will then use exactly as given
   - 1-page or 2-page resume

**Prefer an app over the terminal?** The **Claude desktop app** can also run Claude Code in this folder. Open it, go to Code, choose the `my-job-search` folder, and type `/setup`.

## Step 7: US job-board key (5 min, recommended)

This key lets one search cover LinkedIn, Indeed, Glassdoor and ZipRecruiter.

1. Go to **rapidapi.com**, search **JSearch**, and subscribe to the free **Basic** plan.
2. Copy your **X-RapidAPI-Key**.
3. Save it on your laptop. Never paste it into the Claude chat.

| macOS | Windows (PowerShell) |
|---|---|
| `echo 'export JSEARCH_API_TOKEN="PASTE-KEY-HERE"' >> ~/.zshrc` | `setx JSEARCH_API_TOKEN "PASTE-KEY-HERE"` |

4. Open a **new** terminal and start `claude` again.

Without the key, the tool still searches LinkedIn and freehire.

## Step 8: Visa-sponsor data (15 min, for E-3 / H-1B / H-1B1)

This gives each employer a sponsor score from US Department of Labor filings. For E-3, every certified filing tagged "E-3 Australian" counts.

1. Search the web for **"OFLC performance data"** to reach the Department of Labor's Foreign Labor Certification **Performance Data** page.
2. Under the **LCA programs (H-1B, H-1B1, E-3)** section, download the disclosure data `.xlsx` files for the **last 3 fiscal years**.
3. Move them into the `sponsor_raw` folder inside `my-job-search`.
4. In the terminal, inside the folder, run:

   ```bash
   python3 tools/sponsor_lookup.py import sponsor_raw --classes e3
   python3 tools/sponsor_lookup.py info
   ```

   (Windows: use `py` instead of `python3`.) The import takes a few minutes per file. `info` should list the fiscal years you downloaded.

5. Try it:

   ```bash
   python3 tools/sponsor_lookup.py top --visa e3 --state NY --limit 20
   ```

Repeat every 3 months with the newest files. Details: `tools/README_SPONSOR_TOOL.md`.

## Step 9: Your weekly routine

| When | Type in Claude | Then |
|---|---|---|
| Monday | `/scrape` then `/rank` | Read the shortlist. 75+ = apply, 60–74 = maybe |
| Same week | `/apply <job link>` for your top 2–3 | Read the PDFs and form answers, edit anything, then **apply yourself** on the company site |
| After applying | `/outcome` | Logs it. `/outcome followup` drafts a follow-up after 10 quiet days |
| Interview invite | `/interview` | Prep pack + mock interview |
| Anytime | `/html-report` | Dashboard of all your applications |

**Signs in the shortlist:**
- ⚠ **FLAG**: the posting says no sponsorship for H-1B, but E-3 may still work. Ask the recruiter before applying.
- ⚠ **UNVERIFIED**: the posting doesn't mention sponsorship. Check the company's careers page or ask.
- **Excluded**: US citizens only, or a security clearance is required.

## Step 10: Getting updates from Sherif

When Sherif says there's an update:

```bash
cd ~/Documents/my-job-search
git pull upstream claude/hopeful-goodall-uegtb0
```

Your profile is kept. If git reports a conflict, ask Claude in the folder: "help me merge this update and keep my profile".

**Want a backup of your profile?** Create a **private** repository on your own GitHub account and push there. Never use a public repository: your profile holds personal data.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `claude: command not found` | Open a new terminal. If it still fails, run `claude doctor` or re-run the installer |
| `bun: command not found` | Open a new terminal (the installer adds it to PATH for new windows) |
| CV won't compile / "lualatex not found" | Install LaTeX (Step 4). On Windows, set MiKTeX to install missing packages **Always** |
| Python command not found on Windows | Use `py` instead of `python3`. Reinstall Python with "Add to PATH" ticked |
| JSearch errors with `MISSING_CREDENTIALS` | Key not set: repeat Step 7, then open a new terminal |
| JSearch `AUTH` error | Wrong key, or not subscribed to the JSearch plan on RapidAPI |
| Sponsor score says "data not loaded" | Do Step 8 |
| Anything else | Run `python3 tools/doctor.py` and share its output (never your API key) with Sherif |

## Your privacy

- Your CV, profile, tracker and applications live **only on your laptop**. The sensitive folders are excluded from git.
- The installer blocks uploading to Sherif's shared repository.
- Claude reads your files to do the work, under your own Claude account and its privacy settings.
- Never store passport or visa numbers in these files. The tool never asks for them.

> The visa information here and in the tool is general guidance, not legal advice. Confirm your E-3 route with an immigration attorney before relying on it.

*Questions? Contact Sherif at [your preferred contact].*
