import { main as smokePickerAssets } from "./smoke-picker-assets.ts";
import { main as smokePublicShell } from "./smoke-public-shell.ts";

async function runSmoke(
  label: string,
  smoke: () => Promise<void>,
): Promise<void> {
  console.log(`[smoke:production] running ${label}`);
  await smoke();
}

if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
  console.log(
    [
      "Usage: deno task smoke:production [options]",
      "",
      "Runs both production smoke checks and forwards every option to each:",
      "  - smoke:public-shell",
      "  - smoke:picker-assets",
      "",
      "Common options:",
      "  --expected-release-sha=<git-sha>",
      "  --site-origin=https://atmosphereaccount.com",
      "  --login-origin=https://login.atmosphereaccount.com",
      "  --picker-origin=https://login.atmosphereaccount.com",
    ].join("\n"),
  );
  Deno.exit(0);
}

await runSmoke("public shell", smokePublicShell);
await runSmoke("picker assets", smokePickerAssets);
console.log("[smoke:production] ok");
