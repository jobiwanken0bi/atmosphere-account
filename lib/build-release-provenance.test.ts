import { assertEquals } from "jsr:@std/assert@1";
import { buildReleaseProvenance } from "./build-release-provenance.ts";

const SHA = "abcdef1234567890abcdef1234567890abcdef12";
const DIGEST = `web-source-v1:sha256:${"d".repeat(64)}`;

function build(
  options: Parameters<typeof buildReleaseProvenance>[0],
) {
  return buildReleaseProvenance({
    ...options,
    sourceDigest: () => Promise.resolve(DIGEST),
  });
}

Deno.test("build release provenance uses the verified repository commit", async () => {
  const calls: string[][] = [];
  const result = await build({
    commandOutput(args) {
      calls.push(args);
      if (args.includes("status")) return Promise.resolve("");
      return Promise.resolve(args.includes("--verify") ? SHA : "main");
    },
    env: () => undefined,
  });

  assertEquals(calls[0], ["status", "--porcelain"]);
  assertEquals(calls[1], ["rev-parse", "--verify", "HEAD^{commit}"]);
  assertEquals(result, {
    gitSha: SHA,
    gitBranch: "main",
    artifactDigest: DIGEST,
  });
});

Deno.test("Deno Deploy builds retain digest provenance without a Git checkout", async () => {
  const markers: Record<string, string>[] = [
    { DENO_DEPLOY: "true" },
    { DENO_DEPLOY: "1" },
    { DENO_DEPLOY_BUILD_ID: "deno-build" },
  ];
  for (const marker of markers) {
    assertEquals(
      await build({
        commandOutput: () => Promise.resolve(null),
        env: (key) => marker[key],
      }),
      { gitSha: null, gitBranch: null, artifactDigest: DIGEST },
    );
  }
});

Deno.test("non-Deno builds may use an explicit full-SHA fallback", async () => {
  const result = await build({
    commandOutput: () => Promise.resolve(null),
    env: (key) => key === "ATMOSPHERE_BUILD_GIT_SHA" ? SHA : undefined,
  });

  assertEquals(result, {
    gitSha: SHA,
    gitBranch: null,
    artifactDigest: DIGEST,
  });
});

Deno.test("build release provenance rejects abbreviated and malformed SHAs", async () => {
  const result = await build({
    commandOutput: (args) =>
      Promise.resolve(
        args.includes("status")
          ? ""
          : args.includes("--verify")
          ? "abcdef123456"
          : "HEAD",
      ),
    env: (key) => key === "GITHUB_SHA" ? "not-a-sha" : undefined,
  });

  assertEquals(result, {
    gitSha: null,
    gitBranch: null,
    artifactDigest: DIGEST,
  });
});

Deno.test("dirty worktrees never claim the checked-out commit", async () => {
  const result = await build({
    commandOutput: (args) =>
      Promise.resolve(
        args.includes("status") ? "?? lib/new-production-code.ts" : SHA,
      ),
    env: (key) => key === "GITHUB_SHA" ? SHA : undefined,
  });

  assertEquals(result, {
    gitSha: null,
    gitBranch: null,
    artifactDigest: DIGEST,
  });
});

Deno.test("Deno dirty trees suppress Git provenance but retain source digest", async () => {
  assertEquals(
    await build({
      commandOutput: (args) =>
        Promise.resolve(
          args.includes("status") ? " M routes/index.tsx" : SHA,
        ),
      env: (key) => {
        if (key === "DENO_DEPLOY") return "true";
        if (key === "GITHUB_SHA") return SHA;
        return undefined;
      },
    }),
    { gitSha: null, gitBranch: null, artifactDigest: DIGEST },
  );
});

Deno.test("compiled builds execute the provenance config without rebundling it", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks?: Record<string, string>;
  };
  const task = config.tasks?.["build:compiled"] ?? "";
  assertEquals(task.includes("build --configLoader native"), true);
  const viteConfig = await Deno.readTextFile("vite.config.ts");
  assertEquals(viteConfig.includes("__ATMOSPHERE_ARTIFACT_DIGEST__"), true);
});
