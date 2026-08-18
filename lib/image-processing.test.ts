import {
  imageProcessingRuntimeSettings,
  squarePng,
  withImageTransformSlot,
} from "./image-processing.ts";

Deno.test("image processing disables native cache and limits libvips threads", () => {
  const settings = imageProcessingRuntimeSettings();
  if (
    settings.concurrency !== 1 ||
    settings.cache.memory.max !== 0 ||
    settings.cache.files.max !== 0 ||
    settings.cache.items.max !== 0
  ) {
    throw new Error(
      `unsafe image runtime settings: ${JSON.stringify(settings)}`,
    );
  }
});

Deno.test("image transforms are serialized across concurrent requests", async () => {
  let active = 0;
  let peak = 0;
  const order: string[] = [];
  const run = (name: string) =>
    withImageTransformSlot(async () => {
      active++;
      peak = Math.max(peak, active);
      order.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end:${name}`);
      active--;
      return name;
    });

  const result = await Promise.all([run("a"), run("b"), run("c")]);
  if (
    peak !== 1 ||
    result.join(",") !== "a,b,c" ||
    order.join(",") !== "start:a,end:a,start:b,end:b,start:c,end:c"
  ) {
    throw new Error(
      `image transforms were not serialized: peak=${peak} order=${order}`,
    );
  }
});

Deno.test("avatar normalization produces an embeddable square PNG", async () => {
  const source = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="#f08"/></svg>',
  );
  const png = await squarePng(source, 32);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => png[index] === byte)) {
    throw new Error("Avatar normalization did not return a PNG");
  }
});
