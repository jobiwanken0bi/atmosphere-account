import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { docsPages, getDocsPage } from "./platform-docs.ts";

Deno.test("first-time app setup CTAs start in the Apps directory", () => {
  const getStarted = requiredPage("get-started");
  const loginGuide = requiredPage("atmosphere-login");
  const registrationGuide = requiredPage("register-app");
  const productionGuide = requiredPage("production-checklist");

  assertEquals(getStarted.secondaryCta?.href, "/apps");
  assertEquals(loginGuide.primaryCta?.href, "/apps");
  assertEquals(registrationGuide.primaryCta?.href, "/apps");
  assertEquals(productionGuide.primaryCta?.href, "/apps");
});

Deno.test("registration guide separates the app profile from developer settings", () => {
  const guide = requiredPage("atmosphere-login");
  const registration = guide.sections.find((section) =>
    section.id === "register-app"
  );
  if (!registration) throw new Error("register-app section missing");
  const entry = registration.blocks.find((block) => block.type === "endpoint");
  if (!entry || entry.type !== "endpoint") {
    throw new Error("registration entry point missing");
  }

  assertEquals(entry.path, "/apps");
  assertStringIncludes(entry.body, "public app profile");
  assertStringIncludes(entry.body, "Developer settings");
});

Deno.test("registration docs derive identity and allow verified host links", () => {
  const login = JSON.stringify(requiredPage("atmosphere-login"));
  const registration = JSON.stringify(requiredPage("register-app"));

  assertStringIncludes(
    login,
    "app name, homepage, and logo come from its app profile",
  );
  assertStringIncludes(login, "verified app-host relationship");
  assertStringIncludes(registration, "Derived from the public app profile");
  assertStringIncludes(registration, "verified app-host relationship");
  assertEquals(
    registration.includes(
      "Create a development or production app registration with a name",
    ),
    false,
  );
});

Deno.test("public docs use the Login with Atmosphere product name", () => {
  const docs = JSON.stringify(docsPages);
  assertStringIncludes(docs, "Login with Atmosphere");
  assertEquals(docs.includes("Atmosphere Login"), false);
  assertEquals(docs.includes("Continue with Atmosphere"), false);
  assertEquals(docs.includes("Sign in with Atmosphere account"), false);
});

function requiredPage(slug: string) {
  const page = getDocsPage(slug);
  if (!page) throw new Error(`${slug} docs page missing`);
  return page;
}
