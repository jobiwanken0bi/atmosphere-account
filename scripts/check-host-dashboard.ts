#!/usr/bin/env -S deno run -A
import {
  fetchHostDashboardManifest,
  hostDashboardManifestUrl,
  validateHostDashboardManifest,
} from "../lib/host-dashboard.ts";

interface CliOptions {
  input: string | null;
  expectedHost: string | null;
  json: boolean;
}

const options = parseArgs(Deno.args);
if (!options.input) {
  console.error(
    "Usage: deno task host:dashboard:check <host|manifest-url|file> [--host=example.social] [--json]",
  );
  Deno.exit(2);
}

const result = await validateInput(options);
if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHumanResult(result);
}
Deno.exit(result.ok ? 0 : 1);

async function validateInput(options: CliOptions) {
  const input = options.input!;
  const file = await readJsonFileIfPresent(input);
  if (file.ok) {
    return {
      source: input,
      ...validateHostDashboardManifest(file.value, {
        expectedHost: options.expectedHost ?? undefined,
      }),
    };
  }
  if (!looksLikeRemoteInput(input)) {
    return {
      source: input,
      ok: false,
      manifest: null,
      issues: [{
        severity: "error" as const,
        path: "$",
        message: file.error ?? "Input is not a file, host, or URL.",
      }],
    };
  }
  const url = hostDashboardManifestUrl(input);
  const fetched = await fetchHostDashboardManifest(url ?? input, {
    expectedHost: options.expectedHost ?? undefined,
  });
  return { source: fetched.url, ...fetched };
}

async function readJsonFileIfPresent(
  input: string,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string | null }> {
  try {
    const info = await Deno.stat(input);
    if (!info.isFile) return { ok: false, error: "Input path is not a file." };
    return { ok: true, value: JSON.parse(await Deno.readTextFile(input)) };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { ok: false, error: null };
    }
    if (err instanceof SyntaxError) {
      return { ok: false, error: `File is not valid JSON: ${err.message}` };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function printHumanResult(result: Awaited<ReturnType<typeof validateInput>>) {
  console.log(
    result.ok ? `OK: ${result.source}` : `FAILED: ${result.source}`,
  );
  if (result.manifest) {
    console.log(`Host: ${result.manifest.host}`);
    if (result.manifest.dashboardUrl) {
      console.log(`Dashboard: ${result.manifest.dashboardUrl}`);
    }
  }
  if (result.issues.length === 0) {
    console.log("No issues found.");
    return;
  }
  for (const issue of result.issues) {
    console.log(
      `${issue.severity.toUpperCase()} ${issue.path}: ${issue.message}`,
    );
  }
}

function parseArgs(args: string[]): CliOptions {
  let input: string | null = null;
  let expectedHost: string | null = null;
  let json = false;
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else if (arg.startsWith("--host=")) {
      expectedHost = arg.slice("--host=".length).trim() || null;
    } else if (!input) {
      input = arg;
    }
  }
  return { input, expectedHost, json };
}

function looksLikeRemoteInput(input: string): boolean {
  return input.includes("://") || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(input);
}
