interface LoadDotEnvOptions {
  path?: string;
  override?: boolean;
}

function stripInlineComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if ((ch === '"' || ch === "'") && value[i - 1] !== "\\") {
      quote = quote === ch ? null : quote ?? ch;
      continue;
    }
    if (!quote && ch === "#") return value.slice(0, i).trimEnd();
  }
  return value.trimEnd();
}

function decodeValue(rawValue: string): string {
  const value = stripInlineComment(rawValue.trim());
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    return value.startsWith('"')
      ? inner.replaceAll("\\n", "\n").replaceAll('\\"', '"')
      : inner.replaceAll("\\'", "'");
  }
  return value;
}

export async function loadDotEnvIfPresent(
  options: LoadDotEnvOptions = {},
): Promise<string[]> {
  const path = options.path ?? ".env";
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }

  const loaded: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (!options.override && Deno.env.get(key) != null) continue;
    Deno.env.set(key, decodeValue(normalized.slice(eq + 1)));
    loaded.push(key);
  }
  return loaded;
}

export function requireEnv(key: string, reason: string): string {
  const value = Deno.env.get(key);
  if (value) return value;
  throw new Error(`${key} is required. ${reason}`);
}
