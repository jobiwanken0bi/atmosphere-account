import { App, staticFiles } from "fresh";
import type { State } from "./utils.ts";
import { localeMiddleware } from "./i18n/mod.ts";

export const app = new App<State>();

app.use(staticFiles());
app.use(localeMiddleware);

app.fsRoutes();
