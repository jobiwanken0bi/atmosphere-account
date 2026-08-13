const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ARTIFACT_DIGEST_PATTERN = /^web-source-v1:sha256:[0-9a-f]{64}$/;
const MANAGED_LABEL = "automation:production-smoke";
const MARKER_PATTERN = /<!-- atmosphere-production-alert:(\{[^\r\n]*\}) -->/g;

export type ProductionAlertKind = "readiness" | "full";
export type ProductionAlertOutcome = "failure" | "success";

export interface ProductionAlertTarget {
  /** Trusted Git commit used only to order reconciliation generations. */
  sourceSha: string;
  /** Exact source-input identity required from both deployed web runtimes. */
  artifactDigest: string;
  /** Ordered from the web baseline through the source release. */
  allowedAppviewShas: string[];
}

interface ProductionAlertMarker {
  version: 2;
  kind: ProductionAlertKind;
  target: ProductionAlertTarget;
}

interface ProductionIssue {
  number: number;
  state: "OPEN" | "CLOSED";
  body: string;
}

export type ProductionAlertAction =
  | "create_failure"
  | "update_failure"
  | "reopen_failure"
  | "close_recovered"
  | "advance_closed_success"
  | "seed_closed_success"
  | "ignore_stale"
  | "ignore_unscoped_success"
  | "noop";

type IsAncestor = (
  ancestorSha: string,
  descendantSha: string,
) => boolean | Promise<boolean>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function isArtifactDigest(value: unknown): value is string {
  return typeof value === "string" && ARTIFACT_DIGEST_PATTERN.test(value);
}

export function parseProductionAlertTarget(
  value: unknown,
): ProductionAlertTarget | null {
  if (
    !isRecord(value) || !isSha(value.sourceSha) ||
    !isArtifactDigest(value.artifactDigest)
  ) return null;
  if (
    !Array.isArray(value.allowedAppviewShas) ||
    value.allowedAppviewShas.length === 0 ||
    !value.allowedAppviewShas.every(isSha)
  ) {
    return null;
  }
  const allowedAppviewShas = [...value.allowedAppviewShas];
  if (new Set(allowedAppviewShas).size !== allowedAppviewShas.length) {
    return null;
  }
  if (allowedAppviewShas.at(-1) !== value.sourceSha) return null;
  return {
    sourceSha: value.sourceSha,
    artifactDigest: value.artifactDigest,
    allowedAppviewShas,
  };
}

export function formatProductionAlertMarker(
  kind: ProductionAlertKind,
  target: ProductionAlertTarget,
): string {
  const parsedTarget = parseProductionAlertTarget(target);
  if (!parsedTarget) throw new Error("invalid production alert target");
  const marker: ProductionAlertMarker = {
    version: 2,
    kind,
    target: parsedTarget,
  };
  return `<!-- atmosphere-production-alert:${JSON.stringify(marker)} -->`;
}

export function parseProductionAlertMarker(
  body: string,
  expectedKind: ProductionAlertKind,
): ProductionAlertTarget | null {
  let target: ProductionAlertTarget | null = null;
  for (const match of body.matchAll(MARKER_PATTERN)) {
    try {
      const value: unknown = JSON.parse(match[1]);
      if (
        !isRecord(value) || value.version !== 2 ||
        value.kind !== expectedKind
      ) {
        continue;
      }
      const parsedTarget = parseProductionAlertTarget(value.target);
      if (parsedTarget) target = parsedTarget;
    } catch {
      // Ignore malformed or legacy markers and fail closed on recovery.
    }
  }
  return target;
}

/**
 * A candidate may reconcile an alert only when its trusted source and AppView
 * baseline do not move backwards. When the web baseline is unchanged, its
 * digest must also be unchanged; disagreement fails closed instead of letting
 * one purported identity overwrite another for the same source generation.
 */
export async function productionAlertTargetMayAdvance(
  active: ProductionAlertTarget,
  candidate: ProductionAlertTarget,
  isAncestor: IsAncestor,
): Promise<boolean> {
  const sourceMayAdvance = await isAncestor(
    active.sourceSha,
    candidate.sourceSha,
  );
  if (!sourceMayAdvance) return false;
  const appviewMayAdvance = await isAncestor(
    active.allowedAppviewShas[0],
    candidate.allowedAppviewShas[0],
  );
  if (!appviewMayAdvance) return false;
  if (
    active.allowedAppviewShas[0] === candidate.allowedAppviewShas[0] &&
    active.artifactDigest !== candidate.artifactDigest
  ) {
    return false;
  }
  return true;
}

export function productionAlertAction(input: {
  outcome: ProductionAlertOutcome;
  issueState: ProductionIssue["state"] | null;
  hasScopedTarget: boolean;
  candidateMayAdvance: boolean;
}): ProductionAlertAction {
  if (input.issueState == null) {
    return input.outcome === "failure"
      ? "create_failure"
      : "seed_closed_success";
  }
  if (!input.hasScopedTarget) {
    if (input.outcome === "success") return "ignore_unscoped_success";
    return input.issueState === "OPEN" ? "update_failure" : "reopen_failure";
  }
  if (!input.candidateMayAdvance) return "ignore_stale";
  if (input.outcome === "failure") {
    return input.issueState === "OPEN" ? "update_failure" : "reopen_failure";
  }
  return input.issueState === "OPEN"
    ? "close_recovered"
    : "advance_closed_success";
}

interface AlertDefinition {
  kind: ProductionAlertKind;
  title: string;
  failureSummary: string;
  recoverySummary: string;
}

const ALERTS: Record<ProductionAlertKind, AlertDefinition> = {
  readiness: {
    kind: "readiness",
    title: "Production readiness is failing",
    failureSummary:
      "Production readiness failed. Investigate artifact parity, AppView/Postgres readiness, the indexer lease, and the complete PDS-inventory heartbeat.",
    recoverySummary: "Production readiness recovered.",
  },
  full: {
    kind: "full",
    title: "Production smoke is failing",
    failureSummary:
      "The full production smoke failed after readiness passed. Investigate HTML, OAuth metadata, SDK, picker, and generated asset regressions.",
    recoverySummary: "The full production smoke recovered.",
  },
};

function bodyFor(
  alert: AlertDefinition,
  outcome: ProductionAlertOutcome,
  target: ProductionAlertTarget,
  runUrl: string,
): string {
  const appviewTarget = target.allowedAppviewShas.length === 1
    ? `\`${target.allowedAppviewShas[0]}\``
    : `${target.allowedAppviewShas.length} allowed revisions from ` +
      `\`${target.allowedAppviewShas[0]}\` through ` +
      `\`${target.allowedAppviewShas.at(-1)}\``;
  const summary = outcome === "failure"
    ? alert.failureSummary
    : alert.recoverySummary;
  return [
    summary,
    "",
    `Source generation: \`${target.sourceSha}\``,
    `Web artifact: \`${target.artifactDigest}\``,
    `Railway AppView: ${appviewTarget}`,
    `Run: ${runUrl}`,
    "",
    formatProductionAlertMarker(alert.kind, target),
  ].join("\n");
}

async function command(
  executable: string,
  args: string[],
  acceptedExitCodes = [0],
): Promise<string> {
  const output = await new Deno.Command(executable, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!acceptedExitCodes.includes(output.code)) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(
      `${executable} ${args[0] ?? ""} failed (${output.code}): ${stderr}`,
    );
  }
  return new TextDecoder().decode(output.stdout).trim();
}

async function gitIsAncestor(
  ancestorSha: string,
  descendantSha: string,
): Promise<boolean> {
  const output = await new Deno.Command("git", {
    args: ["merge-base", "--is-ancestor", ancestorSha, descendantSha],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (output.code === 0) return true;
  if (output.code === 1) return false;
  const stderr = new TextDecoder().decode(output.stderr).trim();
  throw new Error(`could not compare production alert targets: ${stderr}`);
}

async function validateTargetHistory(
  target: ProductionAlertTarget,
): Promise<void> {
  if (target.allowedAppviewShas.at(-1) !== target.sourceSha) {
    throw new Error(
      "the allowed AppView sequence must end at the source generation",
    );
  }
  const commits = [target.sourceSha, ...target.allowedAppviewShas];
  for (const sha of commits) {
    await command("git", ["cat-file", "-e", `${sha}^{commit}`]);
  }
  for (let index = 1; index < target.allowedAppviewShas.length; index++) {
    if (
      !await gitIsAncestor(
        target.allowedAppviewShas[index - 1],
        target.allowedAppviewShas[index],
      )
    ) {
      throw new Error("allowed AppView revisions must be ordered by ancestry");
    }
  }
  if (
    !await gitIsAncestor(target.allowedAppviewShas[0], target.sourceSha)
  ) {
    throw new Error("the AppView baseline must be an ancestor of the shell");
  }
}

async function findIssue(
  repository: string,
  title: string,
): Promise<ProductionIssue | null> {
  const raw = await command("gh", [
    "issue",
    "list",
    "--repo",
    repository,
    "--state",
    "all",
    "--label",
    MANAGED_LABEL,
    "--search",
    `\"${title}\" in:title`,
    "--json",
    "number,title,state,body",
    "--limit",
    "100",
  ]);
  const values: unknown = JSON.parse(raw || "[]");
  if (!Array.isArray(values)) throw new Error("invalid issue-list response");
  const issues = values.filter((value): value is Record<string, unknown> =>
    isRecord(value) && value.title === title &&
    typeof value.number === "number" &&
    (value.state === "OPEN" || value.state === "CLOSED") &&
    typeof value.body === "string"
  ).sort((left, right) => (right.number as number) - (left.number as number));
  const issue = issues[0];
  if (!issue) return null;
  return {
    number: issue.number as number,
    state: issue.state as ProductionIssue["state"],
    body: issue.body as string,
  };
}

async function editIssueBody(
  repository: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await command("gh", [
    "issue",
    "edit",
    String(issueNumber),
    "--repo",
    repository,
    "--body",
    body,
  ]);
}

async function commentOnIssue(
  repository: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await command("gh", [
    "issue",
    "comment",
    String(issueNumber),
    "--repo",
    repository,
    "--body",
    body,
  ]);
}

async function reconcileAlert(input: {
  repository: string;
  runUrl: string;
  alert: AlertDefinition;
  outcome: ProductionAlertOutcome;
  target: ProductionAlertTarget;
}): Promise<void> {
  await command("gh", [
    "label",
    "create",
    MANAGED_LABEL,
    "--repo",
    input.repository,
    "--color",
    "6f42c1",
    "--description",
    "Managed production-smoke alert state",
    "--force",
  ]);
  const issue = await findIssue(input.repository, input.alert.title);
  const activeTarget = issue
    ? parseProductionAlertMarker(issue.body, input.alert.kind)
    : null;
  const candidateMayAdvance = activeTarget
    ? await productionAlertTargetMayAdvance(
      activeTarget,
      input.target,
      gitIsAncestor,
    )
    : false;
  const action = productionAlertAction({
    outcome: input.outcome,
    issueState: issue?.state ?? null,
    hasScopedTarget: activeTarget != null,
    candidateMayAdvance,
  });

  if (action === "ignore_stale" || action === "ignore_unscoped_success") {
    console.log(`${input.alert.kind}: ${action}; alert was not mutated`);
    return;
  }
  if (action === "noop") {
    console.log(`${input.alert.kind}: no reconciliation needed`);
    return;
  }

  const body = bodyFor(
    input.alert,
    input.outcome,
    input.target,
    input.runUrl,
  );
  if (action === "create_failure" || action === "seed_closed_success") {
    const issueUrl = await command("gh", [
      "issue",
      "create",
      "--repo",
      input.repository,
      "--title",
      input.alert.title,
      "--body",
      body,
      "--label",
      MANAGED_LABEL,
    ]);
    if (action === "seed_closed_success") {
      if (!/^https:\/\/[^\s]+\/issues\/\d+$/.test(issueUrl)) {
        throw new Error("could not identify the production alert state issue");
      }
      await command("gh", [
        "issue",
        "close",
        issueUrl,
        "--repo",
        input.repository,
      ]);
    }
    return;
  }

  if (!issue) throw new Error(`missing issue for ${action}`);
  await editIssueBody(input.repository, issue.number, body);

  if (action === "advance_closed_success") return;
  if (action === "reopen_failure") {
    await command("gh", [
      "issue",
      "reopen",
      String(issue.number),
      "--repo",
      input.repository,
    ]);
  }
  const result = input.outcome === "failure" ? "failed" : "recovered";
  await commentOnIssue(
    input.repository,
    issue.number,
    `${
      input.alert.title.replace(" is failing", "")
    } ${result}: ${input.runUrl}`,
  );
  if (action === "close_recovered") {
    await command("gh", [
      "issue",
      "close",
      String(issue.number),
      "--repo",
      input.repository,
    ]);
  }
}

function readFlag(args: string[], flag: string): string | null {
  const prefix = `${flag}=`;
  const value = args.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function parseResult(value: string | null): ProductionAlertOutcome | null {
  if (value === "success") return "success";
  if (value === "failure") return "failure";
  return null;
}

async function main(): Promise<void> {
  const repository = readFlag(Deno.args, "--repository");
  const runUrl = readFlag(Deno.args, "--run-url");
  const sourceSha = readFlag(Deno.args, "--source-sha");
  const artifactDigest = readFlag(Deno.args, "--artifact-digest");
  const appviewValue = readFlag(Deno.args, "--allowed-appview-shas");
  const readiness = parseResult(readFlag(Deno.args, "--readiness-result"));
  const full = parseResult(readFlag(Deno.args, "--full-result"));
  if (
    !repository || !runUrl || !sourceSha || !artifactDigest || !appviewValue
  ) {
    throw new Error("missing production alert reconciliation argument");
  }
  const target = parseProductionAlertTarget({
    sourceSha,
    artifactDigest,
    allowedAppviewShas: appviewValue.split(",").filter(Boolean),
  });
  if (!target) throw new Error("invalid production alert target");
  await validateTargetHistory(target);

  if (readiness) {
    await reconcileAlert({
      repository,
      runUrl,
      alert: ALERTS.readiness,
      outcome: readiness,
      target,
    });
  }
  if (full) {
    await reconcileAlert({
      repository,
      runUrl,
      alert: ALERTS.full,
      outcome: full,
      target,
    });
  }
}

if (import.meta.main) await main();
