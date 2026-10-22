import { afterEach, describe, expect, test } from "bun:test";
import {
  PROVIDERS,
  RETRY_BUDGET_MS,
  apiGet,
  contractDate,
  jobageToDatePosted,
  normalizeJobId,
  parseEmploymentTypes,
  parseJobRequirements,
  redact,
  resolveProvider,
  resolveToken,
  retryAfterMs,
  toResult,
  withinDays,
  type JobResult,
} from "../src/helpers";

// In-process unit tests: pure mapping helpers, plus apiGet's retry loop with a
// stubbed fetch and instant timers (no sleeping through the real backoff).

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function recordWaits(): number[] {
  const waits: number[] = [];
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    waits.push(ms ?? 0);
    return originalSetTimeout(fn, 0);
  }) as unknown as typeof setTimeout;
  return waits;
}

function stubFetch(responses: Array<() => Response>): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    const i = Math.min(state.calls, responses.length - 1);
    state.calls++;
    return responses[i]();
  }) as unknown as typeof fetch;
  return state;
}

const P = PROVIDERS.rapidapi;
const get = () => apiGet(P, "k", "/search", new URLSearchParams({ query: "x" }));

describe("apiGet retry/backoff", () => {
  test("retries a 429 and succeeds", async () => {
    recordWaits();
    const state = stubFetch([() => new Response("", { status: 429 }), () => Response.json({ status: "OK", data: [] })]);
    expect(await get()).toEqual({ status: "OK", data: [] });
    expect(state.calls).toBe(2);
  });

  test("gives up after the first attempt plus six retries on persistent 5xx, within budget", async () => {
    const waits = recordWaits();
    const state = stubFetch([() => new Response("", { status: 502 })]);
    await expect(get()).rejects.toThrow(/502/);
    expect(state.calls).toBe(7);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(RETRY_BUDGET_MS);
  });

  test("waits as long as Retry-After asks", async () => {
    const waits = recordWaits();
    stubFetch([
      () => new Response("", { status: 429, headers: { "Retry-After": "12" } }),
      () => Response.json({ data: [] }),
    ]);
    await get();
    expect(waits).toEqual([12_000]);
  });

  test("bounds the total wait across repeated Retry-Afters", async () => {
    const waits = recordWaits();
    const state = stubFetch([() => new Response("", { status: 503, headers: { "Retry-After": "12" } })]);
    await expect(get()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(waits).toEqual([12_000, 12_000]);
    expect(state.calls).toBe(3);
  });

  test("keeps its own backoff when Retry-After asks for less", async () => {
    const waits = recordWaits();
    stubFetch([() => new Response("", { status: 429, headers: { "Retry-After": "0" } }), () => Response.json({ data: [] })]);
    await get();
    expect(waits[0]).toBeGreaterThanOrEqual(500);
  });

  test("a connection failure fails fast with NETWORK, no retry", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new TypeError("Unable to connect");
    }) as unknown as typeof fetch;
    await expect(get()).rejects.toMatchObject({ code: "NETWORK" });
    expect(calls).toBe(1);
  });

  test("404 is null without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 404 })]);
    expect(await get()).toBeNull();
    expect(state.calls).toBe(1);
  });

  test("parses delta-seconds and HTTP-dates, ignores junk", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    expect(retryAfterMs("2", now)).toBe(2_000);
    expect(retryAfterMs("Sun, 18 Oct 2026 12:00:30 GMT", now)).toBe(30_000);
    expect(retryAfterMs("Sun, 18 Oct 2026 11:59:00 GMT", now)).toBe(0);
    expect(retryAfterMs(null, now)).toBeNull();
    expect(retryAfterMs("soon", now)).toBeNull();
  });
});

describe("mapping helpers", () => {
  test("jobage -> the smallest date_posted bucket covering the window", () => {
    expect(jobageToDatePosted(undefined)).toBe("all");
    expect([1, 2, 3, 4, 7, 8, 14, 30, 31, 365].map(jobageToDatePosted)).toEqual([
      "today", "3days", "3days", "week", "week", "month", "month", "month", "all", "all",
    ]);
  });

  test("employment types normalise common spellings and reject unknowns", () => {
    expect(parseEmploymentTypes("full-time, part_time,contract,Internship,FULLTIME")).toEqual({
      value: "FULLTIME,PARTTIME,CONTRACTOR,INTERN",
    });
    expect(parseEmploymentTypes("temp").bad).toBe("temp");
    expect(parseEmploymentTypes(" , ").bad).toBeDefined();
  });

  test("job requirements accept only the documented values", () => {
    expect(parseJobRequirements("NO_DEGREE,no_experience")).toEqual({ value: "no_degree,no_experience" });
    expect(parseJobRequirements("senior").bad).toBe("senior");
  });

  test("contractDate prefers the ISO string, falls back to unix seconds", () => {
    expect(contractDate("2026-10-19T00:00:00.000Z")).toBe("2026-10-19");
    expect(contractDate(null, 1792368000)).toBe("2026-10-19");
    expect(contractDate(undefined, null)).toBeNull();
    expect(contractDate("3 days ago")).toBeNull();
  });

  test("toResult drops rows without a job_id and nulls absent fields", () => {
    expect(toResult({ job_title: "x" })).toBeNull();
    expect(toResult({ job_id: "abc" })).toEqual({
      id: "abc", title: "(untitled)", company: null, location: null, date: null, url: null,
      remote: null, employment_type: null, salary: null, publisher: null, apply_is_direct: null, source: "jsearch",
    });
  });

  test("withinDays keeps rows inside the window and undated rows", () => {
    const now = Date.parse("2026-10-22T15:00:00Z");
    const row = (date: string | null) => ({ id: date ?? "none", date }) as JobResult;
    const rows = [row("2026-10-22"), row("2026-10-08"), row("2026-10-07"), row(null)];
    expect(withinDays(rows, 14, now).map((r) => r.id)).toEqual(["2026-10-22", "2026-10-08", "none"]);
    expect(withinDays(rows, undefined, now)).toHaveLength(4);
  });

  test("normalizeJobId accepts base64-style ids and rejects URLs and junk", () => {
    expect(normalizeJobId(" Xk1HqJ3vZbQAAAAAAAAAAA== ")).toBe("Xk1HqJ3vZbQAAAAAAAAAAA==");
    expect(normalizeJobId("ab+cd/ef==")).toBe("ab+cd/ef==");
    expect(normalizeJobId("a_b-c")).toBe("a_b-c");
    for (const bad of [
      "",
      "https://www.linkedin.com/jobs/view/1",
      "HTTP://jsearch.p.rapidapi.com/job-details",
      "linkedin.com/jobs/view/1",
      "www.indeed.com",
      "jobs.example.com?id=1",
      "id with spaces",
      "a".repeat(600),
    ]) {
      expect(normalizeJobId(bad)).toBeNull();
    }
  });

  test("resolveToken / resolveProvider read only the documented variables", () => {
    expect(() => resolveToken({})).toThrow(/JSEARCH_API_TOKEN/);
    expect(resolveToken({ JSEARCH_API_TOKEN: " k " })).toBe("k");
    expect(resolveProvider({}).name).toBe("rapidapi");
    expect(resolveProvider({ JSEARCH_PROVIDER: "OpenWebNinja" }).name).toBe("openwebninja");
    expect(() => resolveProvider({ JSEARCH_PROVIDER: "x" })).toThrow(/rapidapi/);
  });

  test("redact removes every occurrence of the token", () => {
    expect(redact("a SECRET b SECRET", "SECRET")).toBe("a [REDACTED] b [REDACTED]");
    expect(redact("nothing", undefined)).toBe("nothing");
  });
});
