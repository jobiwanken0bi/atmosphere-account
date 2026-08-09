import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  MAX_SVG_DOCUMENT_BYTES,
  sanitizeSvg,
  sanitizeSvgBytes,
} from "./svg-sanitize.ts";

Deno.test("SVG sanitization removes active namespace aliases and handlers", () => {
  const cleaned = sanitizeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg"
      xmlns:s="http://www.w3.org/2000/svg"
      xmlns:links="http://www.w3.org/1999/xlink"
      onload="alert(1)">
      <s:script><s:script>alert(1)</s:script></s:script>
      <s:foreignObject><div>active html</div></s:foreignObject>
      <image links:href="javascript&#x3a;alert(1)" />
      <path d="M0 0" />
    </svg>
  `);

  assertEquals(cleaned.toLowerCase().includes("script"), false);
  assertEquals(cleaned.toLowerCase().includes("foreignobject"), false);
  assertEquals(cleaned.toLowerCase().includes("onload"), false);
  assertEquals(cleaned.includes("javascript"), false);
  assertEquals(cleaned.includes("<image href="), false);
  assert(cleaned.includes('<path d="M0 0">'));
});

Deno.test("SVG sanitization keeps local reuse and drops resource-heavy features", () => {
  const cleaned = sanitizeSvg(`
    <svg viewBox="0 0 16 16">
      <style>@import url(https://tracker.example/a.css)</style>
      <defs><clipPath id="clip"><rect width="16" height="16" /></clipPath></defs>
      <path style="fill: red" onclick="alert(1)"
        fill="url(javascript:alert(1))" clip-path="url(#clip)" />
      <path fill="u\\72l(javascript:alert(1))" />
      <path fill="u/**/rl(https://tracker.example/paint)" />
      <path fill="image(&quot;https://tracker.example/paint&quot;)" />
      <path fill="rgb(20 30 40 / 50%)" />
      <path fill="url('#clip')" />
      <use href="#clip" />
      <linearGradient id="base" />
      <linearGradient id="derived" href="#base" />
      <path id="curve" />
      <text><textPath href="#curve">Label</textPath></text>
      <use href="data:image/svg+xml;base64,PHN2Zy8+" />
      <image href="https://tracker.example/pixel.png" />
      <image href="data:image/svg+xml;base64,PHN2Zy8+" />
      <image href="data:image/png;base64,iVBORw0KGgo=" />
      <filter id="expensive"><feTurbulence numOctaves="999999" /></filter>
      <path filter="url(#expensive)" />
      <animate attributeName="href" to="javascript:alert(1)" />
    </svg>
  `);

  assert(cleaned.includes('clip-path="url(#clip)"'));
  assert(cleaned.includes('fill="rgb(20 30 40 / 50%)"'));
  assert(cleaned.includes("fill=\"url('#clip')\""));
  assert(cleaned.includes('href="#clip"'));
  assert(cleaned.includes('<linearGradient id="derived" href="#base">'));
  assert(cleaned.includes('<textPath href="#curve">Label</textPath>'));
  assertEquals(cleaned.includes("tracker.example"), false);
  assertEquals(cleaned.includes("image/svg+xml"), false);
  assertEquals(cleaned.includes("<image"), false);
  assertEquals(cleaned.includes("<filter"), false);
  assertEquals(cleaned.includes("<fe"), false);
  assertEquals(cleaned.includes(" filter="), false);
  assertEquals(cleaned.includes("javascript"), false);
  assertEquals(cleaned.includes("<style"), false);
  assertEquals(cleaned.includes("<animate"), false);
  assertEquals(cleaned.includes(" style="), false);
});

Deno.test("SVG sanitization rejects malformed or ambiguous XML", () => {
  for (
    const input of [
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>',
      "<svg><script>alert(1)</script \t\n ignored></svg>",
      "<svg><!-- unterminated</svg>",
      "<div><svg></svg></div>",
      "<svg></svg><svg></svg>",
      "<svg><g></svg>",
      '<svg><use href="#one" xlink:href="#two" /></svg>',
      "<svg>&unknown;</svg>",
    ]
  ) {
    assertThrows(() => sanitizeSvg(input), Error);
  }
});

Deno.test("SVG CDATA is serialized as inert text", () => {
  const cleaned = sanitizeSvg(
    "<svg><text><![CDATA[<script>alert(1)</script>]]></text></svg>",
  );
  assert(cleaned.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assertEquals(cleaned.includes("<script>"), false);
});

Deno.test("SVG byte decoding rejects invalid UTF-8", () => {
  assertThrows(
    () => sanitizeSvgBytes(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0xff])),
    TypeError,
  );
});

Deno.test("SVG sanitization enforces its own document-size boundary", () => {
  const oversized = new Uint8Array(MAX_SVG_DOCUMENT_BYTES + 1);
  assertThrows(() => sanitizeSvgBytes(oversized), Error, "200 KB");
  assertThrows(
    () => sanitizeSvg(`<svg>${"x".repeat(MAX_SVG_DOCUMENT_BYTES)}</svg>`),
    Error,
    "200 KB",
  );
});
