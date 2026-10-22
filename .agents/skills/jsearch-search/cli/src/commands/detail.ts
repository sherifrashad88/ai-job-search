import {
  apiGet,
  CliError,
  normalizeJobId,
  reportError,
  toDetail,
  writeError,
  type JSearchJob,
  type JobDetailResult,
  type Provider,
} from "../helpers.js"

export interface DetailOpts {
  id: string // a JSearch job_id (the `id` of a search result)
  country?: string
  format: "json" | "plain"
}

/** Validate the id before any credential lookup or request; null after writing BAD_ID. */
export function checkId(input: string): string | null {
  const id = normalizeJobId(input)
  if (!id) {
    writeError(
      `"${input.slice(0, 200)}" is not a JSearch job_id. detail takes the \`id\` of a search result ` +
        "(a token such as Xk1HqJ3vZbQAAAAAAAAAAA==), never a URL: a search result's url is the " +
        "publisher's apply link, not a JSearch posting. Open that link by hand, or use the matching portal skill.",
      "BAD_ID",
    )
  }
  return id
}

function renderPlain(job: JobDetailResult): string {
  const lines: string[] = [job.title, `${job.company ?? "—"} · ${job.location ?? "—"}${job.remote ? " (remote)" : ""}`]
  const field = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Posted", job.date)
  field("Deadline", job.deadline)
  field("Employment", job.employment_type)
  if (job.salary) {
    const s = job.salary
    const amount = s.min !== null && s.max !== null && s.min !== s.max ? `${s.min}–${s.max}` : `${s.min ?? s.max}`
    field("Salary", `${s.currency ? `${s.currency} ` : ""}${amount}${s.period ? `/${s.period.toLowerCase()}` : ""}`)
  }
  field("Employer site", job.employer_website)

  lines.push("", job.description ?? "(no description)")
  for (const [label, list] of [
    ["Qualifications", job.highlights.qualifications],
    ["Responsibilities", job.highlights.responsibilities],
    ["Benefits", job.highlights.benefits],
  ] as const) {
    if (list.length) lines.push("", `${label}:`, ...list.map((item) => `  - ${item}`))
  }

  lines.push("", `Apply (via ${job.publisher ?? "—"}): ${job.url ?? "—"}`)
  const others = job.apply_options.filter((o) => o.url !== job.url)
  if (others.length) {
    lines.push("Other apply options:", ...others.map((o) => `  - ${o.publisher ?? "—"}${o.is_direct ? " (direct)" : ""}: ${o.url}`))
  }
  lines.push(`id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts, provider: Provider, token: string): Promise<number> {
  try {
    const params = new URLSearchParams({ job_id: opts.id })
    if (opts.country) params.set("country", opts.country)
    const env = await apiGet<JSearchJob[]>(provider, token, provider.detailPath, params)
    const first = Array.isArray(env?.data) ? env!.data[0] : undefined
    const job = first ? toDetail(first) : null
    if (!job) throw new CliError(`no JSearch job found for id ${opts.id} (expired postings drop out of the index)`, "NOT_FOUND")

    process.stdout.write((opts.format === "plain" ? renderPlain(job) : JSON.stringify(job, null, 2)) + "\n")
    return 0
  } catch (e) {
    return reportError(e, "DETAIL_FAILED")
  }
}
