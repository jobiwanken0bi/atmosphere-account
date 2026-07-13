#!/usr/bin/env -S deno run -A
import { getAccountHost } from "../lib/account-hosts.ts";
import { loadDotEnvIfPresent } from "../lib/cli-env.ts";
import {
  persistHostConformanceReport,
  runHostConformance,
} from "../lib/host-conformance.ts";

interface Options {
  host: string | null;
  manifestUrl: string | null;
  accountUrl: string | null;
  serviceEndpoint: string | null;
  allowLocal: boolean;
  write: boolean;
  json: boolean;
}

const options = parseArgs(Deno.args.filter((arg) => arg !== "--"));
if (!options.host) usage(2);

let storedHost = null;
if (options.write) {
  await loadDotEnvIfPresent();
  storedHost = await getAccountHost(options.host);
  if (!storedHost) {
    console.error(`Host ${options.host} is not registered in the directory.`);
    Deno.exit(2);
  }
}

const serviceEndpoint = options.serviceEndpoint ??
  storedHost?.serviceEndpoint ??
  `https://${options.host}`;
const manifestUrl = options.manifestUrl ?? storedHost?.capabilityManifestUrl ??
  `https://${options.host}/.well-known/atmosphere-host-dashboard.json`;
const accountUrl = options.accountUrl ?? storedHost?.accountManagementUrl ??
  (serviceEndpoint ? `${serviceEndpoint.replace(/\/$/, "")}/account` : null);

const report = await runHostConformance({
  host: options.host,
  manifestUrl,
  accountUrl,
  serviceEndpoint,
  allowLocal: options.allowLocal,
});
if (options.write) await persistHostConformanceReport(report);

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `${report.status === "passed" ? "PASS" : "FAIL"}: ${report.host}`,
  );
  for (const item of report.checks) {
    console.log(`${item.ok ? "PASS" : "FAIL"} ${item.label}: ${item.detail}`);
  }
  if (options.write) {
    console.log(
      `Stored result; badge expires ${
        new Date(report.expiresAt).toISOString()
      }.`,
    );
  }
}
Deno.exit(report.status === "passed" ? 0 : 1);

function parseArgs(args: string[]): Options {
  if (args.includes("--help") || args.includes("-h")) usage(0);
  const knownBoolean = new Set(["--allow-local", "--write", "--json"]);
  let host: string | null = null;
  for (const arg of args) {
    if (
      knownBoolean.has(arg) || arg.startsWith("--manifest-url=") ||
      arg.startsWith("--account-url=") ||
      arg.startsWith("--service-endpoint=")
    ) continue;
    if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      usage(2);
    }
    if (host) {
      console.error(`Unexpected argument: ${arg}`);
      usage(2);
    }
    host = arg.trim().toLowerCase();
  }
  return {
    host,
    manifestUrl: flag(args, "--manifest-url"),
    accountUrl: flag(args, "--account-url"),
    serviceEndpoint: flag(args, "--service-endpoint"),
    allowLocal: args.includes("--allow-local"),
    write: args.includes("--write"),
    json: args.includes("--json"),
  };
}

function flag(args: string[], name: string): string | null {
  const value = args.find((arg) => arg.startsWith(`${name}=`));
  return value?.slice(name.length + 1).trim() || null;
}

function usage(exitCode: number): never {
  const write = exitCode === 0 ? console.log : console.error;
  write([
    "Usage: deno task host:conformance <host> [options]",
    "",
    "Runs the compatibility manifest, account-page reachability, and PDS",
    "health checks. --write persists a seven-day badge result for a registered host.",
    "",
    "Options:",
    "  --manifest-url=<url>",
    "  --account-url=<url>",
    "  --service-endpoint=<origin>",
    "  --write                 Store the report in the configured database.",
    "  --json                  Print machine-readable output.",
    "  --allow-local           Permit loopback HTTP for the mock PDS only.",
  ].join("\n"));
  Deno.exit(exitCode);
}
