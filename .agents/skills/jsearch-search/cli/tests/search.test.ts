import { describe, expect, test } from "bun:test";
import { FAKE_TOKEN, daysAgo, parseJSON, runAgainst, serveFixture } from "./helpers";

// The real CLI against the synthetic search fixture over loopback. These pin
// what goes out (params, headers, host) and what comes back (contract shape).

const SEARCH = serveFixture("search-response.json");

describe("search request mapping", () => {
  test("query + location become one query string; country defaults to us; one page per call", async () => {
    const { result, requests } = await runAgainst(["search", "-q", "data analyst", "-l", "Houston, TX"], SEARCH);
    expect(result.exitCode).toBe(0);
    expect(requests).toHaveLength(1);
    const p = requests[0].url.searchParams;
    expect(requests[0].url.pathname).toBe("/search");
    expect(p.get("query")).toBe("data analyst in Houston, TX");
    expect(p.get("country")).toBe("us");
    expect(p.get("page")).toBe("1");
    expect(p.get("num_pages")).toBe("1");
    expect(p.get("date_posted")).toBe("all");
    expect(p.has("work_from_home")).toBe(false);
    expect(p.has("employment_types")).toBe(false);
  });

  test("RapidAPI is the default provider and gets its two headers", async () => {
    const { requests } = await runAgainst(["search", "-q", "nurse"], SEARCH);
    expect(requests[0].origin).toBe("https://jsearch.p.rapidapi.com");
    expect(requests[0].headers.get("x-rapidapi-key")).toBe(FAKE_TOKEN);
    expect(requests[0].headers.get("x-rapidapi-host")).toBe("jsearch.p.rapidapi.com");
    expect(requests[0].headers.get("x-api-key")).toBeNull();
    expect(requests[0].headers.get("user-agent")).toContain("jsearch-cli");
  });

  test("JSEARCH_PROVIDER=openwebninja uses the direct host, path prefix and x-api-key", async () => {
    const { result, requests } = await runAgainst(["search", "-q", "nurse"], SEARCH, {
      JSEARCH_API_TOKEN: FAKE_TOKEN,
      JSEARCH_PROVIDER: "openwebninja",
    });
    expect(result.exitCode).toBe(0);
    expect(requests[0].origin).toBe("https://api.openwebninja.com");
    expect(requests[0].url.pathname).toBe("/jsearch/search");
    expect(requests[0].headers.get("x-api-key")).toBe(FAKE_TOKEN);
    expect(requests[0].headers.get("x-rapidapi-key")).toBeNull();
    expect(parseJSON(result).meta.provider).toBe("openwebninja");
  });

  for (const [days, bucket] of [
    ["1", "today"],
    ["2", "3days"],
    ["3", "3days"],
    ["7", "week"],
    ["14", "month"],
    ["30", "month"],
    ["60", "all"],
  ]) {
    test(`--jobage ${days} sends date_posted=${bucket}`, async () => {
      const { result, requests } = await runAgainst(["search", "-q", "analyst", "--jobage", days], SEARCH);
      expect(result.exitCode).toBe(0);
      expect(requests[0].url.searchParams.get("date_posted")).toBe(bucket);
    });
  }

  test("--remote, --country, --employment-type, --requirements, --page, --pages map to JSearch params", async () => {
    const { result, requests } = await runAgainst(
      [
        "search", "-q", "engineer", "--remote", "--country", "CA",
        "--employment-type", "full-time,Contract", "--requirements", "no_degree,under_3_years_experience",
        "--page", "3", "--pages", "2",
      ],
      SEARCH,
    );
    expect(result.exitCode).toBe(0);
    const p = requests[0].url.searchParams;
    expect(p.get("work_from_home")).toBe("true");
    expect(p.get("country")).toBe("ca");
    expect(p.get("employment_types")).toBe("FULLTIME,CONTRACTOR");
    expect(p.get("job_requirements")).toBe("no_degree,under_3_years_experience");
    expect(p.get("page")).toBe("3");
    expect(p.get("num_pages")).toBe("2");
  });

  test("--remote remote is accepted as the same remote-only filter", async () => {
    const { requests } = await runAgainst(["search", "-q", "engineer", "--remote", "remote"], SEARCH);
    expect(requests[0].url.searchParams.get("work_from_home")).toBe("true");
  });
});

describe("search result normalisation", () => {
  test("emits the contract shape with every field present (null when missing)", async () => {
    const { result } = await runAgainst(["search", "-q", "data analyst", "-l", "Houston, TX"], SEARCH);
    const out = parseJSON(result);
    // The fixture's row without a job_id is dropped.
    expect(out.meta).toMatchObject({ count: 5, page: 1, pages: 1, returned: 5, dropped_by_jobage: 0, provider: "rapidapi" });
    expect(out.results).toHaveLength(5);
    for (const r of out.results) {
      for (const key of ["id", "title", "company", "location", "date", "url", "remote", "employment_type", "salary", "publisher", "source"]) {
        expect(r).toHaveProperty(key);
      }
      expect(r.source).toBe("jsearch");
    }

    expect(out.results[0]).toEqual({
      id: "Xk1HqJ3vZbQAAAAAAAAAAA==",
      title: "Data Analyst",
      company: "Contoso Energy",
      location: "Houston, TX",
      date: "2026-10-19",
      url: "https://jobs.example.net/view/0000000001",
      remote: false,
      employment_type: "Full-time",
      salary: { min: 72000, max: 90000, currency: null, period: "YEAR" },
      publisher: "LinkedIn",
      apply_is_direct: false,
      source: "jsearch",
    });

    const [, remote, contract, , sparse] = out.results;
    expect(remote.location).toBe("Houston, TX, US"); // built from city/state/country
    expect(remote.remote).toBe(true);
    expect(remote.salary).toBeNull();
    expect(contract.title).toBe("R&D Data Analyst (Contract)"); // entity decoded
    expect(contract.employment_type).toBe("CONTRACTOR"); // from job_employment_types
    expect(contract.salary).toEqual({ min: 45, max: 55, currency: "USD", period: "HOUR" });
    expect(sparse.company).toBeNull();
    expect(sparse.date).toBeNull();
    expect(sparse.url).toBe("https://reviews.example.com/job-listing/analytics-engineer-9"); // first apply option
    expect(sparse.location).toBe("US");
  });

  test("--limit caps the emitted results client-side", async () => {
    const { result } = await runAgainst(["search", "-q", "analyst", "--limit", "2"], SEARCH);
    const out = parseJSON(result);
    expect(out.results).toHaveLength(2);
    expect(out.meta.count).toBe(2);
    expect(out.meta.returned).toBe(5);
  });

  test("--jobage narrows a wider date_posted bucket to the exact window, keeping undated rows", async () => {
    const recent = serveFixture("search-response.json", (body) => {
      const ages = [1, 2, 10, 20]; // days old; the 5th row stays undated
      ages.forEach((age, i) => (body.data[i].job_posted_at_datetime_utc = `${daysAgo(age)}T08:00:00.000Z`));
      return body;
    });
    const { result, requests } = await runAgainst(["search", "-q", "analyst", "--jobage", "14"], recent);
    expect(requests[0].url.searchParams.get("date_posted")).toBe("month");
    const out = parseJSON(result);
    expect(out.results.map((r: any) => r.id)).toEqual([
      "Xk1HqJ3vZbQAAAAAAAAAAA==",
      "pQ7rT2uVwXyAAAAAAAAAAA==",
      "aB3cD4eF5gHAAAAAAAAAAA==",
      "mN1oP2qR3sTAAAAAAAAAAA==",
    ]);
    expect(out.meta.dropped_by_jobage).toBe(1);
  });

  test("an empty data array is zero results, exit 0", async () => {
    const { result } = await runAgainst(["search", "-q", "zzz"], () =>
      Response.json({ status: "OK", request_id: "x", data: [] }),
    );
    expect(parseJSON(result)).toMatchObject({ meta: { count: 0 }, results: [] });
  });
});

describe("search output formats", () => {
  test("table shows untruncated ids and the key columns", async () => {
    const { result } = await runAgainst(["search", "-q", "analyst", "--format", "table"], SEARCH);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines[0]).toMatch(/^ID\s+TITLE\s+COMPANY\s+LOCATION\s+DATE\s+VIA/);
    expect(lines[1]).toMatch(/^-+$/);
    expect(lines).toHaveLength(2 + 5);
    expect(result.stdout).toContain("Xk1HqJ3vZbQAAAAAAAAAAA==");
    expect(result.stdout).toContain("Contoso Energy");
    expect(result.stdout).toContain("2026-10-19");
    expect(result.stdout).toContain("Remote - Houston, TX");
  });

  test("plain shows title, company/location/date, salary, id and apply link per job", async () => {
    const { result } = await runAgainst(["search", "-q", "analyst", "--format", "plain", "-n", "3"], SEARCH);
    expect(result.exitCode).toBe(0);
    const blocks = result.stdout.split("\n\n");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("Data Analyst\n  Contoso Energy · Houston, TX · 2026-10-19");
    expect(blocks[0]).toContain("72000–90000/year");
    expect(blocks[0]).toContain("id: Xk1HqJ3vZbQAAAAAAAAAAA==");
    expect(blocks[0]).toContain("via LinkedIn: https://jobs.example.net/view/0000000001");
    expect(blocks[2]).toContain("USD 45–55/hour");
  });

  test("table with no results says so", async () => {
    const { result } = await runAgainst(["search", "-q", "zzz", "--format", "table"], () =>
      Response.json({ status: "OK", data: [] }),
    );
    expect(result.stdout).toBe("No results.");
  });
});
