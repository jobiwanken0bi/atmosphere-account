/// <reference path="./types/jsx-custom.d.ts" />
import { App, staticFiles } from "fresh";
import type { State } from "./utils.ts";
import { localeMiddleware } from "./i18n/mod.ts";
import { wellKnownMiddleware } from "./lib/wellknown.ts";
import { trailingSlashRedirectMiddleware } from "./lib/trailing-slash-redirect.ts";
import { sessionMiddleware } from "./lib/session.ts";
import { csrfMiddleware, securityHeadersMiddleware } from "./lib/security.ts";
import { slowRequestLoggingMiddleware } from "./lib/request-observability.ts";
import { loginDomainMiddleware } from "./lib/login-domain.ts";
import { sdkAssetMiddleware } from "./lib/sdk-assets.ts";

export const app = new App<State>();

app.use(securityHeadersMiddleware);
app.use(csrfMiddleware);
app.use(slowRequestLoggingMiddleware);
app.use(loginDomainMiddleware);
app.use(sdkAssetMiddleware);
app.use(staticFiles());
app.use(trailingSlashRedirectMiddleware);
app.use(wellKnownMiddleware);
app.use(localeMiddleware);
app.use(sessionMiddleware);

app.fsRoutes();
