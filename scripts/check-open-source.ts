import { SUPPORTED_LOCALES } from "../i18n/locales.ts";
import { getMessages } from "../i18n/messages/index.ts";

const REQUIRED_FILES = [
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "GOVERNANCE.md",
  "SECURITY.md",
  "SUPPORT.md",
  ".github/CODEOWNERS",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/translation.yml",
] as const;

const MARKDOWN_ROOTS = [
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "GOVERNANCE.md",
  "SECURITY.md",
  "SUPPORT.md",
  "docs",
  "examples",
  "i18n",
] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function markdownFiles(path: string): Promise<string[]> {
  const stat = await Deno.stat(path);
  if (stat.isFile) return path.endsWith(".md") ? [path] : [];
  const files: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory) files.push(...await markdownFiles(child));
    if (entry.isFile && child.endsWith(".md")) files.push(child);
  }
  return files;
}

function localMarkdownTargets(markdown: string): string[] {
  const targets: string[] = [];
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
    if (
      !raw || raw.startsWith("#") || raw.startsWith("/") ||
      /^[a-z][a-z\d+.-]*:/i.test(raw)
    ) continue;
    targets.push(raw);
  }
  return targets;
}

async function checkMarkdownLinks(files: string[]): Promise<number> {
  const root = new URL(`file://${Deno.cwd()}/`);
  let checked = 0;
  for (const file of files) {
    const markdown = await Deno.readTextFile(file);
    const source = new URL(file, root);
    for (const target of localMarkdownTargets(markdown)) {
      const resolved = new URL(target, source);
      const path = decodeURIComponent(resolved.pathname);
      if (!await exists(path)) {
        throw new Error(`${file} links to missing local path ${target}`);
      }
      checked++;
    }
  }
  return checked;
}

for (const file of REQUIRED_FILES) {
  if (!await exists(file)) throw new Error(`Missing open-source file: ${file}`);
}

const readme = await Deno.readTextFile("README.md");
for (
  const forge of [
    "https://github.com/jobiwanken0bi/atmosphere-account",
    "https://tangled.org/@joebasser.com/atmosphere-account",
  ]
) {
  if (!readme.includes(forge)) {
    throw new Error(`README missing forge: ${forge}`);
  }
}

for (const locale of SUPPORTED_LOCALES) {
  const catalog = getMessages(locale);
  for (const namedLocale of SUPPORTED_LOCALES) {
    if (!catalog.localeSwitcher.languageNames[namedLocale]?.trim()) {
      throw new Error(`${locale} catalog does not name ${namedLocale}`);
    }
  }
}

const markdown = (
  await Promise.all(MARKDOWN_ROOTS.map((path) => markdownFiles(path)))
).flat();
const linkCount = await checkMarkdownLinks(markdown);

console.log(
  `[oss:check] ok required=${REQUIRED_FILES.length} markdown=${markdown.length} localLinks=${linkCount} locales=${SUPPORTED_LOCALES.length}`,
);
