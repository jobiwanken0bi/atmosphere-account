import type { AccountHost } from "./account-hosts.ts";
import { type DbClient, withDb } from "./db.ts";
import {
  HOST_DASHBOARD_SPEC_VERSION,
  type HostDashboardManifest,
  validateHostDashboardManifest,
} from "./host-dashboard.ts";
import {
  isPrivateNetworkHostname,
  readResponseTextWithLimit,
} from "./security.ts";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_MANIFEST_BYTES = 64_000;
const CONFORMANCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface HostConformanceCheck {
  id: "manifest" | "account_route" | "pds_health";
  label: string;
  ok: boolean;
  required: true;
  url: string | null;
  detail: string;
}

export interface HostConformanceReport {
  version: "atmosphere.hostConformance.v0.1";
  host: string;
  status: "passed" | "failed";
  checkedAt: number;
  expiresAt: number;
  manifestUrl: string | null;
  accountUrl: string | null;
  serviceEndpoint: string | null;
  manifest: HostDashboardManifest | null;
  checks: HostConformanceCheck[];
}

export async function runHostConformance(input: {
  host: string;
  manifestUrl: string;
  accountUrl?: string | null;
  serviceEndpoint: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  allowLocal?: boolean;
  now?: number;
}): Promise<HostConformanceReport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checkedAt = input.now ?? Date.now();
  const manifestUrl = safeConformanceUrl(input.manifestUrl, input.allowLocal);
  const serviceEndpoint = safeConformanceUrl(
    input.serviceEndpoint,
    input.allowLocal,
    true,
  );
  let manifest: HostDashboardManifest | null = null;
  let manifestCheck: HostConformanceCheck;

  if (!manifestUrl) {
    manifestCheck = check(
      "manifest",
      "Compatibility manifest",
      false,
      null,
      "Manifest URL must be public HTTPS (or loopback HTTP with --allow-local).",
    );
  } else {
    const fetched = await fetchManifest({
      url: manifestUrl,
      host: input.host,
      fetchImpl,
      timeoutMs,
    });
    manifest = fetched.manifest;
    manifestCheck = check(
      "manifest",
      "Compatibility manifest",
      fetched.ok,
      manifestUrl,
      fetched.detail,
    );
  }

  const accountUrl = safeConformanceUrl(
    input.accountUrl ?? manifest?.dashboardUrl ?? null,
    input.allowLocal,
  );
  const accountCheck = accountUrl
    ? await checkReachableHtml(
      accountUrl,
      fetchImpl,
      timeoutMs,
      input.allowLocal,
    )
    : check(
      "account_route",
      "Account management route",
      false,
      null,
      "No safe account-management URL was supplied by the host record or manifest.",
    );

  const healthUrl = serviceEndpoint
    ? new URL("/xrpc/_health", `${serviceEndpoint}/`).toString()
    : null;
  const healthCheck = healthUrl
    ? await checkPdsHealth(healthUrl, fetchImpl, timeoutMs)
    : check(
      "pds_health",
      "PDS health endpoint",
      false,
      null,
      "PDS service endpoint must be public HTTPS (or loopback HTTP with --allow-local).",
    );
  const checks = [manifestCheck, accountCheck, healthCheck];
  const status = checks.every((item) => item.ok) ? "passed" : "failed";
  return {
    version: "atmosphere.hostConformance.v0.1",
    host: input.host.trim().toLowerCase(),
    status,
    checkedAt,
    expiresAt: checkedAt + CONFORMANCE_TTL_MS,
    manifestUrl,
    accountUrl,
    serviceEndpoint,
    manifest,
    checks,
  };
}

export async function persistHostConformanceReport(
  report: HostConformanceReport,
  run: <T>(fn: (client: DbClient) => Promise<T>) => Promise<T> = withDb,
): Promise<void> {
  await run(async (client) => {
    await client.execute({
      sql: `INSERT INTO host_conformance (
          host, status, manifest_url, account_url, service_endpoint,
          report_json, checked_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          status = excluded.status,
          manifest_url = excluded.manifest_url,
          account_url = excluded.account_url,
          service_endpoint = excluded.service_endpoint,
          report_json = excluded.report_json,
          checked_at = excluded.checked_at,
          expires_at = excluded.expires_at`,
      args: [
        report.host,
        report.status,
        report.manifestUrl,
        report.accountUrl,
        report.serviceEndpoint,
        JSON.stringify(report),
        report.checkedAt,
        report.expiresAt,
      ],
    });
  });
}

export function hostHasCurrentConformance(
  host: Pick<AccountHost, "conformanceStatus" | "conformanceExpiresAt">,
  now = Date.now(),
): boolean {
  return host.conformanceStatus === "passed" &&
    typeof host.conformanceExpiresAt === "number" &&
    host.conformanceExpiresAt > now;
}

async function fetchManifest(input: {
  url: string;
  host: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<
  { ok: boolean; manifest: HostDashboardManifest | null; detail: string }
> {
  let response: Response;
  try {
    response = await input.fetchImpl(input.url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      manifest: null,
      detail: errorDetail("fetch failed", err),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      manifest: null,
      detail:
        `Manifest returned HTTP ${response.status}; redirects are not accepted.`,
    };
  }
  const body = await readResponseTextWithLimit(response, MAX_MANIFEST_BYTES);
  if (!body.ok) {
    return { ok: false, manifest: null, detail: `Manifest ${body.error}.` };
  }
  let value: unknown;
  try {
    value = JSON.parse(body.text);
  } catch (err) {
    return {
      ok: false,
      manifest: null,
      detail: errorDetail("invalid JSON", err),
    };
  }
  const validation = validateHostDashboardManifest(value, {
    expectedHost: input.host,
  });
  if (!validation.ok || !validation.manifest) {
    return {
      ok: false,
      manifest: null,
      detail: validation.issues.map((issue) =>
        `${issue.path}: ${issue.message}`
      ).join("; "),
    };
  }
  return {
    ok: true,
    manifest: validation.manifest,
    detail:
      `${HOST_DASHBOARD_SPEC_VERSION} manifest is valid for ${validation.manifest.host}.`,
  };
}

async function checkReachableHtml(
  initialUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  allowLocal = false,
): Promise<HostConformanceCheck> {
  let current = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects++) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        headers: { accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return check(
        "account_route",
        "Account management route",
        false,
        current,
        errorDetail("account route fetch failed", err),
      );
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next = safeRedirectUrl(location, current, allowLocal);
      if (!next) {
        return check(
          "account_route",
          "Account management route",
          false,
          current,
          "Account route redirected to a missing or unsafe URL.",
        );
      }
      current = next;
      continue;
    }
    await response.body?.cancel().catch(() => {});
    const contentType = response.headers.get("content-type")?.toLowerCase() ??
      "";
    const ok = response.ok && contentType.includes("text/html");
    return check(
      "account_route",
      "Account management route",
      ok,
      current,
      ok
        ? `Reachable HTML account page returned HTTP ${response.status}.`
        : `Expected reachable HTML, got HTTP ${response.status} ${
          contentType || "without content-type"
        }.`,
    );
  }
  return check(
    "account_route",
    "Account management route",
    false,
    current,
    "Account route exceeded three redirects.",
  );
}

function safeRedirectUrl(
  location: string | null,
  current: string,
  allowLocal: boolean,
): string | null {
  if (!location) return null;
  try {
    return safeConformanceUrl(
      new URL(location, current).toString(),
      allowLocal,
    );
  } catch {
    return null;
  }
}

async function checkPdsHealth(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<HostConformanceCheck> {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel().catch(() => {});
    return check(
      "pds_health",
      "PDS health endpoint",
      response.ok,
      url,
      response.ok
        ? `PDS health returned HTTP ${response.status}.`
        : `PDS health returned HTTP ${response.status}.`,
    );
  } catch (err) {
    return check(
      "pds_health",
      "PDS health endpoint",
      false,
      url,
      errorDetail("PDS health fetch failed", err),
    );
  }
}

function safeConformanceUrl(
  value: string | null | undefined,
  allowLocal = false,
  originOnly = false,
): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const loopback = url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" || url.hostname === "[::1]";
  if (
    url.protocol !== "https:" &&
    !(allowLocal && loopback && url.protocol === "http:")
  ) {
    return null;
  }
  if (isPrivateNetworkHostname(url.hostname) && !(allowLocal && loopback)) {
    return null;
  }
  url.hash = "";
  if (originOnly) return url.origin;
  return url.toString();
}

function check(
  id: HostConformanceCheck["id"],
  label: string,
  ok: boolean,
  url: string | null,
  detail: string,
): HostConformanceCheck {
  return { id, label, ok, required: true, url, detail };
}

function errorDetail(prefix: string, error: unknown): string {
  return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
}
