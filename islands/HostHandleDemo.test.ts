import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import HostHandleDemo, { hostHandleDemoFrames } from "./HostHandleDemo.tsx";

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

Deno.test("host handle animation keeps one stable input surface", () => {
  const html = renderToString(h(HostHandleDemo, {
    examples: [
      { label: "Bluesky handle", prefix: "you.", suffix: "bsky.social" },
      { label: "Sprk handle", prefix: "you.", suffix: "sprk.so" },
    ],
    demoAriaLabel: "Animated handle examples",
    demoButton: "Login with Atmosphere",
  }));

  assertEquals(count(html, 'class="host-handle-demo-input"'), 1);
  assertEquals(count(html, 'class="host-handle-at"'), 1);
  assertEquals(count(html, 'class="host-handle-value-frame"'), 6);
  assertEquals(count(html, 'class="host-handle-demo-label-frame"'), 6);
});

Deno.test("host handle labels sit fully inside their animation row", async () => {
  const css = await Deno.readTextFile(
    new URL("../static/styles.css", import.meta.url),
  );
  const labelFrameRule = css.match(
    /\.host-handle-demo-label-frame\s*\{([^}]*)\}/,
  )?.[1] ?? "";

  assertEquals(labelFrameRule.includes("display: flex;"), true);
  assertEquals(labelFrameRule.includes("align-items: flex-start;"), true);
});

function count(source: string, value: string): number {
  return source.split(value).length - 1;
}
