import { assertEquals } from "jsr:@std/assert@1";
import { readAppSearchInputForTest } from "./search.ts";

Deno.test("app directory API bounds query, tag, and pagination inputs", () => {
  assertEquals(
    readAppSearchInputForTest(
      new URLSearchParams({ q: "x".repeat(129) }),
    ),
    null,
  );
  assertEquals(
    readAppSearchInputForTest(new URLSearchParams("q=one&q=two")),
    null,
  );
  assertEquals(
    readAppSearchInputForTest(
      new URLSearchParams({ tag: "x".repeat(769) }),
    ),
    null,
  );
  const tooManyTags = new URLSearchParams();
  for (let i = 0; i < 13; i++) tooManyTags.append("tag", `tag-${i}`);
  assertEquals(readAppSearchInputForTest(tooManyTags), null);
  assertEquals(
    readAppSearchInputForTest(new URLSearchParams({ page: "Infinity" })),
    null,
  );
  assertEquals(
    readAppSearchInputForTest(
      new URLSearchParams({
        q: " social ",
        tag: "one,two",
        page: "999999",
      }),
    ),
    { query: "social", tag: ["one", "two"], page: 1_000 },
  );
});
