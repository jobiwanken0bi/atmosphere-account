import { assert, assertEquals } from "jsr:@std/assert@1";
import { atmosphereApps } from "./LottieSection.tsx";

Deno.test("homepage orbit uses compact, complete icon assets", async () => {
  assertEquals(atmosphereApps.length, 24);

  for (const app of atmosphereApps) {
    const info = await Deno.stat(
      new URL(`../static/atmosphere-app-icons/${app.file}`, import.meta.url),
    );
    assert(info.isFile, `${app.name} icon is missing`);
    assert(
      info.size <= 12_000,
      `${app.name} icon should stay compact, got ${info.size} bytes`,
    );
  }
});
