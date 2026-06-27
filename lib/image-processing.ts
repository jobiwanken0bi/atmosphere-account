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
