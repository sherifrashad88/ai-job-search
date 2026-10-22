---
name: jsearch-search
version: 1.0.0
description: >
  Use this skill to search live job listings in the United States (and other
  countries via --country) through the JSearch API, which aggregates Google for Jobs
  - LinkedIn, Indeed, Glassdoor, ZipRecruiter, company career sites and smaller
  boards - into one structured feed, or to look up a specific JSearch posting by id.
  Needs a JSearch API key in JSEARCH_API_TOKEN; every call spends quota. Trigger
  phrases: find a job in the US, US job search, jobs in <city>, <ST>, American job
  openings, hiring near me in <US city>, Indeed / Glassdoor / ZipRecruiter jobs,
  Google jobs search, remote jobs in the US, "are there any <role> jobs in
  <city, state>", entry-level / no-degree jobs, look up this JSearch job id.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/jsearch-search/cli/src/cli.ts *)
---

# JSearch Search Skill (US market)

Search live job listings through **JSearch**, a jobs API by OpenWeb Ninja sold on
RapidAPI (and directly). JSearch queries **Google for Jobs**, so one request covers
postings Google indexed from **LinkedIn, Indeed, Glassdoor, ZipRecruiter, company
career pages (Greenhouse, Lever, Workday, ...) and many smaller boards**, returned as
structured JSON: title, employer, location, posting date, salary range when
published, employment type, remote flag, and every apply link Google found.
It is the US-first portal of this repo; `--country` covers other markets too.

Zero runtime dependencies - it runs with just `bun`. Unlike the other portal skills
it **needs an API key**.

## ⚠️ Setup: API key required, every call is billed

1. Subscribe to **JSearch** on RapidAPI (the free **Basic** plan is enough to start)
   or buy a key directly from OpenWeb Ninja.
2. Export the key in the shell that launches Claude Code:

   ```bash
   export JSEARCH_API_TOKEN=<your key>          # required
   export JSEARCH_PROVIDER=openwebninja         # only if the key came from OpenWeb Ninja directly
   ```

   | Variable | Required | Values |
   |----------|----------|--------|
   | `JSEARCH_API_TOKEN` | yes | Your RapidAPI key (`X-RapidAPI-Key`) or OpenWeb Ninja key (`x-api-key`). |
   | `JSEARCH_PROVIDER` | no | `rapidapi` (default, host `jsearch.p.rapidapi.com`) or `openwebninja` (host `api.openwebninja.com`). |

   Never paste the key into chat, a flag, a committed file, or a test fixture. The
   CLI reads it only from the environment, sends it only to the provider host, and
   redacts it from every message it prints. If it is unset, every command exits 1
   with `MISSING_CREDENTIALS` before any request.

3. **Mind the quota.** Every `search` and every `detail` is one request against
   your plan, and the free tier's monthly allowance is small - check the current
   number on your plan page rather than assuming one. `--pages N` fetches N result
   pages in one call and is billed for more than one request, so leave it at the
   default `1`. For `/scrape`: **one search per query, one page, `--limit 20`**, and
   `detail` only for shortlisted jobs, never in a loop over every hit.

## Applying: by hand, always

A result's `url` is the **publisher's apply link** - very often a LinkedIn or Indeed
posting, sometimes Glassdoor/ZipRecruiter, sometimes the employer's own ATS
(`apply_is_direct: true`). This skill only reads search results through the API; it
never visits those boards. **The candidate opens apply links and applies by hand.
Never automate logins, applications, or page scraping on LinkedIn, Indeed, or any
other board.** Where `detail` lists several `apply_options`, prefer the employer's
direct link (`is_direct: true`) - aggregator copies often drop the requisition ID
and grade.

## When to use this skill

- US job search by role and city/state (`-l "Houston, TX"`), or remote-only
- Recency-scoped runs (`--jobage 14` for `/scrape`'s 14-day window)
- Filtering by employment type (full-time, part-time, contract, internship) or by
  experience/degree requirements (entry-level, no degree)
- Reading one posting's full description, highlights and every apply option by id

## Commands

### Search job listings

```bash
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "<keywords>" [-l "<city, ST>"] [flags]
```

| Flag | Alias | Description |
|------|-------|-------------|
| `--query <text>` | `-q` | **Required.** Role / keywords, e.g. `"data analyst"`, `"registered nurse"`. |
| `--location <text>` | `-l` | Place, appended to the query as `"<query> in <location>"` (JSearch's documented style), e.g. `"Houston, TX"`, `"Raleigh, NC"`. Omit for the whole country. |
| `--country <cc>` | | ISO-3166 alpha-2 country the search runs in. Default `us`. |
| `--remote` | | Remote / work-from-home jobs only (`work_from_home=true`). Takes no value (`--remote remote` is also accepted). JSearch has no hybrid/on-site filter; other values exit 1 with `BAD_ARG`. |
| `--employment-type <list>` | | Comma list of `FULLTIME`, `PARTTIME`, `CONTRACTOR`, `INTERN` (`full-time`, `part-time`, `contract`, `internship` also accepted). |
| `--requirements <list>` | | Comma list of `under_3_years_experience`, `more_than_3_years_experience`, `no_experience`, `no_degree`. |
| `--jobage <days>` | | Posted within N days. Mapped to JSearch's `date_posted` bucket that covers N (1 → `today`, ≤3 → `3days`, ≤7 → `week`, ≤30 → `month`, more → `all`), then filtered **client-side to exactly N days** by each result's `date`. Undated results are kept with `date: null`. |
| `--page <n>` | | 1-indexed result page (~10 results per page). Default 1. |
| `--pages <n>` | | Pages fetched in this one call (`num_pages`, 1-10). Default 1. **Costs more quota per call.** |
| `--limit <n>` | `-n` | Cap on results emitted (client-side). Default 20. |
| `--format json\|table\|plain` | | Default `json`. |

### Fetch full job detail

```bash
bun run .agents/skills/jsearch-search/cli/src/cli.ts detail <job_id> [--format json|plain] [--country us]
```

`job_id` is the `id` of a search result - a base64-style token such as
`Xk1HqJ3vZbQAAAAAAAAAAA==` (quote it in the shell). **URLs are rejected with
`BAD_ID` before any request**: a result's `url` is the publisher's apply link, not a
JSearch page, so a LinkedIn/Indeed/employer URL cannot be looked up here. Returns the
full description, `highlights` (qualifications, responsibilities, benefits),
`apply_options`, `deadline` (when the posting states an expiry), salary and
employer website. Postings expire out of JSearch's index; an expired id is
`NOT_FOUND`.

## Usage examples

```bash
# Data analyst roles in Houston, last 14 days (the /scrape shape)
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "data analyst" -l "Houston, TX" --jobage 14 --limit 20 --format json

# Registered nurse, full-time, Phoenix - table view
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "registered nurse" -l "Phoenix, AZ" --employment-type full-time --format table

# Remote frontend roles anywhere in the US, last week
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "frontend engineer" --remote --jobage 7 --format table

# Entry-level, no degree, Chicago
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "customer success" -l "Chicago, IL" --requirements no_experience,no_degree --format table

# Contract project managers in Atlanta posted today
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "project manager" -l "Atlanta, GA" --employment-type contract --jobage 1 --format table

# Full detail for one result
bun run .agents/skills/jsearch-search/cli/src/cli.ts detail "Xk1HqJ3vZbQAAAAAAAAAAA==" --format plain
```

## Output

| Format | Best for |
|--------|----------|
| `json` | Default - programmatic use (`/scrape`), passing ids to `detail` |
| `table` | Quick human scanning (remote jobs show as `Remote - <location>`) |
| `plain` | Reading results or one job's detail as text |

Search JSON:

```json
{
  "meta": { "count": 1, "page": 1, "pages": 1, "returned": 10, "dropped_by_jobage": 0,
            "query": "data analyst in Houston, TX", "date_posted": "month", "provider": "rapidapi" },
  "results": [
    {
      "id": "Xk1HqJ3vZbQAAAAAAAAAAA==",
      "title": "Data Analyst",
      "company": "Contoso Energy",
      "location": "Houston, TX",
      "date": "2026-10-19",
      "url": "https://<publisher apply link>",
      "remote": false,
      "employment_type": "Full-time",
      "salary": { "min": 72000, "max": 90000, "currency": null, "period": "YEAR" },
      "publisher": "LinkedIn",
      "apply_is_direct": false,
      "source": "jsearch"
    }
  ]
}
```

- `id`, `title`, `company`, `location`, `date`, `url` are always present (`null` when
  JSearch omits them) - the same contract fields every portal CLI emits.
- `date` is the posting date as `YYYY-MM-DD` (from `job_posted_at_datetime_utc`).
- `salary` is `null` unless the posting publishes a range; `period` is JSearch's
  (`YEAR`, `HOUR`, `MONTH`, ...) - compare pay only within one period.
- `meta.returned` is what JSearch sent; `meta.count` is what survived the `--jobage`
  filter and `--limit`.

Detail JSON adds `deadline`, `employer_website`, `description`,
`highlights: { qualifications[], responsibilities[], benefits[] }` and
`apply_options: [{ publisher, url, is_direct }]`.

## Errors

All errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`;
stdout stays empty.

| Code | Meaning |
|------|---------|
| `MISSING_CREDENTIALS` | `JSEARCH_API_TOKEN` is unset. Nothing was requested. |
| `AUTH` | 401/403: key wrong, or not subscribed to JSearch, or `JSEARCH_PROVIDER` doesn't match where the key came from. |
| `QUOTA_EXCEEDED` | The plan's allowance is used up (a 429 naming the quota). Not retried. |
| `RATE_LIMITED` | 429/5xx persisted through backoff, or `Retry-After` asked for longer than the 30 s retry budget. |
| `UNKNOWN_FLAG` | A flag this command doesn't support. Checked first - nothing is requested. |
| `BAD_ARG` | Invalid flag value (bad number, country, employment type, requirement, format, provider). |
| `BAD_ID` | `detail` was given a URL or something that isn't a JSearch job_id. |
| `NO_ID` | `detail` without an id. |
| `NOT_FOUND` | `detail` id unknown or expired. |
| `API_ERROR` | JSearch answered `status: "ERROR"` or another 4xx; its message is included. |
| `NETWORK` | The API host could not be reached (fails fast, no retry). |
| `BAD_CMD` | Unknown command. |

## Notes

- **Board hosts: none.** JSearch is an API (`jsearch.p.rapidapi.com`,
  `api.openwebninja.com`) with no posting pages of its own, so no posting URL
  belongs to this skill. Never route a LinkedIn, Indeed, Glassdoor or employer URL
  to this skill's `detail` (it rejects URLs with `BAD_ID`); use that board's own
  portal skill or a normal fetch.
- Upstream endpoints, parameters and response fields are recorded in
  `url-reference.md`, with which parts were confirmed against documentation.
- Results mirror what Google for Jobs indexed, so the same job can appear from
  several publishers; `/scrape`'s dedup handles that by company + title + URL.
- Google for Jobs can surface stale or reposted listings; check `date`, and confirm
  the posting is still open on the employer's own site before investing in an
  application.
- 429/5xx are retried with exponential backoff and jitter (up to 6 retries), and a
  `Retry-After` header is honoured within a 30 s total budget.
