import {
  isCanonicalSiteOriginForTest,
  validatedPublicOriginForTest,
  validateSecretStrengthForTest,
} from "./env.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertThrows(fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("Expected function to throw");
}

Deno.test("production session secrets require at least 32 bytes", () => {
  assertThrows(() => validateSecretStrengthForTest("too-short", true));
  assertEquals(
    validateSecretStrengthForTest("x".repeat(32), true),
    "x".repeat(32),
  );
  assertEquals(validateSecretStrengthForTest("dev", false), "dev");
});

Deno.test("public origins reject active schemes and ambiguous authority", () => {
  assertEquals(
    validatedPublicOriginForTest("https://example.com/", true),
    "https://example.com",
  );
  assertEquals(
    validatedPublicOriginForTest("http://127.0.0.1:5173", false),
    "http://127.0.0.1:5173",
  );
  for (
    const value of [
      "javascript:alert(1)",
      "https://user:secret@example.com",
      "https://example.com/path",
      "https://example.com/?next=evil",
    ]
  ) {
    assertThrows(() => validatedPublicOriginForTest(value, true));
  }
  assertThrows(() => validatedPublicOriginForTest("http://example.com", true));
});

Deno.test("canonical production origin comparison rejects hostname lookalikes", () => {
  assertEquals(
    isCanonicalSiteOriginForTest("https://atmosphereaccount.com"),
    true,
  );
  for (
    const value of [
      "https://atmosphereaccount.com.evil.example",
      "https://atmosphereaccount.com@evil.example",
      "https://atmosphereaccount.com.example",
      "https://atmosphereaccount.co",
    ]
  ) {
    assertEquals(isCanonicalSiteOriginForTest(value), false);
  }
});
