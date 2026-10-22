# JSearch API reference

The endpoints, parameters and response fields this skill depends on - the file to
update when JSearch changes. JSearch is OpenWeb Ninja's jobs API, built on Google
for Jobs. The key-gated API could not be called while building this skill, so the
fixtures under `cli/tests/fixtures/` are synthetic (see their README) and the table
below marks what was confirmed against documentation versus carried over.

**First live run:** before relying on this skill, run one `search` and one `detail`
with a real key and check that titles, companies, dates and descriptions come back
populated. If a field is null on every result, its name changed - fix it in
`cli/src/helpers.ts` (`JSearchJob`, `toResult`, `toDetail`) and record it here.

## Providers and authentication

| `JSEARCH_PROVIDER` | Base | Auth header(s) | Status |
|--------------------|------|----------------|--------|
| `rapidapi` (default) | `https://jsearch.p.rapidapi.com` | `X-RapidAPI-Key: $JSEARCH_API_TOKEN`, `X-RapidAPI-Host: jsearch.p.rapidapi.com` | Confirmed (RapidAPI listing and endpoint docs). |
| `openwebninja` | `https://api.openwebninja.com/jsearch` | `x-api-key: $JSEARCH_API_TOKEN` | Host and header confirmed (OpenWeb Ninja JSearch page shows `api.openwebninja.com/jsearch/search-v2` with `x-api-key`). The `/search` and `/job-details` paths under it are **inferred** from the RapidAPI paths and not confirmed; if they 404, try `/search-v2` and check its response shape. |

The key is read only from `JSEARCH_API_TOKEN` (never a flag) and is redacted from
every message the CLI prints.

## `GET /search`

| Param | CLI flag | Notes |
|-------|----------|-------|
| `query` | `--query` + `--location` | Free text. Location goes inside the query: `"<query> in <location>"`. |
| `page` | `--page` | 1-indexed. ~10 results per page. |
| `num_pages` | `--pages` | Pages per call; default 1. More pages are billed as more than one request. |
| `country` | `--country` | ISO-3166 alpha-2, lowercased. Default `us`. |
| `date_posted` | `--jobage` | `all` \| `today` \| `3days` \| `week` \| `month`. Confirmed. CLI maps N days to the smallest covering bucket and filters to N days client-side. |
| `work_from_home` | `--remote` | `true` for remote-only. Confirmed by OpenWeb Ninja's FAQ; some third-party mirrors document an older name, `remote_jobs_only`, which this CLI does not send. |
| `employment_types` | `--employment-type` | Comma list of `FULLTIME`, `CONTRACTOR`, `PARTTIME`, `INTERN`. Confirmed. |
| `job_requirements` | `--requirements` | Comma list of `under_3_years_experience`, `more_than_3_years_experience`, `no_experience`, `no_degree`. Confirmed via third-party mirrors of the docs. |

Not used (exist upstream per mirrors): `radius`, `language`, `exclude_job_publishers`,
`job_titles`, `fields`.

## `GET /job-details`

| Param | CLI | Notes |
|-------|-----|-------|
| `job_id` | `detail <job_id>` | Required. The `job_id` of a search result (base64-style; URL-encoded by the CLI). |
| `country` | `detail --country` | Optional. |

Returns the same job object as search in a one-element `data` array, plus extras
(employer reviews, estimated salaries) that this skill ignores.

## Response envelope

```json
{ "status": "OK", "request_id": "...", "parameters": { ... }, "data": [ job, ... ] }
```

`status: "ERROR"` carries `error: { message, code }`; the CLI reports it as
`API_ERROR`. RapidAPI gateway errors are `{ "message": "..." }`; a 429 whose message
mentions the quota is reported as `QUOTA_EXCEEDED` and not retried.

## Job fields read

| Field | Output | Status |
|-------|--------|--------|
| `job_id` | `id` (rows without it are dropped) | Confirmed |
| `job_title` | `title` (entities decoded) | Confirmed |
| `employer_name` | `company` | Confirmed |
| `employer_website` | `employer_website` (detail) | Per mirrors |
| `job_publisher` | `publisher` | Confirmed |
| `job_apply_link`, `job_apply_is_direct` | `url`, `apply_is_direct` | Confirmed |
| `apply_options[] { publisher, apply_link, is_direct }` | `apply_options` (detail); first link is the `url` fallback | Confirmed |
| `job_employment_type` / `job_employment_types[]` | `employment_type` | Per mirrors |
| `job_is_remote` | `remote` | Confirmed |
| `job_location`, else `job_city`, `job_state`, `job_country` | `location` | Confirmed |
| `job_posted_at_datetime_utc`, else `job_posted_at_timestamp` (unix s) | `date` (`YYYY-MM-DD`) | Not confirmed by any page found; the commonly used names. |
| `job_min_salary`, `job_max_salary`, `job_salary_currency`, `job_salary_period` | `salary` | Not confirmed; commonly used names. Absent -> `salary: null`. |
| `job_description` | `description` (detail; tags stripped, entities decoded) | Confirmed |
| `job_highlights { Qualifications, Responsibilities, Benefits }` | `highlights` (detail) | Not confirmed; commonly used names. Absent -> empty lists. |
| `job_offer_expiration_datetime_utc` / `_timestamp` | `deadline` (detail) | Not confirmed. Absent -> `null`. |

Every field is read defensively: a missing or mistyped field becomes `null` (or an
empty list), never a crash.

## Errors and retries

| Upstream | CLI behaviour |
|----------|---------------|
| 401 / 403 | `AUTH`, with a hint to check the key, the JSearch subscription, and `JSEARCH_PROVIDER`. |
| 404 | search: empty; detail: `NOT_FOUND`. |
| 429 with "quota" in the body | `QUOTA_EXCEEDED`, no retry. |
| 429 / 5xx | Exponential backoff with jitter (500 ms doubling to 8 s, max 6 retries), at least as long as `Retry-After` asks, within a 30 s total budget; then `RATE_LIMITED`. |
| Connection failure | `NETWORK`, no retry. |

## Sources consulted

- OpenWeb Ninja JSearch product page and FAQ - https://www.openwebninja.com/api/jsearch
- JSearch on RapidAPI - https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
- RapidAPI endpoint documentation (search) - https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/playground/endpoint_23a56c32-02d3-45a2-94ab-fdda973f445c
- Zyla Labs JSearch mirror (params, `job_requirements` values) - https://zylalabs.com/api-marketplace/data/jsearch+api/2526
- OpenWeb Ninja MCP server (direct host, `x-api-key`) - https://github.com/OpenWeb-Ninja/openwebninja-mcp
