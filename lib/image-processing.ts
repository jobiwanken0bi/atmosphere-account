import sharp from "sharp";

/**
 * The public media proxy runs in the same long-lived process as the web app.
 * Keep libvips from retaining decoded pixels between unrelated requests and
 * serialize native transforms so bursts cannot multiply peak RSS.
 */
sharp.cache({ memory: 0, files: 0, items: 0 });
sharp.concurrency(1);

let imageTransformTail = Promise.resolve();

export async function withImageTransformSlot<T>(
  transform: () => Promise<T>,
): Promise<T> {
  const previous = imageTransformTail;
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  imageTransformTail = previous.then(() => current);
  await previous;
  try {
    return await transform();
  } finally {
    release();
  }
}

export function imageProcessingRuntimeSettings() {
  return {
    concurrency: sharp.concurrency(),
    cache: sharp.cache(),
  };
}

export async function coverJpeg(
  bytes: Uint8Array,
  width: number,
  height: number,
  quality: number,
): Promise<Uint8Array> {
  return await withImageTransformSlot(async () => {
    const jpeg = await sharp(bytes, {
      failOn: "none",
      limitInputPixels: 40_000_000,
    })
      .resize(width, height, { fit: "cover", position: "center" })
      .jpeg({ quality })
      .toBuffer();
    return new Uint8Array(jpeg).slice();
  });
}

export async function fitWebp(
  bytes: Uint8Array,
  maxWidth: number,
  quality: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return await withImageTransformSlot(async () => {
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
  });
}
