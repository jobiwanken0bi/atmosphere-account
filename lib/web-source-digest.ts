import { join, resolve } from "jsr:@std/path@1";

export const WEB_SOURCE_DIGEST_VERSION = "web-source-v1" as const;

export interface WebSourceDigest {
  algorithmVersion: typeof WEB_SOURCE_DIGEST_VERSION;
  digest: string;
  /** Canonical repository-relative paths, sorted by their UTF-8 bytes. */
  files: string[];
}

export interface WebSourceDigestOptions {
  root?: string;
  configPath?: string;
}

export interface RailwayWebConfig {
  build?: { watchPatterns?: unknown };
}

export interface WatchedPath {
  pattern: string;
  relativePath: string;
  recursive: boolean;
}

/** Match a canonical Git/repository path against one validated watch entry. */
export function railwayWatchEntryMatchesFile(
  file: string,
  entry: WatchedPath,
): boolean {
  if (
    !file || file.startsWith("/") || file.includes("\\") ||
    file.includes("//") ||
    file.split("/").some((segment) =>
      !segment || segment === "." || segment === ".."
    )
  ) return false;
  return entry.recursive
    ? file === entry.relativePath || file.startsWith(`${entry.relativePath}/`)
    : file === entry.relativePath;
}

const textEncoder = new TextEncoder();
const GLOB_META = /[*?\[\]{}!]/;

/**
 * Hash exactly the source files that Railway considers capable of rebuilding
 * the web service. The framing and ordering are deliberately independent of
 * filesystem enumeration order and text decoding.
 */
export async function computeWebSourceDigest(
  options: WebSourceDigestOptions = {},
): Promise<WebSourceDigest> {
  const root = resolve(options.root ?? Deno.cwd());
  await requireDirectory(root, "web source root");
  const configRelativePath = validateRelativeOptionPath(
    options.configPath ?? "railway.web.json",
    "configPath",
  );
  const configFile = join(root, ...configRelativePath.split("/"));
  await requireRegularFile(configFile, configRelativePath);

  let config: RailwayWebConfig;
  try {
    config = JSON.parse(await Deno.readTextFile(configFile));
  } catch (error) {
    throw new Error(
      `could not parse ${configRelativePath}: ${errorMessage(error)}`,
    );
  }
  const watched = parseRailwayWebWatchPatterns(config);
  const files = new Map<string, string>();

  for (const entry of watched) {
    const absolutePath = join(root, ...entry.relativePath.split("/"));
    if (entry.recursive) {
      await requireDirectoryPathWithoutSymlinkAncestors(
        root,
        entry.relativePath,
        entry.pattern,
      );
      await collectDirectoryFiles(
        root,
        absolutePath,
        entry.relativePath,
        files,
      );
    } else {
      await requireRegularPathWithoutSymlinkAncestors(
        root,
        entry.relativePath,
        entry.pattern,
      );
      addUniqueFile(files, entry.relativePath, absolutePath, entry.pattern);
    }
  }

  if (!files.has(configRelativePath)) {
    throw new Error(
      `${configRelativePath} must include itself in build.watchPatterns`,
    );
  }

  const sortedFiles = [...files.keys()].sort(compareUtf8);
  const records: Uint8Array[] = [];
  for (const relativePath of sortedFiles) {
    const absolutePath = files.get(relativePath)!;
    const before = await Deno.lstat(absolutePath);
    if (!before.isFile || before.isSymlink) {
      throw new Error(`watched path is not a regular file: ${relativePath}`);
    }
    const content = await Deno.readFile(absolutePath);
    const after = await Deno.lstat(absolutePath);
    if (
      !after.isFile || after.isSymlink || after.size !== content.byteLength ||
      before.size !== after.size ||
      fileTime(before.mtime) !== fileTime(after.mtime)
    ) {
      throw new Error(`watched file changed while hashing: ${relativePath}`);
    }
    // Reserve the type byte so future versions can encode directories or
    // missing entries without colliding with a v1 regular-file record.
    records.push(
      Uint8Array.of(1),
      frame(textEncoder.encode(relativePath)),
      frame(content),
    );
  }

  const payload = concatenate([
    frame(textEncoder.encode("atmosphere-web-source")),
    frame(textEncoder.encode(WEB_SOURCE_DIGEST_VERSION)),
    uint64(sortedFiles.length),
    ...records,
  ]);
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", payload.buffer as ArrayBuffer),
  );
  const hex = [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return {
    algorithmVersion: WEB_SOURCE_DIGEST_VERSION,
    digest: `${WEB_SOURCE_DIGEST_VERSION}:sha256:${hex}`,
    files: sortedFiles,
  };
}

export async function webSourceDigest(
  options: WebSourceDigestOptions = {},
): Promise<string> {
  return (await computeWebSourceDigest(options)).digest;
}

export function parseRailwayWebWatchPatterns(
  config: unknown,
): WatchedPath[] {
  const rawPatterns = config && typeof config === "object" &&
      !Array.isArray(config) && "build" in config &&
      config.build && typeof config.build === "object" &&
      !Array.isArray(config.build) && "watchPatterns" in config.build
    ? config.build.watchPatterns
    : undefined;
  if (!Array.isArray(rawPatterns) || rawPatterns.length === 0) {
    throw new Error(
      "railway.web.json must define a non-empty build.watchPatterns array",
    );
  }

  const seen = new Set<string>();
  return rawPatterns.map((value, index) => {
    if (typeof value !== "string") {
      throw new Error(`build.watchPatterns[${index}] must be a string`);
    }
    const pattern = value;
    if (!pattern.startsWith("/") || pattern === "/") {
      throw new Error(`watch pattern must be root-relative: ${pattern}`);
    }
    if (
      pattern.includes("\\") || pattern.includes("//") ||
      [...pattern].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f;
      })
    ) {
      throw new Error(`watch pattern is not canonical: ${pattern}`);
    }
    const recursive = pattern.endsWith("/**");
    const pathPart = recursive ? pattern.slice(0, -3) : pattern;
    if (!pathPart || pathPart.endsWith("/") || GLOB_META.test(pathPart)) {
      throw new Error(
        `watch pattern must be an exact path or end in /**: ${pattern}`,
      );
    }
    if (!recursive && GLOB_META.test(pattern)) {
      throw new Error(
        `watch pattern must be an exact path or end in /**: ${pattern}`,
      );
    }
    const segments = pathPart.slice(1).split("/");
    if (
      segments.some((segment) =>
        !segment || segment === "." || segment === ".."
      )
    ) {
      throw new Error(`watch pattern contains path traversal: ${pattern}`);
    }
    const canonical = `/${segments.join("/")}${recursive ? "/**" : ""}`;
    if (canonical !== pattern) {
      throw new Error(`watch pattern is not canonical: ${pattern}`);
    }
    if (seen.has(canonical)) {
      throw new Error(`duplicate watch pattern: ${pattern}`);
    }
    seen.add(canonical);
    return {
      pattern,
      relativePath: segments.join("/"),
      recursive,
    };
  });
}

function validateRelativeOptionPath(value: string, label: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized || normalized.startsWith("/") || normalized.includes("//") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a canonical root-relative path`);
  }
  return normalized;
}

async function requireRegularPathWithoutSymlinkAncestors(
  root: string,
  relativePath: string,
  label: string,
): Promise<void> {
  const segments = relativePath.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(current);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`watched path is missing: ${label}`);
      }
      throw error;
    }
    if (info.isSymlink) {
      throw new Error(`watched path must not contain a symlink: ${label}`);
    }
    const isLeaf = index === segments.length - 1;
    if (isLeaf ? !info.isFile : !info.isDirectory) {
      throw new Error(
        `watched path is not a ${
          isLeaf ? "regular file" : "directory"
        }: ${label}`,
      );
    }
  }
}

async function requireDirectoryPathWithoutSymlinkAncestors(
  root: string,
  relativePath: string,
  label: string,
): Promise<void> {
  const segments = relativePath.split("/");
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(current);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`watched directory is missing: ${label}`);
      }
      throw error;
    }
    if (info.isSymlink) {
      throw new Error(`watched path must not contain a symlink: ${label}`);
    }
    if (!info.isDirectory) {
      throw new Error(`watched path is not a directory: ${label}`);
    }
  }
}

async function collectDirectoryFiles(
  root: string,
  absoluteDirectory: string,
  relativeDirectory: string,
  files: Map<string, string>,
): Promise<void> {
  for await (const entry of Deno.readDir(absoluteDirectory)) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    const absolutePath = join(root, ...relativePath.split("/"));
    const info = await Deno.lstat(absolutePath);
    if (info.isSymlink) {
      throw new Error(
        `watched path must not contain a symlink: ${relativePath}`,
      );
    }
    if (info.isDirectory) {
      await collectDirectoryFiles(root, absolutePath, relativePath, files);
    } else if (info.isFile) {
      addUniqueFile(files, relativePath, absolutePath, relativeDirectory);
    } else {
      throw new Error(`watched path is not a regular file: ${relativePath}`);
    }
  }
}

function addUniqueFile(
  files: Map<string, string>,
  relativePath: string,
  absolutePath: string,
  pattern: string,
): void {
  if (files.has(relativePath)) {
    throw new Error(
      `watched file is included by duplicate/overlapping patterns: ${relativePath} (${pattern})`,
    );
  }
  files.set(relativePath, absolutePath);
}

async function requireDirectory(path: string, label: string): Promise<void> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`watched directory is missing: ${label}`);
    }
    throw error;
  }
  if (info.isSymlink || !info.isDirectory) {
    throw new Error(`watched path is not a real directory: ${label}`);
  }
}

async function requireRegularFile(path: string, label: string): Promise<void> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`watched path is missing: ${label}`);
    }
    throw error;
  }
  if (info.isSymlink || !info.isFile) {
    throw new Error(`watched path is not a regular file: ${label}`);
  }
}

function compareUtf8(left: string, right: string): number {
  const a = textEncoder.encode(left);
  const b = textEncoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function frame(value: Uint8Array): Uint8Array {
  return concatenate([uint64(value.byteLength), value]);
}

function uint64(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("digest frame length is outside the safe integer range");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileTime(value: Date | null): number | null {
  return value?.getTime() ?? null;
}
