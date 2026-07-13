import { runHostConformance } from "../lib/host-conformance.ts";

const port = 8_791;
const origin = `http://127.0.0.1:${port}`;
const mock = new Deno.Command(Deno.execPath(), {
  args: ["task", "host:mock", "--", `--port=${port}`],
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

try {
  await waitForMock();
  const report = await runHostConformance({
    host: "mock-pds.test",
    manifestUrl: `${origin}/.well-known/atmosphere-host-dashboard.json`,
    accountUrl: `${origin}/account`,
    serviceEndpoint: origin,
    allowLocal: true,
  });
  if (report.status !== "passed") {
    throw new Error(`mock PDS failed conformance: ${JSON.stringify(report)}`);
  }
  console.log(
    "[host:conformance:smoke] ok mock PDS passed all required checks",
  );
} finally {
  try {
    mock.kill("SIGTERM");
  } catch {
    // Process already exited.
  }
  await mock.status.catch(() => null);
}

async function waitForMock(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${origin}/xrpc/_health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("mock PDS did not start");
}
