import sharp from "npm:sharp@0.34.5";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ogSvg = await readFile(join(root, "static/og-hero.svg"));
const ogPng = await sharp(ogSvg).png().resize(1200, 630).toBuffer();
await writeFile(join(root, "static/og-hero.png"), ogPng);
console.log("Wrote static/og-hero.png", ogPng.length, "bytes");

const unionSvg = await readFile(join(root, "static/union.svg"));
const bg = { r: 0, g: 0, b: 0, alpha: 0 };
const icon32 = await sharp(unionSvg).resize(32, 32, {
  fit: "contain",
  background: bg,
}).png().toBuffer();
const icon16 = await sharp(unionSvg).resize(16, 16, {
  fit: "contain",
  background: bg,
}).png().toBuffer();
const pngToIco = (await import("npm:png-to-ico@3.0.1")).default;
const ico = await pngToIco([icon16, icon32]);
await writeFile(join(root, "static/favicon.ico"), Buffer.from(ico));
console.log("Wrote static/favicon.ico");
