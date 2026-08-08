/** Escape user text for a parameterized SQL LIKE/ILIKE pattern.
 * Parameterization prevents SQL injection, while this escaping prevents `%`
 * and `_` from turning a literal directory search into an unbounded wildcard
 * scan. SQL clauses using this value must include `ESCAPE '!'`. */
export function escapeSqlLikePattern(value: string): string {
  return value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll(
    "_",
    "!_",
  );
}
