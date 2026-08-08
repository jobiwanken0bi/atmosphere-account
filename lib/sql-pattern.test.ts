import { assertEquals } from "jsr:@std/assert@1";
import { escapeSqlLikePattern } from "./sql-pattern.ts";

Deno.test("directory LIKE searches treat user wildcard characters literally", () => {
  assertEquals(escapeSqlLikePattern("100%_ready!"), "100!%!_ready!!");
});
