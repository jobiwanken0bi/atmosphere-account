import { define } from "../utils.ts";
import {
  isLoginRequestOrigin,
  loginPickerUrlForRequest,
  trustedRequestOrigin,
} from "./atmosphere-origins.ts";
import { IS_DEV, loginOrigin, siteOrigin } from "./env.ts";

const LOGIN_HOST_PATHS = [
  "/login/select",
  "/signin",
  "/oauth/login",
  "/oauth/callback",
  "/oauth/client-metadata.json",
  "/oauth/jwks.json",
  "/oauth/add-account",
  "/oauth/switch",
  "/oauth/forget",
  "/api/login/selection",
  "/api/locale",
  "/favicon.ico",
  "/union.svg",
  "/styles.css",
  "/signin-preview.js",
  "/page-skeleton.js",
  "/atmosphere-login.js",
  "/atmosphere-login-server.js",
] as const;

function isAllowedLoginHostPath(pathname: string): boolean {
  if (LOGIN_HOST_PATHS.includes(pathname as typeof LOGIN_HOST_PATHS[number])) {
    return true;
  }
  return pathname.startsWith("/_fresh/") ||
    pathname.startsWith("/api/registry/avatar/");
}

function redirectTo(url: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: {
      location: url,
      "cache-control": "no-store",
    },
  });
}

export const loginDomainMiddleware = define.middleware((ctx) => {
  const origin = trustedRequestOrigin(ctx.url);

  if (
    !IS_DEV &&
    origin === siteOrigin() &&
    ctx.url.pathname === "/login/select" &&
    (ctx.req.method === "GET" || ctx.req.method === "HEAD")
  ) {
    return redirectTo(loginPickerUrlForRequest(ctx.url), 308);
  }

  if (!isLoginRequestOrigin(ctx.url)) return ctx.next();

  if (isAllowedLoginHostPath(ctx.url.pathname)) return ctx.next();

  const target = new URL(ctx.url.pathname + ctx.url.search, siteOrigin());
  if (target.origin === loginOrigin()) target.pathname = "/";
  return redirectTo(target.toString());
});
