import {
  apiGet,
  jobageToDatePosted,
  reportError,
  toResult,
  withinDays,
  type JSearchJob,
  type JobResult,
  type Provider,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  country: string
  remote: boolean
  employmentTypes?: string // already normalised, e.g. "FULLTIME,CONTRACTOR"
  jobRequirements?: string // already normalised, e.g. "no_degree"
  jobage?: number
  page: number
  pages: number
  limit: number
  format: "json" | "table" | "plain"
}

/**
 * The full text JSearch searches. Its docs ask for location inside the query
 * ("data analyst in Houston, TX"), so --location is appended that way.
 */
export function fullQuery(opts: Pick<SearchOpts, "query" | "location">): string {
  return opts.location ? `${opts.query} in ${opts.location}` : opts.query
}

export function buildParams(opts: SearchOpts): URLSearchParams {
  const p = new URLSearchParams()
  p.set("query", fullQuery(opts))
  p.set("page", String(opts.page))
  p.set("num_pages", String(opts.pages))
  p.set("country", opts.country)
  p.set("date_posted", jobageToDatePosted(opts.jobage))
  if (opts.remote) p.set("work_from_home", "true")
  if (opts.employmentTypes) p.set("employment_types", opts.employmentTypes)
  if (opts.jobRequirements) p.set("job_requirements", opts.jobRequirements)
  return p
}

function dash(v: string | null): string {
  return v ?? "—"
}

function formatSalary(r: JobResult): string | null {
  const s = r.salary
  if (!s) return null
  const cur = s.currency ? `${s.currency} ` : ""
  const per = s.period ? `/${s.period.toLowerCase()}` : ""
  const amount = s.min !== null && s.max !== null && s.min !== s.max ? `${s.min}–${s.max}` : `${s.min ?? s.max}`
  return `${cur}${amount}${per}`
}

// The ID column is sized to the longest id so it is never truncated - a cut id
// cannot be passed to `detail`; the other columns truncate for scanning.
function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const cols: Array<{ header: string; width: number; cell: (r: JobResult) => string }> = [
    { header: "ID", width: Math.max(2, ...rows.map((r) => r.id.length)), cell: (r) => r.id },
    { header: "TITLE", width: 38, cell: (r) => r.title },
    { header: "COMPANY", width: 24, cell: (r) => dash(r.company) },
    { header: "LOCATION", width: 22, cell: (r) => (r.remote ? `Remote - ${dash(r.location)}` : dash(r.location)) },
    { header: "DATE", width: 10, cell: (r) => dash(r.date) },
    { header: "VIA", width: 14, cell: (r) => dash(r.publisher) },
  ]
  const line = (cells: string[]) => cells.map((c, i) => c.slice(0, cols[i].width).padEnd(cols[i].width)).join("  ")
  const header = line(cols.map((c) => c.header))
  return [header, "-".repeat(header.length), ...rows.map((r) => line(cols.map((c) => c.cell(r))))].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) => {
      const extra = [r.employment_type, formatSalary(r), r.remote ? "remote" : null].filter(Boolean).join(" · ")
      return [
        r.title,
        `  ${dash(r.company)} · ${dash(r.location)} · ${dash(r.date)}`,
        ...(extra ? [`  ${extra}`] : []),
        `  id: ${r.id}`,
        `  via ${dash(r.publisher)}: ${dash(r.url)}`,
      ].join("\n")
    })
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts, provider: Provider, token: string): Promise<number> {
  try {
    const env = await apiGet<JSearchJob[]>(provider, token, provider.searchPath, buildParams(opts))
    const raw = Array.isArray(env?.data) ? env!.data : []
    const parsed = raw.map(toResult).filter((r): r is JobResult => r !== null)
    // date_posted buckets are coarse (14 days -> "month"), so the exact window
    // is applied here; that keeps /scrape's 14-day rule honest.
    const recent = withinDays(parsed, opts.jobage)
    const rows = recent.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: rows.length,
              page: opts.page,
              pages: opts.pages,
              returned: parsed.length,
              dropped_by_jobage: parsed.length - recent.length,
              query: fullQuery(opts),
              date_posted: jobageToDatePosted(opts.jobage),
              provider: provider.name,
            },
            results: rows,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    return reportError(e, "SEARCH_FAILED")
  }
}
