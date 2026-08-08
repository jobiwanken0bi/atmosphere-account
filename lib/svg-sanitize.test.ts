import { assertEquals } from "jsr:@std/assert@1";
import { sanitizeSvg } from "./svg-sanitize.ts";

Deno.test("SVG sanitization covers XML whitespace and namespace aliases", () => {
  const cleaned = sanitizeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg"
      xmlns:s="http://www.w3.org/2000/svg"
      xmlns:links="http://www.w3.org/1999/xlink"
      onload="alert(1)">
      <s:script>alert(1)</s:script>
      <s:foreignObject><div>active html</div></s:foreignObject>
      <image links:href="javascript:alert(1)" />
      <path d="M0 0" />
    </svg>
  `);

  assertEquals(cleaned.toLowerCase().includes("script"), false);
  assertEquals(cleaned.toLowerCase().includes("foreignobject"), false);
  assertEquals(cleaned.toLowerCase().includes("onload"), false);
  assertEquals(cleaned.includes('links:href="#"'), true);
  assertEquals(cleaned.includes("<path"), true);
});
