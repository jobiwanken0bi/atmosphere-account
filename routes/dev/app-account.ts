import { define } from "../../utils.ts";
import { IS_DEV } from "../../lib/env.ts";
import { buildSessionCookie, createSession } from "../../lib/session.ts";
import { setAppUserType } from "../../lib/account-types.ts";

/**
 * Dev-only helper: sign in as a demo **app (project)** account so the app
 * onboarding (and the "an app can also be a host" flow) can be exercised
 * locally without a real OAuth/PDS session.
 *
 * Query params:
 *   - handle:  override the account handle (defaults to a random *.test)
 *   - name:    display name (defaults to "Local App Test")
 *   - next:    "host" → land on /hosts/register, otherwise /apps/manage
 *   - fixture: "field-notes" → use the populated seeded app profile
 *
 * Gated behind IS_DEV + ATMOSPHERE_ENABLE_DEV_LOGIN=1, matching
 * routes/dev/host-account.ts.
 */
export const handler = define.handlers({
  async GET(ctx) {
    if (!IS_DEV || Deno.env.get("ATMOSPHERE_ENABLE_DEV_LOGIN") !== "1") {
      return new Response("Not found", { status: 404 });
    }

    const url = new URL(ctx.req.url);
    const seededFixture = url.searchParams.get("fixture") === "field-notes";
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    const handle = seededFixture
      ? "field-notes.test"
      : normalizeDevHandle(url.searchParams.get("handle")) ??
        `local-app-${id}.test`;
    const displayName = seededFixture
      ? "Field Notes"
      : textValue(url.searchParams.get("name")) || "Local App Test";
    const did = seededFixture
      ? "did:plc:localdevfieldnotesapp"
      : `did:plc:aalocalapp${id}`;
    const cookieValue = await createSession({ did, handle });

    // Classify the DID as a project account so /apps/manage and the
    // host-register reuse flow both treat it as an app.
    await setAppUserType({
      did,
      handle,
      displayName,
      accountType: "project",
    });

    const next = url.searchParams.get("next") === "host"
      ? "/hosts/register"
      : "/apps/manage";

    return new Response(null, {
      status: 303,
      headers: {
        "cache-control": "no-store",
        "location": next,
        "set-cookie": buildSessionCookie(cookieValue),
      },
    });
  },
});

function normalizeDevHandle(value: string | null): string | null {
  const handle = textValue(value).replace(/^@/, "").toLowerCase();
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(handle)
  ) {
    return null;
  }
  if (
    handle === "localhost" || handle.endsWith(".localhost") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(handle)
  ) {
    return null;
  }
  return handle;
}

function textValue(value: string | null): string {
  return value?.trim() ?? "";
}
