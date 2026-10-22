# US Visa-Sponsor Lookup Tool

## What is this?

`tools/sponsor_lookup.py` answers two questions for a candidate who needs US work-visa sponsorship:

1. **Has this employer sponsored my visa class before?** (`lookup`, `top`) - counted from public government filings, so the answer is a number with a fiscal-year window, not a guess.
2. **What does this posting say about sponsorship?** (`check-posting`) - a deterministic phrase scan that catches "no sponsorship", "US citizens only" and "clearance required" before any scoring tokens are spent.

It feeds the **Sponsorship Gate** and the **Sponsor Strength** dimension in `.claude/skills/job-application-assistant/04-job-evaluation.md`, which `/rank` and `/apply` run for every posting when your profile says you need sponsorship.

**Optional.** Without the data file, `check-posting` still works (it needs no data), and the Sponsor Strength dimension is skipped with a note.

## Which data covers which visa

| Visa path (`--visa`) | Public employer data | Source |
|---|---|---|
| `e3` - E-3, Australian citizens | ✅ Certified LCAs tagged `E-3 Australian` | DOL LCA disclosure files |
| `h1b` - H-1B | ✅ USCIS petition approvals/denials, plus certified LCAs | USCIS H-1B Employer Data Hub + DOL LCA files |
| `h1b1` - H-1B1, Chile / Singapore | ✅ Certified LCAs tagged `H-1B1 Chile` / `H-1B1 Singapore` | DOL LCA disclosure files |
| `tn`, `o1`, `l1` | ❌ Not published per employer | `lookup` says so instead of reporting "None found" |

**E-3 in one paragraph.** E-3 is for Australian nationals in a specialty occupation (a job that needs at least a bachelor's degree or equivalent). The employer files a Labor Condition Application (LCA) with the Department of Labor, then the candidate applies for the visa. There is no lottery, stays are granted in increments of up to two years and can be renewed, and the program has a 10,500-a-year cap on initial visas. Because every E-3 starts with an LCA, the DOL disclosure files are the employer record for E-3. Spouses get E-3D status and can work in the US (check USCIS for how that work authorization is currently documented). Confirm current rules on the USCIS and State Department sites before relying on them.

**What a filing count means.** A certified LCA shows the employer started the process for that visa class, and the date and job title it filed for. It does not show that a visa was issued. A missing record is weak evidence, not a refusal: the employer may file under another legal name, or may never have hired an Australian yet. The tool scores "None found" low but never zero for that reason.

## One-time setup (about 15 minutes)

1. **Download the DOL LCA disclosure files.** Go to the Office of Foreign Labor Certification **Performance Data** page (dol.gov → ETA → Foreign Labor → Performance Data). Under the LCA programs (H-1B, H-1B1, E-3) section, download the disclosure data `.xlsx` for the last three fiscal years. OFLC publishes these quarterly. Put them in a `sponsor_raw/` folder in the repo root, which is gitignored.
2. **H-1B only: download the USCIS H-1B Employer Data Hub files.** Search for "USCIS H-1B Employer Data Hub" and download the data file for each fiscal year you want. Put them in `sponsor_raw/` as well.
3. **Build the lookup file:**

   ```bash
   python3 tools/sponsor_lookup.py import sponsor_raw/*.xlsx sponsor_raw/*.csv
   ```

   Reading `.xlsx` needs `pip install openpyxl`. A full-year file has hundreds of thousands of rows and takes a few minutes. You can also open it and save it as CSV first. If the friend only needs E-3, add `--classes e3` to cut time and size. Re-run `import` each quarter with all the files: duplicate case numbers across overlapping files are counted once.
4. **Check it:** `python3 tools/sponsor_lookup.py info` lists the fiscal years and visa classes covered, and the newest filing date.

## Commands

```bash
# One employer's record for your visa path; --title checks for same-role filings
python3 tools/sponsor_lookup.py lookup "Atlassian" --visa e3 --title "Data Analyst" --json

# Your strict-mode minimum: at least 3 filings in the last 3 fiscal years
python3 tools/sponsor_lookup.py lookup "Canva" --visa e3 --min 3 --json

# Employers with the most E-3 filings, by state and role - a target-company list
python3 tools/sponsor_lookup.py top --visa e3 --state NY --title "data analyst" --limit 30

# Scan a posting's text (stdin or --in FILE) against your profile settings
python3 tools/sponsor_lookup.py check-posting --visa e3 --needs-sponsorship yes --no-sponsorship flag --json < posting.txt
```

### `lookup` output

| Field | Meaning |
|---|---|
| `verdict` | `Strong` (filings in the window at or above the bar), `Some history` (at least 1), `None found`, or `n/a` for visa paths with no public data |
| `score` | 0-100 Sponsor Strength score used by `04-job-evaluation.md` (Strong 90, Some history 55-85, None found 30 for E-3/H-1B1 or 15 for H-1B; +10 when a same-title filing exists) |
| `filings_in_window` | USCIS approvals for H-1B when that data is loaded, otherwise certified LCAs |
| `meets_minimum` | whether the record clears your `--min`, used by strict ("proven sponsors only") mode |
| `match` | `exact`, `family` (names that start with your query, e.g. "Amazon" → "Amazon.com Services LLC" + "Amazon Web Services, Inc."), `contains`, or `none` with spelling suggestions |
| `entities` | every matched legal name with per-year counts, top job titles, top worksite states and median offered wage |
| `notes` | partial-year warnings, aggregated-name warnings, what "None found" does and does not mean |

`--strong` changes the bar for `Strong` (defaults: E-3 5, H-1B 25, H-1B1 5 filings in the window, because E-3 volumes are a small fraction of H-1B's). `--years` sets the fiscal-year window (default 3, ending at the newest year in the data).

### `check-posting` verdicts

| Verdict | When |
|---|---|
| `FAIL` | Citizens or permanent residents only. Security clearance required, unless `--has-clearance`. "No sponsorship" while you need it and your profile says drop. |
| `FLAG` | "No sponsorship" while your profile says flag. Also an E-3/H-1B1 candidate facing a line that names **H-1B only**: that is a different, cheaper filing, so worth asking the recruiter. |
| `PASS` | Says sponsorship is available, or you don't need sponsorship |
| `UNVERIFIED` | Silent on sponsorship. Silence is not permission: check the careers page or ask. |

"Must be a US citizen **or** authorized to work in the US" is treated as a work-authorization line, not a citizens-only one. The application question "Will you now or in the future require sponsorship?" is reported as `asks_sponsorship_question`, never as a refusal. Answer it exactly as your profile records it.

## Second opinions (manual)

Third-party explorers built on the same OFLC data are useful for a quick visual check, for example AmericaJosh's E-3 employer data pages, MyVisaJobs, and H1BGrader. Treat their counts as approximate: they aggregate and update on their own schedules. The tool's numbers come only from the files you imported.
