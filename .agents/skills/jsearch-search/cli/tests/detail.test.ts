import { describe, expect, test } from "bun:test";
import { noRequests, parseError, parseJSON, runAgainst, serveFixture } from "./helpers";

const DETAIL = serveFixture("job-details-response.json");
const ID = "Xk1HqJ3vZbQAAAAAAAAAAA==";

describe("detail", () => {
  test("sends job_id to /job-details and returns description, highlights, apply options, deadline", async () => {
    const { result, requests } = await runAgainst(["detail", ID], DETAIL);
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/job-details");
    expect(requests[0].url.searchParams.get("job_id")).toBe(ID);
    expect(requests[0].url.searchParams.has("country")).toBe(false);

    const job = parseJSON(result);
    expect(job).toMatchObject({
      id: ID,
      title: "Data Analyst",
      company: "Contoso Energy",
      location: "Houston, TX",
      date: "2026-10-19",
      deadline: "2026-11-18",
      url: "https://jobs.example.net/view/0000000001",
      publisher: "LinkedIn",
      employer_website: "https://www.contoso-energy.example",
      source: "jsearch",
    });
    // CRLF normalised, blank-line runs collapsed, entity decoded, <br> -> newline.
    expect(job.description).toBe(
      "Contoso Energy is hiring a Data Analyst for its Houston office.\n\n" +
        "You will build dashboards in Power BI & write SQL against our operations warehouse.\nHybrid: 3 days on site.",
    );
    expect(job.highlights.qualifications).toHaveLength(3);
    expect(job.highlights.responsibilities).toEqual([
      "Build and maintain operational dashboards",
      "Partner with field operations on KPIs",
    ]);
    expect(job.highlights.benefits).toContain("401(k) match");
    expect(job.apply_options).toHaveLength(3);
    expect(job.apply_options[1]).toEqual({
      publisher: "Contoso Energy Careers",
      url: "https://careers.contoso-energy.example/jobs/4411",
      is_direct: true,
    });
  });

  test("--country is passed through when given", async () => {
    const { requests } = await runAgainst(["detail", ID, "--country", "us"], DETAIL);
    expect(requests[0].url.searchParams.get("country")).toBe("us");
  });

  test("--format plain renders a readable posting with highlights and other apply options", async () => {
    const { result } = await runAgainst(["detail", ID, "--format", "plain"], DETAIL);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith("Data Analyst\nContoso Energy · Houston, TX")).toBe(true);
    expect(result.stdout).toContain("Deadline: 2026-11-18");
    expect(result.stdout).toContain("Salary: 72000–90000/year");
    expect(result.stdout).toContain("Qualifications:\n  - 2+ years of SQL");
    expect(result.stdout).toContain("Apply (via LinkedIn): https://jobs.example.net/view/0000000001");
    expect(result.stdout).toContain("  - Contoso Energy Careers (direct): https://careers.contoso-energy.example/jobs/4411");
    expect(result.stdout).toContain(`id: ${ID}`);
  });

  test("an empty data array is NOT_FOUND", async () => {
    const { result } = await runAgainst(["detail", ID], () => Response.json({ status: "OK", data: [] }));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(parseError(result).code).toBe("NOT_FOUND");
  });

  test("a 404 is NOT_FOUND, not a crash", async () => {
    const { result } = await runAgainst(["detail", ID], () => new Response("", { status: 404 }));
    expect(parseError(result).code).toBe("NOT_FOUND");
  });

  test("ids are URL-encoded (base64 + and / survive)", async () => {
    const id = "ab+cd/ef==";
    const { requests } = await runAgainst(["detail", id], DETAIL);
    expect(requests[0].url.search).toContain("job_id=ab%2Bcd%2Fef%3D%3D");
    expect(requests[0].url.searchParams.get("job_id")).toBe(id);
  });

  for (const url of [
    "https://www.linkedin.com/jobs/view/4426311357",
    "http://jsearch.p.rapidapi.com/job-details?job_id=x",
    "www.indeed.com/viewjob?jk=abc",
    "careers.example.com/jobs/123",
    "ftp://example.com/x",
  ]) {
    test(`rejects a URL with BAD_ID before any request: ${url}`, async () => {
      const { result, requests } = await runAgainst(["detail", url], noRequests);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(parseError(result).code).toBe("BAD_ID");
      expect(requests).toHaveLength(0);
    });
  }

  test("BAD_ID is reported even without an API key (no key lookup for a bad id)", async () => {
    const { result } = await runAgainst(["detail", "https://www.indeed.com/viewjob?jk=1"], noRequests, {});
    expect(parseError(result).code).toBe("BAD_ID");
  });

  test("a missing id is NO_ID", async () => {
    const { result, requests } = await runAgainst(["detail"], noRequests);
    expect(parseError(result).code).toBe("NO_ID");
    expect(requests).toHaveLength(0);
  });

  test("--format table is not offered for detail", async () => {
    const { result } = await runAgainst(["detail", ID, "--format", "table"], noRequests);
    expect(parseError(result).code).toBe("BAD_ARG");
  });
});
