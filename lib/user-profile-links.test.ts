import {
  normalizeProfileWebsiteUrl,
  safePublicProfileWebsiteUrl,
} from "./user-profile-links.ts";

Deno.test("normalizeProfileWebsiteUrl accepts a plain domain", () => {
  const result = normalizeProfileWebsiteUrl("you.com");
  if (!result.ok) throw new Error(result.message);
  if (result.url !== "https://you.com/") {
    throw new Error(`unexpected URL: ${result.url}`);
  }
});

Deno.test("normalizeProfileWebsiteUrl accepts protocol-relative URLs", () => {
  const result = normalizeProfileWebsiteUrl("//example.com/profile");
  if (!result.ok) throw new Error(result.message);
  if (result.url !== "https://example.com/profile") {
    throw new Error(`unexpected URL: ${result.url}`);
  }
});

Deno.test("normalizeProfileWebsiteUrl rejects unsafe schemes", () => {
  const result = normalizeProfileWebsiteUrl("javascript:alert(1)");
  if (result.ok) throw new Error("javascript URL should be rejected");
});

Deno.test("normalizeProfileWebsiteUrl rejects credentialed URLs", () => {
  const result = normalizeProfileWebsiteUrl("https://user:pass@example.com");
  if (result.ok) throw new Error("credentialed URL should be rejected");
});

Deno.test("normalizeProfileWebsiteUrl rejects credentialed plain domains", () => {
  const result = normalizeProfileWebsiteUrl("example.com@evil.com");
  if (result.ok) {
    throw new Error("credentialed plain domain should be rejected");
  }
});

Deno.test("safePublicProfileWebsiteUrl hides unsafe stored values", () => {
  const result = safePublicProfileWebsiteUrl("javascript:alert(1)");
  if (result !== null) throw new Error(`unsafe URL rendered: ${result}`);
});

Deno.test("normalizeProfileWebsiteUrl rejects URLs over 512 characters", () => {
  const result = normalizeProfileWebsiteUrl(
    `https://example.com/${"a".repeat(520)}`,
  );
  if (result.ok) throw new Error("overlong URL should be rejected");
});
