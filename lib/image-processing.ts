import sharp from "npm:sharp@0.34.5";

export async function coverJpeg(
  bytes: Uint8Array,
  width: number,
  height: number,
  quality: number,
): Promise<Uint8Array> {
  const jpeg = await sharp(bytes, { failOn: "none" })
    .resize(width, height, { fit: "cover", position: "center" })
    .jpeg({ quality })
    .toBuffer();
  return new Uint8Array(jpeg).slice();
}

export async function fitWebp(
  bytes: Uint8Array,
  maxWidth: number,
  quality: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const webp = await sharp(bytes, {
    failOn: "none",
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .resize({
      width: maxWidth,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer();
  return Uint8Array.from(webp) as Uint8Array<ArrayBuffer>;
}
