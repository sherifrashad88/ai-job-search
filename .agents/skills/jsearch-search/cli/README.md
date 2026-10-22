# jsearch-cli

CLI for the **JSearch** jobs API (OpenWeb Ninja), US-first: Google for Jobs
aggregation of LinkedIn, Indeed, Glassdoor, ZipRecruiter, company career sites and
more, as structured JSON.

**Data source**: JSearch `GET /search` and `GET /job-details`, via RapidAPI
(`jsearch.p.rapidapi.com`, default) or OpenWeb Ninja directly (`api.openwebninja.com`).
**Authentication**: API key in `JSEARCH_API_TOKEN` (required); `JSEARCH_PROVIDER=rapidapi|openwebninja`.
**Cost**: every `search`/`detail` call is one billed request against your plan.
**Dependencies**: none (plain `bun` + `fetch`). `bun install` only pulls dev type defs.

## Installation

```bash
cd .agents/skills/jsearch-search/cli
bun install   # optional - only installs TypeScript dev types
export JSEARCH_API_TOKEN=<your key>
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings (`--query` required) |
| `detail` | Full description, highlights and apply options for one `job_id` |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. Errors go to **stderr** as `{ "error": "...", "code": "..." }`
with exit code `1`. Flag validation (including unknown flags) happens before the key
is read or any request is made.

## Quick examples

```bash
bun run src/cli.ts search -q "data analyst" -l "Houston, TX" --jobage 14 --format table
bun run src/cli.ts search -q "frontend engineer" --remote --jobage 7 --limit 10
bun run src/cli.ts search -q "registered nurse" -l "Phoenix, AZ" --employment-type full-time,part-time
bun run src/cli.ts detail "Xk1HqJ3vZbQAAAAAAAAAAA==" --format plain
```

See `../SKILL.md` for every flag, the output schema and the error codes, and
`../url-reference.md` for the upstream API mapping.

## Tests

```bash
bun test         # network-free: synthetic fixtures served over loopback, fetch stubbed
bun run typecheck
```

The tests never use a real key (they strip any `JSEARCH_*` variables from the child
environment) and assert the fake key never appears in output.
