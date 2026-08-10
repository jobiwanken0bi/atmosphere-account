import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appUserBskyClientUpdateStatementForTest } from "./account-types.ts";

Deno.test("microblog viewer preference is writable for every account role", () => {
  const statement = appUserBskyClientUpdateStatementForTest(
    "did:plc:app",
    "bluesky",
    true,
    123,
  );

  assertStringIncludes(statement.sql, "WHERE did = ?");
  assertFalse(statement.sql.includes("account_type"));
  assertEquals(statement.args, ["bluesky", 1, 123, "did:plc:app"]);
});
