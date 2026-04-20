/**
 * Extracts embedded data-uri images from static/atmosphere.json into
 * static/lottie-assets/, then builds static/lottie-icons.zip for the
 * developer resources page. Re-run when the Lottie source changes.
 * Requires the `zip` CLI (macOS/Linux).
 */
import { fromFileUrl } from "jsr:@std/path@^1.1.4/from-file-url";

const jsonPath = new URL("../static/atmosphere.json", import.meta.url);
const outDir = new URL("../static/lottie-assets/", import.meta.url);
const zipPath = new URL("../static/lottie-icons.zip", import.meta.url);

const text = await Deno.readTextFile(jsonPath);
const data = JSON.parse(text) as {
  assets?: Array<{ id?: string; p?: string }>;
};

await Deno.mkdir(outDir, { recursive: true });

const filenames: string[] = [];

for (const asset of data.assets ?? []) {
  const p = asset.p;
  if (typeof p !== "string" || !p.startsWith("data:image/")) continue;
  const m = p.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!m) continue;
  let ext = m[1];
  if (ext === "jpeg") ext = "jpg";
  const id = asset.id ?? "asset";
  const filename = `${id}.${ext}`;
  const buf = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  await Deno.writeFile(new URL(filename, outDir), buf);
  filenames.push(filename);
}

try {
  await Deno.remove(zipPath);
} catch {
  /* ignore if missing */
}

if (filenames.length > 0) {
  const zipFile = fromFileUrl(zipPath);
  const inputPaths = filenames.map((name) =>
    fromFileUrl(new URL(name, outDir))
  );
  const { code, stderr } = await new Deno.Command("zip", {
    args: ["-j", "-q", zipFile, ...inputPaths],
  }).output();
  if (code !== 0) {
    throw new Error(
      `zip failed (${code}): ${new TextDecoder().decode(stderr)}`,
    );
  }
}

console.log(
  `Wrote ${filenames.length} files to static/lottie-assets/ and static/lottie-icons.zip`,
);
