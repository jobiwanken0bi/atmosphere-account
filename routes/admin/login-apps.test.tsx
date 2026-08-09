import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import {
  loginAppReviewPagination,
  LoginAppReviewPaginationNav,
  mapWithConcurrency,
  parseLoginAppReviewPage,
} from "./login-apps.tsx";

Deno.test("login app review page parsing rejects invalid and unsafe values", () => {
  assertEquals(parseLoginAppReviewPage(null), 1);
  assertEquals(parseLoginAppReviewPage(""), 1);
  assertEquals(parseLoginAppReviewPage("0"), 1);
  assertEquals(parseLoginAppReviewPage("-2"), 1);
  assertEquals(parseLoginAppReviewPage("2.5"), 1);
  assertEquals(parseLoginAppReviewPage("9007199254740992"), 1);
  assertEquals(parseLoginAppReviewPage(" 3 "), 3);
});

Deno.test("login app review pagination clamps pages and reports the visible range", () => {
  assertEquals(loginAppReviewPagination(3, 45), {
    page: 3,
    pageSize: 20,
    pageCount: 3,
    total: 45,
    offset: 40,
    first: 41,
    last: 45,
  });
  assertEquals(loginAppReviewPagination(99, 21), {
    page: 2,
    pageSize: 20,
    pageCount: 2,
    total: 21,
    offset: 20,
    first: 21,
    last: 21,
  });
  assertEquals(loginAppReviewPagination(2, 0), {
    page: 1,
    pageSize: 20,
    pageCount: 1,
    total: 0,
    offset: 0,
    first: 0,
    last: 0,
  });
});

Deno.test("login app review pagination renders previous and next links", () => {
  const html = renderToString(
    <LoginAppReviewPaginationNav
      pagination={loginAppReviewPagination(2, 61)}
    />,
  );

  assertStringIncludes(html, 'href="/admin/login-apps" rel="prev"');
  assertStringIncludes(html, "Page 2 of 4");
  assertStringIncludes(html, 'href="/admin/login-apps?page=3" rel="next"');
});

Deno.test("login app review checks use bounded concurrency and preserve order", async () => {
  let active = 0;
  let maximumActive = 0;
  const output = await mapWithConcurrency(
    [1, 2, 3, 4, 5, 6, 7],
    3,
    async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, value % 2 + 1));
      active -= 1;
      return value * 10;
    },
  );

  assertEquals(maximumActive, 3);
  assertEquals(output, [10, 20, 30, 40, 50, 60, 70]);
});
