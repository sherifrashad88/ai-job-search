// Data source: the JSearch API by OpenWeb Ninja (JSON, `{status, request_id,
// parameters, data}` envelope). JSearch aggregates Google for Jobs, which in turn
// indexes LinkedIn, Indeed, Glassdoor, ZipRecruiter, company career sites and many
// smaller boards, so one request covers most of the US market.
//
// Unlike the shipped portal CLIs, this one needs an API key. The key is read ONLY
// from the JSEARCH_API_TOKEN environment variable (never a flag: flags leak into
// shell history and process listings), is sent only to the provider host chosen by
// JSEARCH_PROVIDER, and is never printed - every error message that leaves this
// process goes through `redact()` first.

export const TOKEN_ENV = "JSEARCH_API_TOKEN"
export const PROVIDER_ENV = "JSEARCH_PROVIDER"

export type ProviderName = "rapidapi" | "openwebninja"

export interface Provider {
  name: ProviderName
  /** Origin + path prefix the endpoint paths are appended to. */
  base: string
  searchPath: string
  detailPath: string
  /** Request headers carrying the credential (plus any host header the gateway needs). */
  authHeaders(token: string): Record<string, string>
  /** Where the user manages the key - quoted in AUTH / quota hints. */
  dashboard: string
}

// RapidAPI is the default: it is the marketplace most JSearch keys come from and
// the one with a free Basic tier. OpenWeb Ninja sells the same API directly with
// its own key; its paths are mirrored from the RapidAPI ones (see url-reference.md
// for which parts of that are confirmed).
const RAPIDAPI_HOST = "jsearch.p.rapidapi.com"

export const PROVIDERS: Record<ProviderName, Provider> = {
  rapidapi: {
    name: "rapidapi",
    base: `https://${RAPIDAPI_HOST}`,
    searchPath: "/search",
    detailPath: "/job-details",
    authHeaders: (token) => ({ "X-RapidAPI-Key": token, "X-RapidAPI-Host": RAPIDAPI_HOST }),
    dashboard: "your RapidAPI dashboard (Apps -> Authorization), and make sure the app is subscribed to the JSearch API",
  },
  openwebninja: {
    name: "openwebninja",
    base: "https://api.openwebninja.com/jsearch",
    searchPath: "/search",
    detailPath: "/job-details",
    authHeaders: (token) => ({ "x-api-key": token }),
    dashboard: "your OpenWeb Ninja dashboard",
  },
}

/** A failure with a stable machine-readable code, written to stderr by the commands. */
export class CliError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

/** The configured provider, or a BAD_ARG CliError naming the valid values. */
export function resolveProvider(env: Record<string, string | undefined> = process.env): Provider {
  const raw = (env[PROVIDER_ENV] ?? "").trim().toLowerCase()
  if (!raw) return PROVIDERS.rapidapi
  if (raw === "rapidapi" || raw === "openwebninja") return PROVIDERS[raw]
  throw new CliError(
    `${PROVIDER_ENV} must be "rapidapi" (default) or "openwebninja", got "${raw.slice(0, 40)}"`,
    "BAD_ARG",
  )
}

/**
 * The API token from the environment, or a MISSING_CREDENTIALS CliError naming
 * the variable to set. Checked before any request is built, so an unset key can
 * never fall through to an unauthenticated call that fails confusingly.
 */
export function resolveToken(env: Record<string, string | undefined> = process.env): string {
  const token = (env[TOKEN_ENV] ?? "").trim()
  if (!token) {
    throw new CliError(
      `${TOKEN_ENV} is not set. Export your JSearch API key first, e.g. ` +
        `export ${TOKEN_ENV}=<your key> (RapidAPI by default; set ${PROVIDER_ENV}=openwebninja ` +
        `for a key bought directly from OpenWeb Ninja). Every call counts against your plan's quota.`,
      "MISSING_CREDENTIALS",
    )
  }
  return token
}

/** Replace every occurrence of the token in `text`, so no error path can echo it. */
export function redact(text: string, token: string | undefined = process.env[TOKEN_ENV]?.trim()): string {
  if (!token) return text
  return text.split(token).join("[REDACTED]")
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error: redact(error), code }) + "\n")
}

/** Write a caught error as the contract's stderr JSON, keeping a CliError's own code. */
export function reportError(e: unknown, fallbackCode: string): number {
  if (e instanceof CliError) writeError(e.message, e.code)
  else writeError(e instanceof Error ? e.message : String(e), fallbackCode)
  return 1
}

// An honest User-Agent naming the tool, the convention every portal CLI follows.
const UA = "Mozilla/5.0 (compatible; jsearch-cli/1.0)"

// The most apiGet sleeps across all retries of one request (the freehire CLI's
// budget). Its own backoff schedule stays under it; a Retry-After that would push
// past it fails at once, so a throttled key degrades this source quickly instead
// of outlasting the caller's tool timeout.
export const RETRY_BUDGET_MS = 30_000
const MAX_RETRIES = 6

/**
 * The wait a 429/503 asks for via `Retry-After`, in ms, or null when absent or
 * unreadable. Accepts both RFC 9110 forms: delta-seconds and an HTTP-date.
 */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(date - now, 0)
}

/** The response envelope JSearch wraps every answer in. */
export interface Envelope<T> {
  status?: string // "OK" | "ERROR"
  request_id?: string
  parameters?: Record<string, unknown>
  data?: T
  error?: { message?: string; code?: number } | string
  message?: string // RapidAPI gateway errors ({"message": "..."})
}

function envelopeMessage(body: Envelope<unknown> | null): string | null {
  if (!body) return null
  if (typeof body.error === "string") return body.error
  if (body.error && typeof body.error.message === "string") return body.error.message
  if (typeof body.message === "string") return body.message
  return null
}

// RapidAPI answers an exhausted monthly/daily allowance with a 429 whose message
// names the quota. Retrying that only burns the caller's time (and, on a paid
// plan, overage), so it fails at once with its own code.
const QUOTA_MESSAGE = /quota/i

/**
 * GET a JSearch endpoint. Retries 429/5xx with exponential backoff and jitter,
 * waiting at least as long as `Retry-After` asks, within RETRY_BUDGET_MS in total.
 * Returns `null` on a 404. A connection failure fails fast (no retry). 401/403
 * become an AUTH CliError with a hint; an exhausted quota becomes QUOTA_EXCEEDED.
 */
export async function apiGet<T>(
  provider: Provider,
  token: string,
  path: string,
  params: URLSearchParams,
): Promise<Envelope<T> | null> {
  const url = `${provider.base}${path}?${params.toString()}`
  let delay = 500
  let waited = 0

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { ...provider.authHeaders(token), "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      })
    } catch (e) {
      throw new CliError(
        `could not reach the JSearch API at ${provider.base} (${e instanceof Error ? e.message : String(e)})`,
        "NETWORK",
      )
    }

    if (response.status === 401 || response.status === 403) {
      const body = (await response.json().catch(() => null)) as Envelope<unknown> | null
      const detail = envelopeMessage(body)
      throw new CliError(
        `JSearch rejected the API key (${response.status}${detail ? `: ${detail}` : ""}). ` +
          `Check ${TOKEN_ENV} against ${provider.dashboard}; ` +
          `if the key comes from the other provider, set ${PROVIDER_ENV} accordingly (currently "${provider.name}").`,
        "AUTH",
      )
    }

    if (response.status === 429 || response.status >= 500) {
      const text = await response.text().catch(() => "")
      if (response.status === 429 && QUOTA_MESSAGE.test(text)) {
        throw new CliError(
          `JSearch quota exhausted for this key (429). Wait for the plan's reset or upgrade it in ${provider.dashboard}.`,
          "QUOTA_EXCEEDED",
        )
      }
      if (attempt === MAX_RETRIES) {
        throw new CliError(`JSearch API request failed: ${response.status} ${response.statusText}`, "RATE_LIMITED")
      }
      const backoff = delay + Math.floor(Math.random() * 500)
      const retryAfter = retryAfterMs(response.headers.get("Retry-After"))
      const wait = Math.max(backoff, retryAfter ?? 0)
      if (waited + wait > RETRY_BUDGET_MS) {
        throw new CliError(
          `JSearch API request failed: ${response.status} ${response.statusText}; ` +
            `the server asked to retry in ${Math.ceil(wait / 1000)}s, past this CLI's ${RETRY_BUDGET_MS / 1000}s retry budget`,
          "RATE_LIMITED",
        )
      }
      await sleep(wait)
      waited += wait
      delay = Math.min(delay * 2, 8000)
      continue
    }

    if (response.status === 404) return null

    const body = (await response.json().catch(() => null)) as Envelope<T> | null
    if (!response.ok) {
      throw new CliError(
        envelopeMessage(body) || `JSearch API request failed: ${response.status} ${response.statusText}`,
        "API_ERROR",
      )
    }
    if (!body) throw new CliError("JSearch API returned an unparseable response body", "API_ERROR")
    if (body.status && body.status.toUpperCase() === "ERROR") {
      throw new CliError(`JSearch API error: ${envelopeMessage(body) ?? "unknown error"}`, "API_ERROR")
    }
    return body
  }
  throw new CliError("JSearch API request failed after retries", "RATE_LIMITED")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Request mapping
// ---------------------------------------------------------------------------

export type DatePosted = "all" | "today" | "3days" | "week" | "month"

/**
 * Map `--jobage <days>` onto JSearch's fixed `date_posted` buckets: the smallest
 * bucket that still covers the whole requested window (so the API never drops a
 * posting the caller asked for). A bucket wider than the request (14 -> month) is
 * narrowed client-side by `withinDays`.
 */
export function jobageToDatePosted(days: number | undefined): DatePosted {
  if (days === undefined) return "all"
  if (days <= 1) return "today"
  if (days <= 3) return "3days"
  if (days <= 7) return "week"
  if (days <= 30) return "month"
  return "all"
}

export const EMPLOYMENT_TYPES = ["FULLTIME", "CONTRACTOR", "PARTTIME", "INTERN"] as const
const EMPLOYMENT_ALIASES: Record<string, (typeof EMPLOYMENT_TYPES)[number]> = {
  FULLTIME: "FULLTIME",
  CONTRACTOR: "CONTRACTOR",
  CONTRACT: "CONTRACTOR",
  PARTTIME: "PARTTIME",
  INTERN: "INTERN",
  INTERNSHIP: "INTERN",
}

/**
 * Normalise a comma list of employment types ("full-time,contract") into
 * JSearch's values ("FULLTIME,CONTRACTOR"). `bad` names the first unknown item.
 */
export function parseEmploymentTypes(raw: string): { value?: string; bad?: string } {
  const out: string[] = []
  for (const item of raw.split(",")) {
    const token = item.trim()
    if (!token) continue
    const mapped = EMPLOYMENT_ALIASES[token.toUpperCase().replace(/[^A-Z]/g, "")]
    if (!mapped) return { bad: token }
    if (!out.includes(mapped)) out.push(mapped)
  }
  return out.length ? { value: out.join(",") } : { bad: raw }
}

export const JOB_REQUIREMENTS = [
  "under_3_years_experience",
  "more_than_3_years_experience",
  "no_experience",
  "no_degree",
] as const

export function parseJobRequirements(raw: string): { value?: string; bad?: string } {
  const out: string[] = []
  for (const item of raw.split(",")) {
    const token = item.trim().toLowerCase()
    if (!token) continue
    if (!(JOB_REQUIREMENTS as readonly string[]).includes(token)) return { bad: item.trim() }
    if (!out.includes(token)) out.push(token)
  }
  return out.length ? { value: out.join(",") } : { bad: raw }
}

// ---------------------------------------------------------------------------
// Response normalisation
// ---------------------------------------------------------------------------

/** A JSearch job - the fields this skill reads; every one may be absent. */
export interface JSearchJob {
  job_id?: string
  job_title?: string | null
  employer_name?: string | null
  employer_website?: string | null
  job_publisher?: string | null
  job_employment_type?: string | null
  job_employment_types?: string[] | null
  job_apply_link?: string | null
  job_apply_is_direct?: boolean | null
  apply_options?: Array<{ publisher?: string | null; apply_link?: string | null; is_direct?: boolean | null }> | null
  job_description?: string | null
  job_is_remote?: boolean | null
  job_posted_at_datetime_utc?: string | null
  job_posted_at_timestamp?: number | null
  job_location?: string | null
  job_city?: string | null
  job_state?: string | null
  job_country?: string | null
  job_min_salary?: number | null
  job_max_salary?: number | null
  job_salary_currency?: string | null
  job_salary_period?: string | null
  job_highlights?: Record<string, string[] | null | undefined> | null
  job_offer_expiration_datetime_utc?: string | null
  job_offer_expiration_timestamp?: number | null
}

export interface Salary {
  min: number | null
  max: number | null
  currency: string | null
  period: string | null
}

/**
 * A search result in the portal-skill contract shape: `id`, `title`, `company`,
 * `location`, `date` (YYYY-MM-DD), `url` always present (null when missing,
 * never omitted), plus JSearch's extra fields as a permitted superset.
 */
export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string | null
  remote: boolean | null
  employment_type: string | null
  salary: Salary | null
  publisher: string | null
  apply_is_direct: boolean | null
  source: "jsearch"
}

export interface ApplyOption {
  publisher: string | null
  url: string
  is_direct: boolean | null
}

export interface JobDetailResult extends JobResult {
  deadline: string | null
  employer_website: string | null
  description: string | null
  highlights: { qualifications: string[]; responsibilities: string[]; benefits: string[] }
  apply_options: ApplyOption[]
}

/** YYYY-MM-DD from an ISO timestamp, falling back to a unix-seconds timestamp. */
export function contractDate(iso: string | null | undefined, unixSeconds?: number | null): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? "")
  if (m) return m[1]
  if (typeof unixSeconds === "number" && Number.isFinite(unixSeconds) && unixSeconds > 0) {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
  }
  return null
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null
  const t = decodeHtmlEntities(value).replace(/\s+/g, " ").trim()
  return t || null
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Display location: JSearch's own `job_location`, else "city, state, country". */
function location(j: JSearchJob): string | null {
  const own = str(j.job_location)
  if (own) return own
  const parts = [str(j.job_city), str(j.job_state), str(j.job_country)].filter((p): p is string => !!p)
  return parts.length ? parts.join(", ") : null
}

function salary(j: JSearchJob): Salary | null {
  const min = num(j.job_min_salary)
  const max = num(j.job_max_salary)
  if (min === null && max === null) return null
  return { min, max, currency: str(j.job_salary_currency), period: str(j.job_salary_period) }
}

function applyOptions(j: JSearchJob): ApplyOption[] {
  if (!Array.isArray(j.apply_options)) return []
  const out: ApplyOption[] = []
  for (const o of j.apply_options) {
    const url = str(o?.apply_link)
    if (url) out.push({ publisher: str(o?.publisher), url, is_direct: bool(o?.is_direct) })
  }
  return out
}

function employmentType(j: JSearchJob): string | null {
  const one = str(j.job_employment_type)
  if (one) return one
  if (Array.isArray(j.job_employment_types)) {
    const all = j.job_employment_types.map(str).filter((t): t is string => !!t)
    if (all.length) return all.join(", ")
  }
  return null
}

/** Reshape a JSearch job into the contract result. Null when it has no job_id. */
export function toResult(j: JSearchJob): JobResult | null {
  const id = typeof j.job_id === "string" ? j.job_id.trim() : ""
  if (!id) return null
  return {
    id,
    title: str(j.job_title) ?? "(untitled)",
    company: str(j.employer_name),
    location: location(j),
    date: contractDate(j.job_posted_at_datetime_utc, j.job_posted_at_timestamp),
    url: str(j.job_apply_link) ?? applyOptions(j)[0]?.url ?? null,
    remote: bool(j.job_is_remote),
    employment_type: employmentType(j),
    salary: salary(j),
    publisher: str(j.job_publisher),
    apply_is_direct: bool(j.job_apply_is_direct),
    source: "jsearch",
  }
}

function highlightList(h: JSearchJob["job_highlights"], key: string): string[] {
  const list = h?.[key]
  if (!Array.isArray(list)) return []
  return list.map(str).filter((s): s is string => !!s)
}

export function toDetail(j: JSearchJob): JobDetailResult | null {
  const base = toResult(j)
  if (!base) return null
  return {
    ...base,
    deadline: contractDate(j.job_offer_expiration_datetime_utc, j.job_offer_expiration_timestamp),
    employer_website: str(j.employer_website),
    description: cleanText(j.job_description),
    highlights: {
      qualifications: highlightList(j.job_highlights, "Qualifications"),
      responsibilities: highlightList(j.job_highlights, "Responsibilities"),
      benefits: highlightList(j.job_highlights, "Benefits"),
    },
    apply_options: applyOptions(j),
  }
}

/**
 * Drop results dated before the last `days` days. Results with no date are kept
 * (the contract reports them as `date: null`; /scrape decides). Used to narrow a
 * date_posted bucket wider than the requested --jobage.
 */
export function withinDays(rows: JobResult[], days: number | undefined, now = Date.now()): JobResult[] {
  if (days === undefined) return rows
  const today = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  )
  const cutoff = today - days * 86_400_000
  return rows.filter((r) => {
    if (!r.date) return true
    const t = Date.parse(`${r.date}T00:00:00Z`)
    return Number.isNaN(t) || t >= cutoff
  })
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/**
 * JSearch descriptions are plain text with newlines (occasionally with stray
 * tags or entities from the source board). Keep paragraph breaks, strip tags,
 * decode entities, collapse runs of blank lines. Null for empty input.
 */
export function cleanText(text: string | null | undefined): string | null {
  if (!text) return null
  const out = decodeHtmlEntities(
    text
      .replace(/\r\n?/g, "\n")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return out || null
}

/**
 * Accept a bare JSearch job_id (the `id` of a search result: a base64-style token
 * such as "Xk1HqJ3vZbQAAAAAAAAAAA==") and reject everything else. Any URL - an
 * apply link on LinkedIn, Indeed, or an employer site, which is what a search
 * result's own `url` carries - is rejected: JSearch has no posting URL of its own,
 * and reducing a foreign URL to a path segment would ask the API for an id that
 * never existed (and spend a request doing it).
 */
export function normalizeJobId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > 512) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null // any scheme://
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/|$|\?)/i.test(trimmed)) return null // host.tld/...
  if (/^[A-Za-z0-9+/=_-]+$/.test(trimmed)) return trimmed
  return null
}
