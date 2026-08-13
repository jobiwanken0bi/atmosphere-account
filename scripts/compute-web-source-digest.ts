import { webSourceDigest } from "../lib/web-source-digest.ts";

if (import.meta.main) console.log(await webSourceDigest());
