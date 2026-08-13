Deno.test("ordinary profile reads exclude the cached OG image bytes", async () => {
  const source = await Deno.readTextFile(
    new URL("./registry.ts", import.meta.url),
  );
  const projection = source.match(
    /const SELECT_PROFILE = `([\s\S]*?)`;/,
  )?.[1] ?? "";
  if (!projection) throw new Error("Expected the shared profile projection");
  if (/\bp\.\*/.test(projection)) {
    throw new Error("Normal profile reads must use an explicit projection");
  }
  if (/\bog_jpeg\b/.test(projection)) {
    throw new Error("Normal profile reads must not fetch the cached OG JPEG");
  }
  for (
    const column of [
      "p.did",
      "p.handle",
      "p.profile_type",
      "p.account_indicators_json",
      "p.screenshots",
      "p.indexed_at",
      "f.badges AS featured_badges",
    ]
  ) {
    if (!projection.includes(column)) {
      throw new Error(`Profile projection is missing ${column}`);
    }
  }
  if (!source.includes("SELECT og_jpeg FROM profile WHERE did = ?")) {
    throw new Error(
      "The dedicated OG image retrieval query must remain available",
    );
  }
});
