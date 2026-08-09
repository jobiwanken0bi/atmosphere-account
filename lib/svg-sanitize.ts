/**
 * Defensive SVG sanitiser for developer-supplied icons.
 *
 * SVG is XML, not a string format that can be safely cleaned with a handful
 * of regular expressions. This module therefore parses a deliberately small,
 * bounded XML subset and serialises only known-safe SVG elements and
 * attributes. Active elements, animation, CSS, event handlers, external
 * references, DTDs, and malformed XML are discarded or rejected before the
 * bytes are persisted. The serve path adds a locked-down CSP and `nosniff` as
 * a second boundary.
 */

const MAX_XML_DEPTH = 64;
const MAX_XML_ELEMENTS = 5_000;
const MAX_ATTRIBUTES_PER_ELEMENT = 256;
export const MAX_SVG_DOCUMENT_BYTES = 200_000;

type XmlChild = XmlElement | string;

interface XmlElement {
  name: string;
  attributes: Array<{ name: string; value: string }>;
  children: XmlChild[];
}

const SAFE_ELEMENTS = new Map<string, string>([
  ["svg", "svg"],
  ["g", "g"],
  ["defs", "defs"],
  ["symbol", "symbol"],
  ["use", "use"],
  ["view", "view"],
  ["switch", "switch"],
  ["path", "path"],
  ["rect", "rect"],
  ["circle", "circle"],
  ["ellipse", "ellipse"],
  ["line", "line"],
  ["polyline", "polyline"],
  ["polygon", "polygon"],
  ["text", "text"],
  ["tspan", "tspan"],
  ["textpath", "textPath"],
  ["title", "title"],
  ["desc", "desc"],
  ["metadata", "metadata"],
  ["lineargradient", "linearGradient"],
  ["radialgradient", "radialGradient"],
  ["stop", "stop"],
  ["pattern", "pattern"],
  ["clippath", "clipPath"],
  ["mask", "mask"],
  ["marker", "marker"],
]);

const SAFE_ATTRIBUTES = new Map<string, string>([
  ["id", "id"],
  ["version", "version"],
  ["viewbox", "viewBox"],
  ["preserveaspectratio", "preserveAspectRatio"],
  ["x", "x"],
  ["y", "y"],
  ["x1", "x1"],
  ["y1", "y1"],
  ["x2", "x2"],
  ["y2", "y2"],
  ["cx", "cx"],
  ["cy", "cy"],
  ["r", "r"],
  ["rx", "rx"],
  ["ry", "ry"],
  ["width", "width"],
  ["height", "height"],
  ["d", "d"],
  ["points", "points"],
  ["pathlength", "pathLength"],
  ["transform", "transform"],
  ["gradienttransform", "gradientTransform"],
  ["patterntransform", "patternTransform"],
  ["gradientunits", "gradientUnits"],
  ["patternunits", "patternUnits"],
  ["patterncontentunits", "patternContentUnits"],
  ["spreadmethod", "spreadMethod"],
  ["offset", "offset"],
  ["fill", "fill"],
  ["fill-opacity", "fill-opacity"],
  ["fill-rule", "fill-rule"],
  ["stroke", "stroke"],
  ["stroke-width", "stroke-width"],
  ["stroke-opacity", "stroke-opacity"],
  ["stroke-linecap", "stroke-linecap"],
  ["stroke-linejoin", "stroke-linejoin"],
  ["stroke-miterlimit", "stroke-miterlimit"],
  ["stroke-dasharray", "stroke-dasharray"],
  ["stroke-dashoffset", "stroke-dashoffset"],
  ["opacity", "opacity"],
  ["color", "color"],
  ["color-interpolation", "color-interpolation"],
  ["color-interpolation-filters", "color-interpolation-filters"],
  ["color-rendering", "color-rendering"],
  ["shape-rendering", "shape-rendering"],
  ["text-rendering", "text-rendering"],
  ["image-rendering", "image-rendering"],
  ["clip-rule", "clip-rule"],
  ["clip-path", "clip-path"],
  ["clippathunits", "clipPathUnits"],
  ["mask", "mask"],
  ["maskunits", "maskUnits"],
  ["maskcontentunits", "maskContentUnits"],
  ["marker-start", "marker-start"],
  ["marker-mid", "marker-mid"],
  ["marker-end", "marker-end"],
  ["markerwidth", "markerWidth"],
  ["markerheight", "markerHeight"],
  ["markerunits", "markerUnits"],
  ["refx", "refX"],
  ["refy", "refY"],
  ["orient", "orient"],
  ["font-family", "font-family"],
  ["font-size", "font-size"],
  ["font-style", "font-style"],
  ["font-weight", "font-weight"],
  ["font-stretch", "font-stretch"],
  ["font-variant", "font-variant"],
  ["text-anchor", "text-anchor"],
  ["dominant-baseline", "dominant-baseline"],
  ["alignment-baseline", "alignment-baseline"],
  ["baseline-shift", "baseline-shift"],
  ["direction", "direction"],
  ["unicode-bidi", "unicode-bidi"],
  ["letter-spacing", "letter-spacing"],
  ["word-spacing", "word-spacing"],
  ["writing-mode", "writing-mode"],
  ["textlength", "textLength"],
  ["lengthadjust", "lengthAdjust"],
  ["rotate", "rotate"],
  ["dx", "dx"],
  ["dy", "dy"],
  ["display", "display"],
  ["visibility", "visibility"],
  ["overflow", "overflow"],
  ["vector-effect", "vector-effect"],
  ["paint-order", "paint-order"],
  ["stop-color", "stop-color"],
  ["stop-opacity", "stop-opacity"],
  ["requiredextensions", "requiredExtensions"],
  ["systemlanguage", "systemLanguage"],
  ["xml:space", "xml:space"],
]);

const LOCAL_URL_ATTRIBUTES = new Set([
  "fill",
  "stroke",
  "clip-path",
  "mask",
  "marker-start",
  "marker-mid",
  "marker-end",
]);

class BoundedXmlParser {
  private position = 0;
  private elementCount = 0;

  constructor(private readonly input: string) {}

  parse(): XmlElement {
    const stack: XmlElement[] = [];
    let root: XmlElement | null = null;

    if (this.input.charCodeAt(0) === 0xfeff) this.position++;

    while (this.position < this.input.length) {
      if (this.input[this.position] !== "<") {
        const text = this.readText();
        if (stack.length === 0) {
          if (text.trim()) this.fail("text outside the SVG root");
        } else if (text) {
          stack[stack.length - 1].children.push(text);
        }
        continue;
      }

      if (this.startsWith("<!--")) {
        this.skipUntil("-->", "unterminated XML comment");
        continue;
      }
      if (this.startsWith("<?")) {
        this.skipUntil("?>", "unterminated processing instruction");
        continue;
      }
      if (this.startsWith("<![CDATA[")) {
        if (stack.length === 0) this.fail("CDATA outside the SVG root");
        this.position += 9;
        const end = this.input.indexOf("]]>", this.position);
        if (end < 0) this.fail("unterminated CDATA section");
        const text = this.input.slice(this.position, end);
        assertXmlCharacters(text);
        stack[stack.length - 1].children.push(text);
        this.position = end + 3;
        continue;
      }
      if (this.startsWithAsciiCaseInsensitive("<!doctype")) {
        this.fail("DOCTYPE declarations are not allowed");
      }
      if (this.startsWith("<!")) {
        this.fail("XML declarations are not allowed");
      }
      if (this.startsWith("</")) {
        this.position += 2;
        const name = this.readName();
        this.skipWhitespace();
        if (this.input[this.position] !== ">") {
          this.fail("malformed closing tag");
        }
        this.position++;
        const current = stack.pop();
        if (!current || current.name !== name) {
          this.fail("mismatched closing tag");
        }
        continue;
      }

      this.position++;
      const name = this.readName();
      const attributes: Array<{ name: string; value: string }> = [];
      const attributeNames = new Set<string>();
      let selfClosing = false;

      while (this.position < this.input.length) {
        const whitespace = this.skipWhitespace();
        if (this.startsWith("/>")) {
          this.position += 2;
          selfClosing = true;
          break;
        }
        if (this.input[this.position] === ">") {
          this.position++;
          break;
        }
        if (whitespace === 0) this.fail("missing attribute separator");
        if (attributes.length >= MAX_ATTRIBUTES_PER_ELEMENT) {
          this.fail("too many attributes");
        }
        const attributeName = this.readName();
        if (attributeNames.has(attributeName)) {
          this.fail("duplicate attribute");
        }
        attributeNames.add(attributeName);
        this.skipWhitespace();
        if (this.input[this.position] !== "=") {
          this.fail("attribute without a value");
        }
        this.position++;
        this.skipWhitespace();
        const quote = this.input[this.position];
        if (quote !== '"' && quote !== "'") {
          this.fail("unquoted attribute value");
        }
        this.position++;
        const start = this.position;
        while (
          this.position < this.input.length &&
          this.input[this.position] !== quote
        ) {
          if (this.input[this.position] === "<") {
            this.fail("less-than sign in attribute value");
          }
          this.position++;
        }
        if (this.position >= this.input.length) {
          this.fail("unterminated attribute value");
        }
        const value = decodeXmlEntities(
          this.input.slice(start, this.position),
        );
        this.position++;
        attributes.push({ name: attributeName, value });
      }

      if (this.position > this.input.length) this.fail("unterminated tag");
      this.elementCount++;
      if (this.elementCount > MAX_XML_ELEMENTS) this.fail("too many elements");
      if (stack.length >= MAX_XML_DEPTH) this.fail("SVG is too deeply nested");

      const element: XmlElement = { name, attributes, children: [] };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(element);
      } else {
        if (root) this.fail("multiple root elements");
        root = element;
      }
      if (!selfClosing) stack.push(element);
    }

    if (stack.length > 0) this.fail("unclosed element");
    if (!root) this.fail("missing SVG root element");
    return root;
  }

  private readText(): string {
    const start = this.position;
    const end = this.input.indexOf("<", start);
    this.position = end < 0 ? this.input.length : end;
    return decodeXmlEntities(this.input.slice(start, this.position));
  }

  private readName(): string {
    const start = this.position;
    if (!isNameStart(this.input.charCodeAt(this.position))) {
      this.fail("invalid XML name");
    }
    this.position++;
    while (isNameCharacter(this.input.charCodeAt(this.position))) {
      this.position++;
    }
    return this.input.slice(start, this.position);
  }

  private skipWhitespace(): number {
    const start = this.position;
    while (isXmlWhitespace(this.input.charCodeAt(this.position))) {
      this.position++;
    }
    return this.position - start;
  }

  private startsWith(value: string): boolean {
    return this.input.startsWith(value, this.position);
  }

  private startsWithAsciiCaseInsensitive(value: string): boolean {
    if (this.position + value.length > this.input.length) return false;
    return this.input.slice(this.position, this.position + value.length)
      .toLowerCase() === value;
  }

  private skipUntil(terminator: string, error: string): void {
    const end = this.input.indexOf(terminator, this.position + 2);
    if (end < 0) this.fail(error);
    this.position = end + terminator.length;
  }

  private fail(message: string): never {
    throw new Error(`${message} at character ${this.position}`);
  }
}

function isXmlWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a);
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isNameStart(code: number): boolean {
  return isAsciiLetter(code) || code === 0x5f || code === 0x3a;
}

function isNameCharacter(code: number): boolean {
  return isNameStart(code) || isAsciiDigit(code) || code === 0x2d ||
    code === 0x2e;
}

function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return (colon < 0 ? name : name.slice(colon + 1)).toLowerCase();
}

function decodeXmlEntities(value: string): string {
  let result = "";
  let position = 0;
  while (position < value.length) {
    const ampersand = value.indexOf("&", position);
    if (ampersand < 0) {
      result += value.slice(position);
      break;
    }
    result += value.slice(position, ampersand);
    const semicolon = value.indexOf(";", ampersand + 1);
    if (semicolon < 0) throw new Error("unterminated XML entity");
    const entity = value.slice(ampersand + 1, semicolon);
    let decoded: string;
    if (entity === "amp") decoded = "&";
    else if (entity === "lt") decoded = "<";
    else if (entity === "gt") decoded = ">";
    else if (entity === "quot") decoded = '"';
    else if (entity === "apos") decoded = "'";
    else if (entity.startsWith("#x") || entity.startsWith("#X")) {
      decoded = decodeNumericEntity(entity.slice(2), 16);
    } else if (entity.startsWith("#")) {
      decoded = decodeNumericEntity(entity.slice(1), 10);
    } else {
      throw new Error("unknown XML entity");
    }
    result += decoded;
    position = semicolon + 1;
  }
  assertXmlCharacters(result);
  return result;
}

function decodeNumericEntity(digits: string, radix: 10 | 16): string {
  if (!digits || digits.length > 8) throw new Error("invalid numeric entity");
  let value = 0;
  for (const digit of digits) {
    const code = digit.charCodeAt(0);
    let numeric = -1;
    if (isAsciiDigit(code)) numeric = code - 0x30;
    else if (radix === 16 && code >= 0x41 && code <= 0x46) {
      numeric = code - 0x41 + 10;
    } else if (radix === 16 && code >= 0x61 && code <= 0x66) {
      numeric = code - 0x61 + 10;
    }
    if (numeric < 0 || numeric >= radix) {
      throw new Error("invalid numeric entity");
    }
    value = value * radix + numeric;
  }
  if (!isXmlCodePoint(value)) throw new Error("invalid XML character");
  return String.fromCodePoint(value);
}

function isXmlCodePoint(value: number): boolean {
  return value === 0x09 || value === 0x0a || value === 0x0d ||
    (value >= 0x20 && value <= 0xd7ff) ||
    (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff);
}

function assertXmlCharacters(value: string): void {
  for (const character of value) {
    if (!isXmlCodePoint(character.codePointAt(0)!)) {
      throw new Error("invalid XML character");
    }
  }
}

function safeFragment(value: string): boolean {
  if (value.length < 2 || value[0] !== "#") return false;
  if (!isNameStart(value.charCodeAt(1))) return false;
  for (let index = 2; index < value.length; index++) {
    if (!isNameCharacter(value.charCodeAt(index))) return false;
  }
  return true;
}

function safeLocalUrlFunction(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 7 || trimmed.slice(0, 4).toLowerCase() !== "url(") {
    return false;
  }
  if (trimmed[trimmed.length - 1] !== ")") return false;
  let reference = trimmed.slice(4, -1).trim();
  const quote = reference[0];
  if (quote === '"' || quote === "'") {
    if (reference.length < 3 || reference[reference.length - 1] !== quote) {
      return false;
    }
    reference = reference.slice(1, -1).trim();
  }
  return safeFragment(reference);
}

function hasUrlToken(value: string): boolean {
  return value.toLowerCase().includes("url");
}

function safeUrlBearingPresentationValue(value: string): boolean {
  if (hasUrlToken(value)) return safeLocalUrlFunction(value);

  // Presentation attributes use CSS value parsing. Limit non-url paint and
  // effect values to a small token alphabet so CSS escapes/comments cannot
  // disguise a `url(...)` fetch (for example `u\\72l(...)` or `u/**/rl(...)`).
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      isAsciiLetter(code) || isAsciiDigit(code) || isXmlWhitespace(code) ||
      character === "#" || character === "." || character === "%" ||
      character === "," || character === "+" || character === "-" ||
      character === "(" || character === ")" || character === "/"
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function safeHref(value: string): string | null {
  const trimmed = value.trim();
  return safeFragment(trimmed) ? trimmed : null;
}

function sanitizeElement(node: XmlElement, isRoot = false): string {
  const local = localName(node.name);
  const canonicalElement = SAFE_ELEMENTS.get(local);
  if (isRoot && canonicalElement !== "svg") {
    throw new Error("root element must be SVG");
  }
  if (!canonicalElement) return "";

  const attributes: string[] = [];
  const emitted = new Set<string>();
  if (isRoot) {
    attributes.push('xmlns="http://www.w3.org/2000/svg"');
    emitted.add("xmlns");
  }

  for (const attribute of node.attributes) {
    const rawLocal = localName(attribute.name);
    if (rawLocal.startsWith("on") || rawLocal === "style") continue;
    if (rawLocal === "xmlns") continue;

    let canonicalAttribute: string | undefined;
    const value = attribute.value;
    if (rawLocal === "href") {
      canonicalAttribute = "href";
      if (emitted.has(canonicalAttribute)) {
        throw new Error(`duplicate sanitized attribute: ${canonicalAttribute}`);
      }
      emitted.add(canonicalAttribute);
      const sanitizedHref = safeHref(value);
      if (!sanitizedHref) continue;
      attributes.push(
        `${canonicalAttribute}="${escapeAttribute(sanitizedHref)}"`,
      );
      continue;
    } else {
      canonicalAttribute = SAFE_ATTRIBUTES.get(
        attribute.name.toLowerCase(),
      );
      if (
        !canonicalAttribute ||
        (attribute.name.includes(":") && canonicalAttribute !== "xml:space")
      ) {
        continue;
      }
      if (
        LOCAL_URL_ATTRIBUTES.has(canonicalAttribute) &&
        !safeUrlBearingPresentationValue(value)
      ) {
        continue;
      }
    }
    if (emitted.has(canonicalAttribute)) {
      throw new Error(`duplicate sanitized attribute: ${canonicalAttribute}`);
    }
    emitted.add(canonicalAttribute);
    attributes.push(`${canonicalAttribute}="${escapeAttribute(value)}"`);
  }

  const opening = attributes.length > 0
    ? `<${canonicalElement} ${attributes.join(" ")}>`
    : `<${canonicalElement}>`;
  let children = "";
  for (const child of node.children) {
    children += typeof child === "string"
      ? escapeText(child)
      : sanitizeElement(child);
  }
  return `${opening}${children}</${canonicalElement}>`;
}

function escapeAttribute(value: string): string {
  let result = "";
  for (const character of value) {
    if (character === "&") result += "&amp;";
    else if (character === '"') result += "&quot;";
    else if (character === "<") result += "&lt;";
    else if (character === ">") result += "&gt;";
    else result += character;
  }
  return result;
}

function escapeText(value: string): string {
  let result = "";
  for (const character of value) {
    if (character === "&") result += "&amp;";
    else if (character === "<") result += "&lt;";
    else if (character === ">") result += "&gt;";
    else result += character;
  }
  return result;
}

function sanitizeSvgText(input: string): string {
  const root = new BoundedXmlParser(input).parse();
  return sanitizeElement(root, true).trim();
}

function assertDocumentSize(byteLength: number): void {
  if (byteLength > MAX_SVG_DOCUMENT_BYTES) {
    throw new Error("SVG exceeds the 200 KB limit");
  }
}

/** Parse and serialise a non-active SVG. Throws for malformed/non-SVG XML. */
export function sanitizeSvg(input: string): string {
  const encoder = new TextEncoder();
  assertDocumentSize(encoder.encode(input).byteLength);
  const cleaned = sanitizeSvgText(input);
  assertDocumentSize(encoder.encode(cleaned).byteLength);
  return cleaned;
}

/** Decode, sanitise, and re-encode uploaded SVG bytes. */
export function sanitizeSvgBytes(bytes: Uint8Array): Uint8Array {
  assertDocumentSize(bytes.byteLength);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const cleaned = new TextEncoder().encode(sanitizeSvgText(text));
  assertDocumentSize(cleaned.byteLength);
  return cleaned;
}
