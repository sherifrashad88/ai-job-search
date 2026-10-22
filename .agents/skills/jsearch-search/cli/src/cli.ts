#!/usr/bin/env bun
// Self-contained CLI for the JSearch jobs API (OpenWeb Ninja, sold via RapidAPI).
// No CLI framework and zero runtime dependencies: it runs anywhere `bun` does.
//
// Needs an API key in JSEARCH_API_TOKEN (never a flag). Every search/detail call
// is one billed request against the key's plan, so flag validation runs - and
// fails - before the key is read or any request is made.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { checkId, runDetail, type DetailOpts } from "./commands/detail.js"
import {
  EMPLOYMENT_TYPES,
  JOB_REQUIREMENTS,
  PROVIDER_ENV,
  TOKEN_ENV,
  parseEmploymentTypes,
  parseJobRequirements,
  reportError,
  resolveProvider,
  resolveToken,
  writeError,
} from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", l: "location", n: "limit" }

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-") || a === "-") {
      ;(flags._ as string[]).push(a)
      continue
    }
    let name = a.replace(/^-+/, "")
    let value: string | boolean = true
    const eq = name.indexOf("=")
    if (eq > 0) {
      value = name.slice(eq + 1)
      name = name.slice(0, eq)
    } else {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith("-")) {
        value = next
        i++
      }
    }
    flags[ALIAS[name] ?? name] = value
  }
  return flags
}

const HELP = `jsearch-cli — search US (and other) job listings via the JSearch API
(Google for Jobs aggregation: LinkedIn, Indeed, Glassdoor, ZipRecruiter, company sites, ...)

SETUP
  export ${TOKEN_ENV}=<your key>        required; never passed as a flag
  export ${PROVIDER_ENV}=rapidapi        default; or "openwebninja" for a direct key
  Every search/detail call is one billed request against your plan's quota.

USAGE
  bun run src/cli.ts search -q "<keywords>" [-l "<city, ST>"] [flags]
  bun run src/cli.ts detail <job_id> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>        Required. Role / keywords, e.g. "data analyst".
  --location, -l <text>     Appended to the query as "in <location>", e.g. "Houston, TX".
  --country <cc>            ISO-3166 alpha-2 country. Default us.
  --remote                  Remote / work-from-home jobs only (work_from_home=true).
  --employment-type <list>  Comma list: ${EMPLOYMENT_TYPES.join(", ")}
                            (full-time, part-time, contract, internship also accepted).
  --requirements <list>     Comma list: ${JOB_REQUIREMENTS.join(", ")}.
  --jobage <days>           Posted within N days. Mapped to date_posted
                            (1=today, <=3=3days, <=7=week, <=30=month, else all)
                            and then filtered to the exact N days client-side.
  --page <n>                1-indexed page (~10 results per page). Default 1.
  --pages <n>               Pages fetched in this one call (num_pages, 1-10). Default 1.
                            More pages = more quota per call; keep it at 1 for /scrape.
  --limit, -n <n>           Cap results emitted (client-side). Default 20.
  --format <fmt>            json (default) | table | plain.

DETAIL
  <job_id>                  The id of a search result. URLs are rejected (BAD_ID).
  --country <cc>            Optional country hint for the lookup.
  --format <fmt>            json (default) | plain.

EXAMPLES
  bun run src/cli.ts search -q "data analyst" -l "Houston, TX" --jobage 14 --format table
  bun run src/cli.ts search -q "registered nurse" -l "Phoenix, AZ" --employment-type full-time
  bun run src/cli.ts search -q "frontend engineer" --remote --jobage 7 --limit 10
  bun run src/cli.ts detail "Xk1HqJ3vZbQAAAAAAAAAAA==" --format plain
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "location", "country", "remote", "employment-type", "requirements",
    "jobage", "page", "pages", "limit", "format", "help", "h",
  ]),
  detail: new Set(["country", "format", "help", "h"]),
}

function badArg(message: string): number {
  writeError(message, "BAD_ARG")
  return 1
}

/** Whole number in [min, max], or null after writing BAD_ARG. */
function intFlag(name: string, raw: string | boolean | string[], min: number, max: number): number | null {
  // Number(), not parseInt(): parseInt("0.5") truncates and silently drops the filter.
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < min || val > max) {
    badArg(`--${name} must be a whole number from ${min} to ${max}, got "${raw}"`)
    return null
  }
  return val
}

function countryFlag(raw: string | boolean | string[] | undefined): string | null | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== "string" || !/^[a-z]{2}$/i.test(raw.trim())) {
    badArg(`--country must be a two-letter ISO-3166 code such as us, got "${raw}"`)
    return null
  }
  return raw.trim().toLowerCase()
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = flags._[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Unknown flags fail before anything else: a silently discarded filter changes
  // what a search returns, and here it would also spend a billed request.
  const known = KNOWN_FLAGS[cmd]
  if (!known) {
    writeError(`Unknown command "${cmd}" - use search or detail`, "BAD_CMD")
    return 1
  }
  for (const key of Object.keys(flags)) {
    if (key === "_" || known.has(key)) continue
    writeError(
      `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
      "UNKNOWN_FLAG",
    )
    return 1
  }

  const fmt = flags.format !== undefined ? String(flags.format) : "json"

  if (cmd === "search") {
    if (flags._.length > 1) return badArg(`unexpected argument "${flags._[1]}" - put keywords in --query`)
    for (const name of ["query", "location", "employment-type", "requirements"]) {
      const v = flags[name]
      if (v !== undefined && (typeof v !== "string" || !v.trim())) return badArg(`--${name} requires a non-empty value`)
    }
    if (typeof flags.query !== "string") return badArg("search requires --query/-q, e.g. -q \"data analyst\"")
    if (!["json", "table", "plain"].includes(fmt)) return badArg(`--format must be one of json|table|plain, got "${fmt}"`)

    // JSearch has one workplace filter: remote-only. A bare --remote (or
    // --remote remote) turns it on; hybrid/onsite cannot be expressed.
    let remote = false
    if (flags.remote !== undefined) {
      const v = flags.remote === true ? "remote" : String(flags.remote).trim().toLowerCase()
      if (v !== "remote" && v !== "true") {
        return badArg(`--remote takes no value (remote-only); JSearch cannot filter on "${flags.remote}"`)
      }
      remote = true
    }

    let employmentTypes: string | undefined
    if (typeof flags["employment-type"] === "string") {
      const parsed = parseEmploymentTypes(flags["employment-type"])
      if (parsed.bad !== undefined) {
        return badArg(`--employment-type must be a comma list of ${EMPLOYMENT_TYPES.join(", ")}, got "${parsed.bad}"`)
      }
      employmentTypes = parsed.value
    }
    let jobRequirements: string | undefined
    if (typeof flags.requirements === "string") {
      const parsed = parseJobRequirements(flags.requirements)
      if (parsed.bad !== undefined) {
        return badArg(`--requirements must be a comma list of ${JOB_REQUIREMENTS.join(", ")}, got "${parsed.bad}"`)
      }
      jobRequirements = parsed.value
    }

    const ints: Record<string, number | undefined> = {}
    for (const [name, min, max] of [["jobage", 1, 3650], ["page", 1, 100], ["pages", 1, 10], ["limit", 1, 500]] as const) {
      if (flags[name] === undefined) continue
      const v = intFlag(name, flags[name], min, max)
      if (v === null) return 1
      ints[name] = v
    }
    const country = countryFlag(flags.country)
    if (country === null) return 1

    const opts: SearchOpts = {
      query: (flags.query as string).trim(),
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      country: country ?? "us",
      remote,
      employmentTypes,
      jobRequirements,
      jobage: ints.jobage,
      page: ints.page ?? 1,
      pages: ints.pages ?? 1,
      limit: ints.limit ?? 20,
      format: fmt as SearchOpts["format"],
    }
    try {
      const provider = resolveProvider()
      const token = resolveToken()
      return await runSearch(opts, provider, token)
    } catch (e) {
      return reportError(e, "SEARCH_FAILED")
    }
  }

  // detail
  const rawId = flags._[1]
  if (!rawId) {
    writeError("detail requires a <job_id> (the id of a search result)", "NO_ID")
    return 1
  }
  if (flags._.length > 2) return badArg(`detail takes one <job_id>, got extra "${flags._[2]}"`)
  if (!["json", "plain"].includes(fmt)) return badArg(`--format must be one of json|plain, got "${fmt}"`)
  const country = countryFlag(flags.country)
  if (country === null) return 1
  const id = checkId(rawId)
  if (!id) return 1
  const opts: DetailOpts = { id, country, format: fmt as DetailOpts["format"] }
  try {
    const provider = resolveProvider()
    const token = resolveToken()
    return await runDetail(opts, provider, token)
  } catch (e) {
    return reportError(e, "DETAIL_FAILED")
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
