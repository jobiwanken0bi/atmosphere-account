import { assertEquals } from "jsr:@std/assert@1";
import { safeBrowserNavigationUrl } from "./browser-navigation.ts";

Deno.test("browser navigation accepts same-origin and public HTTPS handoffs", () => {
  assertEquals(
    safeBrowserNavigationUrl("/account", "https://atmosphereaccount.com/apps"),
    "https://atmosphereaccount.com/account",
  );
  assertEquals(
    safeBrowserNavigationUrl(
      "https://pds.example.com/oauth?request=1",
      "https://atmosphereaccount.com/apps",
    ),
    "https://pds.example.com/oauth?request=1",
  );
});

Deno.test("browser navigation rejects active schemes, credentials, and private HTTPS", () => {
  const current = "https://atmosphereaccount.com/apps";
  for (
    const value of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "https://user:secret@example.com/",
      "https://127.0.0.1/admin",
      "https://10.0.0.1/admin",
      "https://2130706433/admin",
      "https://[::ffff:127.0.0.1]/admin",
      "https://198.51.100.1/admin",
      "https://service.local/admin",
      "https://service.internal/admin",
      "https://service.test/admin",
      "https://service.invalid/admin",
      "https://service.example/admin",
      "https://hidden.onion/admin",
      "https://intranet/admin",
      "http://example.com/insecure",
    ]
  ) {
    assertEquals(safeBrowserNavigationUrl(value, current), null);
  }
});

Deno.test("browser navigation permits loopback HTTP only from loopback dev", () => {
  assertEquals(
    safeBrowserNavigationUrl(
      "http://localhost:3000/callback",
      "http://127.0.0.1:5173/signin",
    ),
    "http://localhost:3000/callback",
  );
  assertEquals(
    safeBrowserNavigationUrl(
      "http://localhost:3000/callback",
      "https://atmosphereaccount.com/signin",
    ),
    null,
  );
});
