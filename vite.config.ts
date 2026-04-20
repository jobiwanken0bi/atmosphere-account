import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

export default defineConfig({
  plugins: [fresh()],
  server: {
    /** Match local OAuth / site URL defaults; fail fast if another dev server is still bound. */
    port: 5173,
    strictPort: true,
  },
});
