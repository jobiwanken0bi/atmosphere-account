import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const APP_MANAGEMENT_SURFACES = [
  "../components/explore/AppDirectoryOwnerCta.tsx",
  "../routes/apps/create.tsx",
  "../routes/apps/migrate-from-legacy.tsx",
  "../routes/apps/manage.tsx",
  "../routes/apps/manage/host.tsx",
  "../routes/api/apps/migrate-atstore.ts",
  "../routes/api/registry/profile.ts",
  "../routes/api/registry/profile/updates.ts",
] as const;

const HOST_MANAGEMENT_SURFACES = [
  "../routes/hosts.tsx",
  "../routes/hosts/[host].tsx",
  "../routes/hosts/claim.tsx",
  "../routes/hosts/[host]/claim.tsx",
  "../routes/hosts/register.tsx",
  "../routes/hosts/[host]/manage.tsx",
  "../routes/hosts/[host]/manage/apps.tsx",
] as const;

Deno.test("every app registration and management surface uses the complete bundle", async () => {
  for (const path of APP_MANAGEMENT_SURFACES) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    assertStringIncludes(
      source,
      "APP_MANAGEMENT_CAPABILITIES",
      `${path} does not use the complete app-and-image bundle`,
    );
    assert(
      !/capabilities\s*[:=]\s*\{?\s*\[\s*["']app["']\s*\]/.test(source),
      `${path} still builds an app-only contextual authorization`,
    );
    assert(
      !/getSessionForCapabilities\([\s\S]{0,160}?\[\s*["']app["']\s*\]/
        .test(source),
      `${path} still accepts an app-only session`,
    );
  }
});

Deno.test("every host claim and management surface uses one reusable complete bundle", async () => {
  for (const path of HOST_MANAGEMENT_SURFACES) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    assertStringIncludes(
      source,
      "HOST_MANAGEMENT_CAPABILITIES",
      `${path} does not use the complete host-and-image bundle`,
    );
    assert(
      !/capabilities\s*[:=]\s*\{?\s*\[\s*["'](?:host|identity)["']\s*\]/
        .test(source),
      `${path} still builds an incomplete host authorization`,
    );
    assert(
      !/getSessionForCapabilities\([\s\S]{0,160}?\[\s*["'](?:host|identity)["']\s*\]/
        .test(source),
      `${path} still accepts an incomplete host session`,
    );
  }
});
