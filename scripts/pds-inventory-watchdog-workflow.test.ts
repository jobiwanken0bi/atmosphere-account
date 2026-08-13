import {
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import {
  PDS_INVENTORY_DEADLINE_MS,
  PDS_INVENTORY_HARD_EXIT_GRACE_MS,
  PDS_INVENTORY_SCHEDULE_HOUR_UTC,
  PDS_INVENTORY_SCHEDULE_MINUTE_UTC,
} from "./check-pds-inventory-run.ts";

const workflowUrl = new URL(
  "../.github/workflows/pds-inventory-watchdog.yml",
  import.meta.url,
);

Deno.test("inventory watchdog workflow uses one low-cost post-deadline daily check", async () => {
  const workflow = await Deno.readTextFile(workflowUrl);
  const schedules = [...workflow.matchAll(/^\s*- cron: ["']([^"']+)["']\s*$/gm)]
    .map((match) => match[1]);
  assertEquals(schedules, ["30 8 * * *"]);

  const [minute, hour] = schedules[0].split(" ").map(Number);
  const inventoryStartMinutes = PDS_INVENTORY_SCHEDULE_HOUR_UTC * 60 +
    PDS_INVENTORY_SCHEDULE_MINUTE_UTC;
  const watchdogMinutes = hour * 60 + minute;
  const guardEndMinutes = inventoryStartMinutes +
    (PDS_INVENTORY_DEADLINE_MS + PDS_INVENTORY_HARD_EXIT_GRACE_MS) /
      60_000;
  const alertDelayMinutes = watchdogMinutes - guardEndMinutes;
  if (alertDelayMinutes < 4 || alertDelayMinutes > 10) {
    throw new Error(
      `watchdog must run roughly 5-10 minutes after the hard guard; got ${alertDelayMinutes}`,
    );
  }
  assertEquals(workflow.includes("*/5"), false);
  assertStringIncludes(workflow, "timeout-minutes: 5");
});

Deno.test("inventory watchdog workflow binds delayed and rerun jobs to Actions creation time", async () => {
  const workflow = await Deno.readTextFile(workflowUrl);
  assertStringIncludes(workflow, "actions: read");
  assertStringIncludes(
    workflow,
    '"repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"',
  );
  assertStringIncludes(workflow, "--jq .created_at");
  assertStringIncludes(workflow, '--reference-time="$reference_time"');
  assertEquals(workflow.includes("date -u"), false);
  assertStringIncludes(workflow, "target selection failed closed");
  assertStringIncludes(workflow, "target_date_utc:");
  assertStringIncludes(workflow, '--target-date-utc="$TARGET_DATE_UTC"');
});

Deno.test("inventory watchdog workflow reconciles an actionable issue from run-specific evidence", async () => {
  const workflow = await Deno.readTextFile(workflowUrl);
  assertStringIncludes(workflow, "issues: write");
  assertStringIncludes(workflow, "continue-on-error: true");
  assertStringIncludes(workflow, "deno task pds-inventory:watchdog");
  assertStringIncludes(
    workflow,
    'ALERT_TITLE: "PDS inventory daily run is failing"',
  );
  assertStringIncludes(
    workflow,
    "if: steps.inventory.outcome == 'failure'",
  );
  assertStringIncludes(
    workflow,
    "if: steps.inventory.outcome == 'success'",
  );
  assertMatch(
    workflow,
    /name: Close the recovered inventory alert[\s\S]*?if: steps\.inventory\.outcome == 'success'[\s\S]*?gh issue close/,
  );
  assertMatch(
    workflow,
    /name: Fail when the target run is not proven complete[\s\S]*?if: steps\.inventory\.outcome == 'failure'[\s\S]*?run: exit 1/,
  );

  for (
    const outcome of [
      "target_run_missing",
      "target_run_running",
      "target_run_failed",
      "target_run_partial",
    ]
  ) {
    assertStringIncludes(workflow, `${outcome})`);
  }
  assertStringIncludes(workflow, "pds_inventory_failed");
  assertStringIncludes(workflow, "hard-exit telemetry");
  assertStringIncludes(workflow, "pagination, deadline, and upstream errors");
  assertStringIncludes(workflow, "<!-- pds-inventory-target: ${target} -->");
  assertStringIncludes(workflow, "inventoryAlertMayAdvance");
  assertStringIncludes(workflow, "inventoryAlertMayClose");
  assertMatch(
    workflow,
    /inventoryAlertMayAdvance[\s\S]*?gh issue edit[\s\S]*?stale result did not replace/,
  );
  assertMatch(
    workflow,
    /inventoryAlertMayClose[\s\S]*?gh issue close[\s\S]*?cannot close newer active failure/,
  );
});
