import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");

/** An obviously fake key; tests assert it never reaches stdout or stderr. */
export const FAKE_TOKEN = "test-key-DO-NOT-PRINT-8f3a1c";

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** The parent env minus any real JSearch settings, so a developer's own key is never used. */
function cleanEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("JSEARCH_")) env[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

export async function runCLI(
  args: string[],
  opts: { env?: Record<string, string | undefined>; preload?: string } = {},
): Promise<CLIResult> {
  const proc = Bun.spawn(
    ["bun", "run", ...(opts.preload ? ["--preload", opts.preload] : []), CLI_PATH, ...args],
    { stdout: "pipe", stderr: "pipe", env: cleanEnv(opts.env ?? {}) },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export interface RecordedRequest {
  origin: string; // the JSearch origin the CLI addressed, before the loopback redirect
  url: URL; // the loopback URL (path + query as the CLI built them)
  headers: Headers;
}

export type Handler = (req: RecordedRequest, n: number) => Response | Promise<Response>;

export async function fixture(name: string): Promise<any> {
  return Bun.file(join(import.meta.dir, "fixtures", name)).json();
}

/**
 * Run the real CLI in a child process with fetch redirected: requests to the two
 * JSearch API origins go to a loopback server driven by `handler`; anything else
 * throws. Nothing leaves the machine. `requests` records what the CLI sent.
 */
export async function runAgainst(
  args: string[],
  handler: Handler,
  env: Record<string, string | undefined> = { JSEARCH_API_TOKEN: FAKE_TOKEN },
): Promise<{ result: CLIResult; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const rec: RecordedRequest = {
        origin: request.headers.get("x-test-origin") ?? "",
        url: new URL(request.url),
        headers: request.headers,
      };
      requests.push(rec);
      return handler(rec, requests.length);
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "jsearch-cli-test-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(
    preload,
    `
    const originalFetch = globalThis.fetch;
    const ALLOWED = new Set(["https://jsearch.p.rapidapi.com", "https://api.openwebninja.com"]);
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!ALLOWED.has(url.origin)) throw new Error("Unexpected request to " + url.origin);
      const headers = new Headers(init?.headers);
      headers.set("x-test-origin", url.origin);
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, { ...init, headers });
    };
  `,
  );
  try {
    return { result: await runCLI(args, { env, preload }), requests };
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A handler that always answers with the given fixture file. */
export function serveFixture(name: string, transform?: (body: any) => any): Handler {
  return async () => {
    const body = await fixture(name);
    return Response.json(transform ? transform(body) : body);
  };
}

/** A handler that fails the test if the CLI makes any request at all. */
export const noRequests: Handler = () => new Response("unexpected request", { status: 418 });

export function parseJSON<T = any>(result: CLIResult): T {
  if (result.exitCode !== 0) {
    throw new Error(`CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`Failed to parse JSON. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

export function parseError(result: CLIResult): { error?: string; code?: string } {
  try {
    return JSON.parse(result.stderr);
  } catch {
    return {};
  }
}

/** YYYY-MM-DD for `days` days before now (UTC). */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
