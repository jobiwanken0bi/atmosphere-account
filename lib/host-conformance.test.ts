import {
  hostHasCurrentConformance,
  persistHostConformanceReport,
  runHostConformance,
} from "./host-conformance.ts";
import type { DbClient } from "./db.ts";

Deno.test("host conformance requires manifest, account route, and PDS health", async () => {
  const calls: string[] = [];
  const report = await runHostConformance({
    host: "host.social",
    manifestUrl:
      "https://host.social/.well-known/atmosphere-host-dashboard.json",
    accountUrl: "https://pds.host.social/account",
    serviceEndpoint: "https://pds.host.social",
    now: 1_000,
    fetchImpl: (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("atmosphere-host-dashboard.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "atmosphere.hostDashboard.v0.1",
              host: "host.social",
              dashboardUrl: "https://pds.host.social/account",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      if (url.endsWith("/account")) {
        return Promise.resolve(
          new Response("<html>account</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        );
      }
      return Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  if (report.status !== "passed" || report.checks.some((item) => !item.ok)) {
    throw new Error(`expected passing conformance: ${JSON.stringify(report)}`);
  }
  if (calls.length !== 3) throw new Error("expected all three network checks");
  if (
    !hostHasCurrentConformance({
      conformanceStatus: "passed",
      conformanceExpiresAt: report.expiresAt,
    }, report.checkedAt)
  ) {
    throw new Error("current passing conformance should unlock a badge");
  }
});

Deno.test("host conformance failures persist without unlocking a badge", async () => {
  const report = await runHostConformance({
    host: "host.social",
    manifestUrl:
      "https://host.social/.well-known/atmosphere-host-dashboard.json",
    accountUrl: "https://pds.host.social/account",
    serviceEndpoint: "https://pds.host.social",
    fetchImpl: () =>
      Promise.resolve(new Response("unavailable", { status: 503 })),
  });
  let persistedArgs: unknown[] | null = null;
  await persistHostConformanceReport(report, async (fn) => {
    return await fn({
      execute: (statement) => {
        persistedArgs = typeof statement === "string"
          ? []
          : statement.args ?? [];
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      },
    } as DbClient);
  });
  if (report.status !== "failed" || persistedArgs?.[1] !== "failed") {
    throw new Error("failed conformance was not persisted honestly");
  }
  if (
    hostHasCurrentConformance({
      conformanceStatus: "passed",
      conformanceExpiresAt: report.checkedAt,
    }, report.checkedAt)
  ) {
    throw new Error("expired conformance must not unlock a badge");
  }
});

Deno.test("host conformance reports malformed account redirects as failures", async () => {
  const report = await runHostConformance({
    host: "host.social",
    manifestUrl:
      "https://host.social/.well-known/atmosphere-host-dashboard.json",
    accountUrl: "https://host.social/account",
    serviceEndpoint: "https://host.social",
    fetchImpl: (input) => {
      const url = String(input);
      if (url.endsWith("atmosphere-host-dashboard.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "atmosphere.hostDashboard.v0.1",
              host: "host.social",
              dashboardUrl: "https://host.social/account",
            }),
            {
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      if (url.endsWith("/account")) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://[invalid" },
          }),
        );
      }
      return Promise.resolve(
        new Response("{}", {
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  const account = report.checks.find((item) => item.id === "account_route");
  if (report.status !== "failed" || account?.ok !== false) {
    throw new Error("malformed redirect must produce a failed report");
  }
});

Deno.test("host conformance refuses non-JSON manifests and health responses", async () => {
  const report = await runHostConformance({
    host: "host.social",
    manifestUrl:
      "https://host.social/.well-known/atmosphere-host-dashboard.json",
    accountUrl: "https://host.social/account",
    serviceEndpoint: "https://host.social",
    fetchImpl: (input, init) => {
      if (init?.redirect !== "manual") {
        throw new Error("outbound checks must not follow redirects");
      }
      const url = String(input);
      if (url.endsWith("atmosphere-host-dashboard.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "atmosphere.hostDashboard.v0.1",
              host: "host.social",
              dashboardUrl: "https://host.social/account",
            }),
            { headers: { "content-type": "text/html" } },
          ),
        );
      }
      if (url.endsWith("/account")) {
        return Promise.resolve(
          new Response("<html></html>", {
            headers: { "content-type": "text/html" },
          }),
        );
      }
      return Promise.resolve(
        new Response("{}", {
          headers: { "content-type": "text/html" },
        }),
      );
    },
  });

  const manifest = report.checks.find((item) => item.id === "manifest");
  const health = report.checks.find((item) => item.id === "pds_health");
  if (manifest?.ok !== false || health?.ok !== false) {
    throw new Error("non-JSON conformance responses must not pass");
  }
});
