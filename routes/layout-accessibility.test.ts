import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("public app and host management surfaces expose a main landmark", async () => {
  for (
    const path of [
      "./apps.tsx",
      "./apps/all.tsx",
      "./apps/categories.tsx",
      "./apps/[handle].tsx",
      "./apps/manage.tsx",
      "./hosts.tsx",
      "./hosts/[host].tsx",
      "./hosts/[host]/manage.tsx",
      "./hosts/[host]/manage/apps.tsx",
      "./hosts/claim.tsx",
      "./hosts/register.tsx",
      "./hosts/[host]/claim.tsx",
      "./relationships/confirm.tsx",
      "./account/index.tsx",
      "./account/apps-hosts.tsx",
      "./account/reviews.tsx",
      "./apps/create.tsx",
      "./apps/migrate-from-legacy.tsx",
      "./apps/manage/host.tsx",
      "./examples/atmosphere-login/app.tsx",
      "./examples/atmosphere-login/callback.tsx",
    ]
  ) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    assertStringIncludes(source, 'id="main-content"', path);
  }
});

Deno.test("shared docs layout exposes the primary content landmark", async () => {
  const source = await Deno.readTextFile(
    new URL("../components/DocsLayout.tsx", import.meta.url),
  );
  assertStringIncludes(source, '<main id="main-content"', "DocsLayout.tsx");
});

Deno.test("admin pages expose the primary content landmark", async () => {
  for (
    const path of [
      "./admin/index.tsx",
      "./admin/reviews.tsx",
      "./admin/reports.tsx",
      "./admin/takedowns.tsx",
      "./admin/login-apps.tsx",
      "./admin/app-directory.tsx",
      "./admin/featured.tsx",
      "./admin/icon-access.tsx",
      "./admin/app-directory/failures/[id].tsx",
    ]
  ) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    assertStringIncludes(source, 'id="main-content"', path);
  }
});
