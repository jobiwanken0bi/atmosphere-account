import {
  hostHasCurrentConformance,
  persistHostConformanceReport,
  runHostConformance,
} from "./host-conformance.ts";
import type { DbClient } from "./db.ts";

Deno.test("host conformance requires manifest, account route, and PDS health", async () => {
  const calls: string[] = [];
  const report = await runHostConformance({
    host: "host.example",
    manifestUrl:
      "https://host.example/.well-known/atmosphere-host-dashboard.json",
    accountUrl: "https://pds.host.example/account",
    serviceEndpoint: "https://pds.host.example",
    now: 1_000,
    fetchImpl: (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("atmosphere-host-dashboard.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "atmosphere.hostDashboard.v0.1",
              host: "host.example",
              dashboardUrl: "https://pds.host.example/account",
            }),
            { status: 200 },
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
    host: "host.example",
    manifestUrl:
      "https://host.example/.well-known/atmosphere-host-dashboard.json",
    accountUrl: "https://pds.host.example/account",
    serviceEndpoint: "https://pds.host.example",
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
    host: "host.example",
    manifestUrl:
      "https://host.example/.well-known/atmosphere-host-dashboard.json",
    accountUrl: "https://host.example/account",
    serviceEndpoint: "https://host.example",
    fetchImpl: (input) => {
      const url = String(input);
      if (url.endsWith("atmosphere-host-dashboard.json")) {
        return Promise.resolve(
          new Response(JSON.stringify({
            version: "atmosphere.hostDashboard.v0.1",
            host: "host.example",
            dashboardUrl: "https://host.example/account",
          })),
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
      return Promise.resolve(new Response("{}"));
    },
  });
  const account = report.checks.find((item) => item.id === "account_route");
  if (report.status !== "failed" || account?.ok !== false) {
    throw new Error("malformed redirect must produce a failed report");
  }
});
