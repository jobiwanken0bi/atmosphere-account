import { hostHandleDemoFrames } from "./HostHandleDemo.tsx";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("host handle animation always fills one six-host cycle", () => {
  const custom = { label: "Custom", prefix: "you.", suffix: "example.com" };

  assertEquals(hostHandleDemoFrames([custom]), Array(6).fill(custom));
  assertEquals(hostHandleDemoFrames([]).length, 6);
  assertEquals(hostHandleDemoFrames([])[0], {
    label: "Bluesky handle",
    prefix: "you.",
    suffix: "bsky.social",
  });
});
