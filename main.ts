/// <reference path="./types/jsx-custom.d.ts" />
import { App, staticFiles } from "fresh";
import type { State } from "./utils.ts";
import { localeMiddleware } from "./i18n/mod.ts";
import { wellKnownMiddleware } from "./lib/wellknown.ts";
import { trailingSlashRedirectMiddleware } from "./lib/trailing-slash-redirect.ts";
import { sessionMiddleware } from "./lib/session.ts";

export const app = new App<State>();

app.use(staticFiles());
app.use(trailingSlashRedirectMiddleware);
app.use(wellKnownMiddleware);
app.use(localeMiddleware);
app.use(sessionMiddleware);

app.fsRoutes();
