import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

export default defineConfig({
  plugins: [fresh()],
  server: {
    /** Match local OAuth / site URL defaults; fail fast if another dev server is still bound. */
    port: 5173,
    strictPort: true,
    /** Disable browser caching during dev so every save is reflected on the next request
     *  without needing a hard refresh. Vite HMR still applies in-place for CSS and islands. */
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    },
    /** Make sure HMR uses the same port so client/server stay in sync. */
    hmr: { port: 5173 },
    /** Reload the page when files outside the JS module graph change (e.g. assets/*.css
     *  imports, server route files). */
    watch: { usePolling: false },
  },
});
