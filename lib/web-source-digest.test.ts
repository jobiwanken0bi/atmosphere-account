import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  computeWebSourceDigest,
  parseRailwayWebWatchPatterns,
} from "./web-source-digest.ts";

async function fixture(
  patterns: string[],
  files: Record<string, string | Uint8Array>,
): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "web-source-digest-" });
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    if (parts.length > 1) {
      await Deno.mkdir(`${root}/${parts.slice(0, -1).join("/")}`, {
        recursive: true,
      });
    }
    await Deno.writeFile(
      `${root}/${path}`,
      typeof content === "string" ? new TextEncoder().encode(content) : content,
    );
  }
  await Deno.writeTextFile(
    `${root}/railway.web.json`,
    JSON.stringify({ build: { watchPatterns: patterns } }),
  );
  return root;
}

async function removeFixture(root: string): Promise<void> {
  await Deno.remove(root, { recursive: true });
}

Deno.test("web source digest is deterministic, byte-sorted, and versioned", async () => {
  const patterns = ["/railway.web.json", "/src/**", "/client.ts"];
  const first = await fixture(patterns, {
    "src/é.ts": "accent",
    "client.ts": "client",
    "src/a.ts": new Uint8Array([0, 255, 1]),
  });
  const second = await fixture(patterns, {
    "src/a.ts": new Uint8Array([0, 255, 1]),
    "src/é.ts": "accent",
    "client.ts": "client",
  });
  try {
    const a = await computeWebSourceDigest({ root: first });
    const b = await computeWebSourceDigest({ root: second });
    assertEquals(a, b);
    assertEquals(a.algorithmVersion, "web-source-v1");
    assertMatch(a.digest, /^web-source-v1:sha256:[0-9a-f]{64}$/);
    assertEquals(a.files, [
      "client.ts",
      "railway.web.json",
      "src/a.ts",
      "src/é.ts",
    ]);
  } finally {
    await removeFixture(first);
    await removeFixture(second);
  }
});

Deno.test("web source digest frames paths and raw file bytes", async () => {
  const root = await fixture(
    ["/railway.web.json", "/src/**"],
    { "src/a": "bc", "src/ab": "c" },
  );
  try {
    const before = await computeWebSourceDigest({ root });
    await Deno.writeFile(`${root}/src/a`, new Uint8Array([0xc3, 0x28]));
    const after = await computeWebSourceDigest({ root });
    assertNotEquals(before.digest, after.digest);
  } finally {
    await removeFixture(root);
  }
});

Deno.test("Railway web watch patterns allow only exact paths or terminal /**", () => {
  for (
    const pattern of [
      "relative.ts",
      "/routes/*/index.ts",
      "/routes/**/index.ts",
      "/routes/../secret.ts",
      "/routes/./index.ts",
      "/routes//index.ts",
      "/routes\\index.ts",
      "/routes/",
      "/**",
    ]
  ) {
    assertThrows(
      () =>
        parseRailwayWebWatchPatterns({
          build: { watchPatterns: [pattern] },
        }),
      Error,
    );
  }
  assertThrows(
    () =>
      parseRailwayWebWatchPatterns({
        build: { watchPatterns: ["/routes/**", "/routes/**"] },
      }),
    Error,
    "duplicate watch pattern",
  );
  assertEquals(
    parseRailwayWebWatchPatterns({
      build: { watchPatterns: ["/client.ts", "/routes/**"] },
    }),
    [
      {
        pattern: "/client.ts",
        relativePath: "client.ts",
        recursive: false,
      },
      {
        pattern: "/routes/**",
        relativePath: "routes",
        recursive: true,
      },
    ],
  );
});

Deno.test("web source digest rejects missing and overlapping watched paths", async () => {
  const missing = await fixture(["/missing.ts"], {});
  const missingDirectory = await fixture(
    ["/railway.web.json", "/missing/**"],
    {},
  );
  const overlap = await fixture(
    ["/src/**", "/src/a.ts"],
    { "src/a.ts": "a" },
  );
  try {
    await assertRejects(
      () => computeWebSourceDigest({ root: missing }),
      Error,
      "watched path is missing",
    );
    await assertRejects(
      () => computeWebSourceDigest({ root: overlap }),
      Error,
      "duplicate/overlapping patterns",
    );
    await assertRejects(
      () => computeWebSourceDigest({ root: missingDirectory }),
      Error,
      "watched directory is missing",
    );
  } finally {
    await removeFixture(missing);
    await removeFixture(missingDirectory);
    await removeFixture(overlap);
  }
});

Deno.test("web source digest rejects symlinks and non-file exact paths", async () => {
  const symlinkRoot = await fixture(["/src/**"], {
    "outside.ts": "outside",
    "src/a.ts": "a",
  });
  const directoryRoot = await fixture(["/src"], { "src/a.ts": "a" });
  const ancestorRoot = await fixture(
    ["/railway.web.json", "/real/nested/**"],
    { "real/nested/a.ts": "a" },
  );
  try {
    await Deno.symlink("../outside.ts", `${symlinkRoot}/src/link.ts`);
    await assertRejects(
      () => computeWebSourceDigest({ root: symlinkRoot }),
      Error,
      "must not contain a symlink",
    );
    await assertRejects(
      () => computeWebSourceDigest({ root: directoryRoot }),
      Error,
      "not a regular file",
    );
    await Deno.rename(`${ancestorRoot}/real`, `${ancestorRoot}/target`);
    await Deno.symlink("target", `${ancestorRoot}/real`);
    await assertRejects(
      () => computeWebSourceDigest({ root: ancestorRoot }),
      Error,
      "must not contain a symlink",
    );
  } finally {
    await removeFixture(symlinkRoot);
    await removeFixture(directoryRoot);
    await removeFixture(ancestorRoot);
  }
});

Deno.test("web source digest requires the Railway config to hash itself", async () => {
  const root = await fixture(["/client.ts"], { "client.ts": "client" });
  try {
    await assertRejects(
      () => computeWebSourceDigest({ root }),
      Error,
      "must include itself",
    );
  } finally {
    await removeFixture(root);
  }
});
