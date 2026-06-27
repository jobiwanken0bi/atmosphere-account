import { IS_DEV } from "../lib/env.ts";

let cachedCss: string | null = null;

async function readStyles(): Promise<string> {
  if (!IS_DEV && cachedCss) return cachedCss;
  const css = await Deno.readTextFile(
    new URL("../assets/styles.css", import.meta.url),
  );
  if (!IS_DEV) cachedCss = css;
  return css;
}

export const handler = {
  async GET(): Promise<Response> {
    const css = await readStyles();
    return new Response(css, {
      headers: {
        "content-type": "text/css; charset=utf-8",
        "cache-control": IS_DEV
          ? "no-cache"
          : "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  },
};
