/**
 * Defensive SVG sanitiser for the developer-icon upload path. SVGs are
 * XML and can carry inline `<script>`, event-handler attributes
 * (`onclick=…`), `<foreignObject>` HTML payloads, and `javascript:` /
 * non-image `data:` URLs in href/xlink:href. We strip all of those and
 * normalise the file before persisting to the PDS, which lets us serve
 * the bytes back as `image/svg+xml` without worrying that an embedder
 * pulls in active content.
 *
 * This is paired with `Content-Security-Policy: default-src 'none'`
 * + `X-Content-Type-Options: nosniff` on the serve path, so it's
 * defence-in-depth rather than the sole guard. The sanitiser uses a
 * regex/string-substitution approach (no DOM) because Deno doesn't ship
 * a built-in HTML/XML parser; the SVGs we accept are dev-supplied logo
 * marks, so a small rewrite pass is plenty.
 */

const SCRIPT_TAG_RE = /<script\b[\s\S]*?<\/script\s*>/gi;
const SCRIPT_SELFCLOSE_RE = /<script\b[^>]*\/>/gi;
const FOREIGN_OBJECT_RE = /<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi;
const FOREIGN_OBJECT_SELFCLOSE_RE = /<foreignObject\b[^>]*\/>/gi;
const STYLE_TAG_RE = /<style\b[\s\S]*?<\/style\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const PI_RE = /<\?[\s\S]*?\?>/g;
const DOCTYPE_RE = /<!DOCTYPE[\s\S]*?>/gi;
const ON_HANDLER_ATTR_RE = / on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * Match `href`/`xlink:href` attributes. We replace the attribute value
 * with `#` if it points at anything other than a fragment, http(s):,
 * mailto:, or an inline `data:image/...` URL. This blocks `javascript:`,
 * `vbscript:`, plain `data:text/html`, etc.
 */
const HREF_ATTR_RE =
  /\s(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function safeHref(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith("#")) return true;
  if (v.startsWith("http://") || v.startsWith("https://")) return true;
  if (v.startsWith("mailto:")) return true;
  // Allow inline image data URLs only — these are common in SVGs that
  // embed raster fallbacks or pattern fills.
  if (v.startsWith("data:image/")) return true;
  return false;
}

/**
 * Strip script-y bits from an SVG string. Returns the cleaned SVG.
 * Throws if the input doesn't contain an `<svg>` root element.
 */
export function sanitizeSvg(input: string): string {
  let s = input;

  s = s.replace(COMMENT_RE, "");
  s = s.replace(PI_RE, "");
  s = s.replace(DOCTYPE_RE, "");

  s = s.replace(SCRIPT_TAG_RE, "");
  s = s.replace(SCRIPT_SELFCLOSE_RE, "");
  s = s.replace(FOREIGN_OBJECT_RE, "");
  s = s.replace(FOREIGN_OBJECT_SELFCLOSE_RE, "");
  // Inline <style> blocks can fetch external resources via @import or
  // url(javascript:...). Stripping them is the simplest safe option;
  // logos we care about use presentation attributes / <defs> instead.
  s = s.replace(STYLE_TAG_RE, "");

  s = s.replace(ON_HANDLER_ATTR_RE, "");

  s = s.replace(HREF_ATTR_RE, (match, dq, sq, bare) => {
    const value = (dq ?? sq ?? bare ?? "") as string;
    if (safeHref(value)) return match;
    // Preserve the attribute name + quote style but neutralise the value.
    if (dq !== undefined) return match.replace(dq, "#");
    if (sq !== undefined) return match.replace(sq, "#");
    return match.replace(bare as string, "#");
  });

  if (!/<svg[\s>]/i.test(s)) {
    throw new Error("not an SVG: missing <svg> root element");
  }
  return s.trim();
}

/**
 * Decode a UTF-8 byte buffer (typed-array friendly) into a string for
 * sanitisation; re-encode the cleaned SVG back to bytes for upload.
 */
export function sanitizeSvgBytes(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const cleaned = sanitizeSvg(text);
  return new TextEncoder().encode(cleaned);
}
