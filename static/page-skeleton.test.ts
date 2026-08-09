import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { routeKind } from "./page-skeleton.js";

Deno.test("page skeletons match current public and management routes", () => {
  const cases = new Map<string, string>([
    ["/", "home"],
    ["/apps", "apps-home"],
    ["/apps/all", "apps-browse"],
    ["/apps/tangled", "app-detail"],
    ["/apps/manage", "form"],
    ["/apps/manage/host", "form"],
    ["/apps/migrate-from-legacy", "form"],
    ["/hosts", "hosts"],
    ["/hosts/atproto.brid.gy", "host-detail"],
    ["/hosts/claim", "form"],
    ["/hosts/atproto.brid.gy/claim", "form"],
    ["/hosts/atproto.brid.gy/manage", "form"],
    ["/hosts/atproto.brid.gy/manage/apps", "form"],
    ["/signin", "signin"],
    ["/login/select", "signin"],
    ["/account", "account"],
    ["/account/apps-hosts", "apps-hosts"],
    ["/account/developer/apps", "form"],
    ["/account/developer/apps/https%3A%2F%2Fapp.test", "form"],
    ["/relationships/confirm", "form"],
  ]);

  for (const [pathname, expected] of cases) {
    assertEquals(routeKind(pathname), expected, pathname);
  }
});
