import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  evaluatePdsInventoryRun,
  inventoryAlertMayAdvance,
  inventoryAlertMayClose,
  pdsInventoryRunWindow,
} from "./check-pds-inventory-run.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET = Date.parse("2026-08-13T08:17:00.000Z");
const COMPLETED = Date.parse("2026-08-13T08:19:00.000Z");
const OBSERVED = Date.parse("2026-08-13T08:30:00.000Z");

function readiness(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    degraded: false,
    pdsInventory: {
      present: true,
      fresh: true,
      completedAt: new Date(COMPLETED).toISOString(),
      scanId: "scan-today",
      pages: 7,
      instanceCount: 5_513,
      latestAttempt: {
        status: "succeeded",
        complete: true,
        startedAt: new Date(TARGET + 10_000).toISOString(),
        completedAt: new Date(COMPLETED).toISOString(),
      },
      ...overrides,
    },
  };
}

Deno.test("inventory watchdog resolves the latest due UTC run across date boundaries", () => {
  const afterSchedule = pdsInventoryRunWindow({
    referenceAt: Date.parse("2026-08-13T08:30:00.000Z"),
  });
  assertEquals(afterSchedule.scheduledAt, TARGET);
  assertEquals(
    afterSchedule.expectedCompleteBy,
    Date.parse("2026-08-13T08:25:15.000Z"),
  );

  const beforeSchedule = pdsInventoryRunWindow({
    referenceAt: Date.parse("2026-08-14T00:03:00.000Z"),
  });
  assertEquals(beforeSchedule.scheduledAt, TARGET);
  assertEquals(beforeSchedule.nextScheduledAt, TARGET + DAY_MS);
});

Deno.test("inventory watchdog keeps a queued or rerun workflow bound to its creation time", () => {
  const result = evaluatePdsInventoryRun(readiness(), {
    referenceAt: Date.parse("2026-08-13T08:30:00.000Z"),
    observedAt: Date.parse("2026-08-14T09:30:00.000Z"),
  });
  assertEquals(result.ok, true);
  assertEquals(result.targetScheduledAt, "2026-08-13T08:17:00.000Z");
});

Deno.test("inventory watchdog accepts only the target run's authoritative completion", () => {
  const result = evaluatePdsInventoryRun(readiness(), {
    observedAt: OBSERVED,
  });
  assertEquals(result.ok, true);
  assertEquals(result.outcome, "target_run_succeeded");
  assertEquals(
    result.latestAttemptCompletedAt,
    new Date(COMPLETED).toISOString(),
  );
});

Deno.test("inventory watchdog does not mistake yesterday's fresh scan for today's run", () => {
  const yesterday = TARGET - DAY_MS + 2 * 60 * 1000;
  const result = evaluatePdsInventoryRun(
    readiness({
      completedAt: new Date(yesterday).toISOString(),
      scanId: "scan-yesterday",
      latestAttempt: {
        status: "succeeded",
        complete: true,
        startedAt: new Date(yesterday - 60_000).toISOString(),
        completedAt: new Date(yesterday).toISOString(),
      },
    }),
    { observedAt: OBSERVED },
  );
  assertEquals(result.ok, false);
  assertEquals(result.outcome, "target_run_missing");
});

Deno.test("inventory watchdog rejects a much later same-day attempt", () => {
  const lateStart = Date.parse("2026-08-13T10:00:00.000Z");
  const lateComplete = lateStart + 60_000;
  const result = evaluatePdsInventoryRun(
    readiness({
      completedAt: new Date(lateComplete).toISOString(),
      scanId: "scan-late",
      latestAttempt: {
        status: "succeeded",
        complete: true,
        startedAt: new Date(lateStart).toISOString(),
        completedAt: new Date(lateComplete).toISOString(),
      },
    }),
    { observedAt: lateComplete + 60_000, referenceAt: OBSERVED },
  );
  assertEquals(result.ok, false);
  assertEquals(result.outcome, "target_run_missing");
});

Deno.test("inventory watchdog rejects future attempt and completion timestamps", () => {
  const futureStart = evaluatePdsInventoryRun(
    readiness({
      latestAttempt: {
        status: "running",
        complete: false,
        startedAt: new Date(OBSERVED + 1).toISOString(),
        completedAt: null,
      },
    }),
    { observedAt: OBSERVED },
  );
  assertEquals(futureStart.ok, false);
  assertEquals(futureStart.outcome, "target_run_missing");

  const futureCompletedAt = OBSERVED + 1;
  const futureCompletion = evaluatePdsInventoryRun(
    readiness({
      completedAt: new Date(futureCompletedAt).toISOString(),
      latestAttempt: {
        status: "succeeded",
        complete: true,
        startedAt: new Date(TARGET + 10_000).toISOString(),
        completedAt: new Date(futureCompletedAt).toISOString(),
      },
    }),
    { observedAt: OBSERVED },
  );
  assertEquals(futureCompletion.ok, false);
  assertEquals(futureCompletion.outcome, "target_run_inconsistent");
});

Deno.test("inventory watchdog fails closed for running, failed, and partial target attempts", () => {
  for (
    const [status, complete, outcome] of [
      ["running", false, "target_run_running"],
      ["failed", false, "target_run_failed"],
      ["succeeded", false, "target_run_partial"],
    ] as const
  ) {
    const result = evaluatePdsInventoryRun(
      readiness({
        latestAttempt: {
          status,
          complete,
          startedAt: new Date(TARGET + 5_000).toISOString(),
          completedAt: status === "running"
            ? null
            : new Date(COMPLETED).toISOString(),
        },
      }),
      { observedAt: OBSERVED },
    );
    assertEquals(result.ok, false);
    assertEquals(result.outcome, outcome);
  }
});

Deno.test("inventory watchdog rejects a latest success backed only by another complete scan", () => {
  for (
    const overrides of [
      { completedAt: new Date(COMPLETED - 60_000).toISOString() },
      { scanId: null },
      { pages: 0 },
      { instanceCount: 0 },
      { present: false },
      { fresh: false },
    ]
  ) {
    const result = evaluatePdsInventoryRun(readiness(overrides), {
      observedAt: OBSERVED,
    });
    assertEquals(result.ok, false);
    assertEquals(result.outcome, "target_run_inconsistent");
  }
});

Deno.test("inventory watchdog supports an explicit target UTC date", () => {
  const result = evaluatePdsInventoryRun(readiness(), {
    observedAt: Date.parse("2026-08-14T12:00:00.000Z"),
    targetDateUtc: "2026-08-13",
  });
  assertEquals(result.ok, true);
  assertEquals(result.targetScheduledAt, "2026-08-13T08:17:00.000Z");

  assertThrows(
    () =>
      pdsInventoryRunWindow({
        referenceAt: OBSERVED,
        targetDateUtc: "2026-02-30",
      }),
    Error,
    "real calendar date",
  );
});

Deno.test("inventory watchdog rejects missing or malformed readiness inventory", () => {
  for (const payload of [{}, { pdsInventory: null }, { pdsInventory: {} }]) {
    const result = evaluatePdsInventoryRun(payload, { observedAt: OBSERVED });
    assertEquals(result.ok, false);
    assertEquals(
      result.outcome,
      payload && "pdsInventory" in payload && payload.pdsInventory
        ? "target_run_missing"
        : "readiness_unavailable",
    );
  }
});

Deno.test("inventory alert generations reject stale failure and success races", () => {
  const yesterday = "2026-08-12T08:17:00.000Z";
  const today = "2026-08-13T08:17:00.000Z";
  const tomorrow = "2026-08-14T08:17:00.000Z";

  assertEquals(inventoryAlertMayAdvance(today, yesterday), false);
  assertEquals(inventoryAlertMayAdvance(today, today), true);
  assertEquals(inventoryAlertMayAdvance(today, tomorrow), true);
  assertEquals(inventoryAlertMayAdvance(null, today), true);
  assertEquals(inventoryAlertMayAdvance(today, "invalid"), false);

  assertEquals(inventoryAlertMayClose(today, yesterday), false);
  assertEquals(inventoryAlertMayClose(today, today), true);
  assertEquals(inventoryAlertMayClose(today, tomorrow), true);
  assertEquals(inventoryAlertMayClose(null, today), false);
  assertEquals(inventoryAlertMayClose(today, "invalid"), false);
});
