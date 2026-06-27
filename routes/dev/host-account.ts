import { define } from "../../utils.ts";
import { IS_DEV } from "../../lib/env.ts";
import { buildSessionCookie, createSession } from "../../lib/session.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!IS_DEV || Deno.env.get("ATMOSPHERE_ENABLE_DEV_LOGIN") !== "1") {
      return new Response("Not found", { status: 404 });
    }

    const url = new URL(ctx.req.url);
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    const handle = normalizeDevHandle(url.searchParams.get("handle")) ??
      `local-host-${id}.test`;
    const displayName = textValue(url.searchParams.get("name")) ||
      "Local Host Test";
    const description = textValue(url.searchParams.get("description")) ||
      "A temporary local host account for visual registration testing.";
    const did = `did:plc:aalocal${id}`;
    const cookieValue = await createSession({ did, handle });

    const next = new URL("/hosts/register", url.origin);
    next.searchParams.set("host", handle);
    next.searchParams.set("displayName", displayName);
    next.searchParams.set("homepageUrl", `https://${handle}`);
    next.searchParams.set("signupStatus", "open");
    next.searchParams.set("description", description);

    return new Response(null, {
      status: 303,
      headers: {
        "cache-control": "no-store",
        "location": `${next.pathname}${next.search}`,
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
