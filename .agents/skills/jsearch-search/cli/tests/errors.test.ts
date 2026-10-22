import { describe, expect, test } from "bun:test";
import { FAKE_TOKEN, noRequests, parseError, runAgainst, runCLI, serveFixture } from "./helpers";

// Every failure is stderr JSON + exit 1, nothing on stdout, and - for anything
// the CLI can know up front - before a billed request is made.

describe("credentials", () => {
  test("missing JSEARCH_API_TOKEN is MISSING_CREDENTIALS, naming the variable, with no request", async () => {
    const { result, requests } = await runAgainst(["search", "-q", "nurse"], noRequests, {});
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = parseError(result);
    expect(err.code).toBe("MISSING_CREDENTIALS");
    expect(err.error).toContain("JSEARCH_API_TOKEN");
    expect(requests).toHaveLength(0);
  });

  test("a whitespace-only token counts as missing", async () => {
    const { result, requests } = await runAgainst(["detail", "Xk1HqJ3vZbQAAAAAAAAAAA=="], noRequests, {
      JSEARCH_API_TOKEN: "   ",
    });
    expect(parseError(result).code).toBe("MISSING_CREDENTIALS");
    expect(requests).toHaveLength(0);
  });

  test("an unknown JSEARCH_PROVIDER is BAD_ARG with no request", async () => {
    const { result, requests } = await runAgainst(["search", "-q", "nurse"], noRequests, {
      JSEARCH_API_TOKEN: FAKE_TOKEN,
      JSEARCH_PROVIDER: "indeed",
    });
    expect(parseError(result).code).toBe("BAD_ARG");
    expect(requests).toHaveLength(0);
  });

  test("401/403 are AUTH with a hint, and the key never appears in the output", async () => {
    for (const status of [401, 403]) {
      const { result } = await runAgainst(["search", "-q", "nurse"], () =>
        // A gateway echoing the key back must still not leak it.
        Response.json({ message: `Invalid API key ${FAKE_TOKEN}` }, { status }),
      );
      expect(result.exitCode).toBe(1);
      const err = parseError(result);
      expect(err.code).toBe("AUTH");
      expect(err.error).toContain("JSEARCH_API_TOKEN");
      expect(err.error).toContain("JSEARCH_PROVIDER");
      expect(result.stderr).not.toContain(FAKE_TOKEN);
      expect(result.stdout).not.toContain(FAKE_TOKEN);
      expect(result.stderr).toContain("[REDACTED]");
    }
  });

  test("the key is never printed on success either", async () => {
    for (const format of ["json", "table", "plain"]) {
      const { result } = await runAgainst(["search", "-q", "nurse", "--format", format], serveFixture("search-response.json"));
      expect(result.exitCode).toBe(0);
      expect(result.stdout + result.stderr).not.toContain(FAKE_TOKEN);
    }
  });
});

describe("upstream errors", () => {
  test("a 429 naming the quota fails at once with QUOTA_EXCEEDED (no retry loop)", async () => {
    const { result, requests } = await runAgainst(["search", "-q", "nurse"], () =>
      Response.json({ message: "You have exceeded the MONTHLY quota for Requests on your current plan, BASIC." }, { status: 429 }),
    );
    expect(parseError(result).code).toBe("QUOTA_EXCEEDED");
    expect(requests).toHaveLength(1);
  });

  test("a 429 with Retry-After is honoured, then the retry succeeds", async () => {
    const started = Date.now();
    const { result, requests } = await runAgainst(["search", "-q", "nurse"], async (_req, n) =>
      n === 1
        ? new Response("Too many requests", { status: 429, headers: { "Retry-After": "1" } })
        : Response.json(await Bun.file(`${import.meta.dir}/fixtures/search-response.json`).json()),
    );
    expect(result.exitCode).toBe(0);
    expect(requests).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
  });

  test("a Retry-After past the budget fails fast with RATE_LIMITED", async () => {
    const { result, requests } = await runAgainst(["search", "-q", "nurse"], () =>
      new Response("slow down", { status: 429, headers: { "Retry-After": "120" } }),
    );
    const err = parseError(result);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.error).toContain("retry budget");
    expect(requests).toHaveLength(1);
  });

  test('a 200 with status "ERROR" is API_ERROR carrying the message', async () => {
    const { result } = await runAgainst(["search", "-q", "nurse"], () =>
      Response.json({ status: "ERROR", request_id: "x", error: { message: "Invalid parameter: country", code: 400 } }),
    );
    const err = parseError(result);
    expect(err.code).toBe("API_ERROR");
    expect(err.error).toContain("Invalid parameter: country");
  });

  test("a 400 is API_ERROR with the upstream message", async () => {
    const { result } = await runAgainst(["search", "-q", "nurse"], () =>
      Response.json({ status: "ERROR", error: { message: "query is required" } }, { status: 400 }),
    );
    expect(parseError(result)).toMatchObject({ code: "API_ERROR", error: "query is required" });
  });
});

describe("flag validation happens before credentials and requests", () => {
  test("an unknown flag is UNKNOWN_FLAG even with no key set", async () => {
    const { result, requests } = await runAgainst(["search", "-q", "nurse", "--salary", "100000"], noRequests, {});
    expect(result.exitCode).toBe(1);
    const err = parseError(result);
    expect(err.code).toBe("UNKNOWN_FLAG");
    expect(err.error).toContain("--salary");
    expect(requests).toHaveLength(0);
  });

  test("detail rejects search-only flags as UNKNOWN_FLAG", async () => {
    const { result } = await runAgainst(["detail", "Xk1HqJ3vZbQAAAAAAAAAAA==", "--jobage", "7"], noRequests);
    expect(parseError(result).code).toBe("UNKNOWN_FLAG");
  });

  const badArgs: string[][] = [
    ["search"], // no --query
    ["search", "-q"], // bare --query
    ["search", "-q", "  "],
    ["search", "-q", "x", "-l"],
    ["search", "-q", "x", "--jobage", "0"],
    ["search", "-q", "x", "--jobage", "1.5"],
    ["search", "-q", "x", "--jobage", "week"],
    ["search", "-q", "x", "--limit", "0"],
    ["search", "-q", "x", "--page", "0"],
    ["search", "-q", "x", "--pages", "11"],
    ["search", "-q", "x", "--country", "usa"],
    ["search", "-q", "x", "--remote", "hybrid"],
    ["search", "-q", "x", "--employment-type", "seasonal"],
    ["search", "-q", "x", "--requirements", "phd"],
    ["search", "-q", "x", "--format", "csv"],
    ["search", "stray", "-q", "x"],
  ];
  for (const args of badArgs) {
    test(`${args.join(" ")} -> BAD_ARG, no request`, async () => {
      const { result, requests } = await runAgainst(args, noRequests);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(parseError(result).code).toBe("BAD_ARG");
      expect(requests).toHaveLength(0);
    });
  }

  test("an unknown command is BAD_CMD", async () => {
    const result = await runCLI(["scrape"]);
    expect(result.exitCode).toBe(1);
    expect(parseError(result).code).toBe("BAD_CMD");
  });

  test("--help prints usage without a key", async () => {
    const result = await runCLI(["search", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("JSEARCH_API_TOKEN");
    expect(result.stdout).toContain("--jobage");
  });

  test("no command prints usage and exits 1", async () => {
    const result = await runCLI([]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("USAGE");
  });
});
