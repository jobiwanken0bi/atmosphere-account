import { renderSvgPng } from "./image-processing.ts";

export const HOST_SOCIAL_CARD_WIDTH = 1200;
export const HOST_SOCIAL_CARD_HEIGHT = 630;

export interface HostSocialCardInput {
  name: string;
  handle?: string | null;
  domain: string;
  avatarDataUrl?: string | null;
  handleIconDataUrl?: string | null;
}

let atmosphereHandleIconPromise: Promise<string | null> | null = null;

/** Reuse the site glyph rather than substituting a typographic `@`. */
export function loadAtmosphereHandleIconDataUrl(): Promise<string | null> {
  atmosphereHandleIconPromise ??= Deno.readTextFile("static/union.svg")
    .then((svg) => {
      const recolored = svg.replace('fill="white"', 'fill="#46516c"');
      return `data:image/svg+xml;base64,${
        new TextEncoder().encode(recolored).toBase64()
      }`;
    })
    .catch(() => null);
  return atmosphereHandleIconPromise;
}

/** Build the same sky-and-glass-cloud visual language as the static OG cards. */
export function buildHostSocialCardSvg(input: HostSocialCardInput): string {
  const name = normalizedName(input.name);
  const lines = titleLines(name);
  const fontSize = titleFontSize(lines);
  const handle = normalizedIdentity(input.handle, 48)?.replace(/^@+/, "");
  const domain = normalizedIdentity(input.domain, 64) ?? "Account host";
  const titleY = lines.length === 1 ? 326 : 288;
  const identityY = lines.length === 1 ? 390 : 424;
  const titleLinesMarkup = lines.map((line, index) =>
    `<tspan x="450" dy="${index === 0 ? 0 : 72}">${escapeXml(line)}</tspan>`
  ).join("");
  const titleMarkup = lines.length === 1
    ? `<text x="450" y="${titleY}" class="title" font-size="${fontSize}">${
      escapeXml(lines[0])
    }</text>`
    : `<text x="450" y="${titleY}" class="title" font-size="${fontSize}">${titleLinesMarkup}</text>`;
  const handleIcon = handle && input.handleIconDataUrl
    ? `<image x="450" y="${identityY - 21}" width="22" height="22" href="${
      escapeXml(input.handleIconDataUrl)
    }"/>`
    : "";
  const handleTextX = handleIcon ? 480 : 450;
  const identityMarkup = handle
    ? `${handleIcon}
       <text x="${handleTextX}" y="${identityY}" class="handle">${
      escapeXml(handle)
    }</text>
       <text x="450" y="${identityY + 42}" class="domain">${
      escapeXml(domain)
    }</text>`
    : `<text x="450" y="${identityY}" class="domain">${
      escapeXml(domain)
    }</text>`;
  const avatar = input.avatarDataUrl
    ? `<image x="100" y="178" width="280" height="280" href="${
      escapeXml(input.avatarDataUrl)
    }" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
    : `<rect x="100" y="178" width="280" height="280" rx="58" fill="url(#avatarFallback)"/>
       <text x="240" y="363" text-anchor="middle" class="initial">${
      escapeXml(name.slice(0, 1).toUpperCase())
    }</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sky" x1="600" y1="0" x2="600" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="#e8f0fe"/>
      <stop offset=".25" stop-color="#c9d8f5"/>
      <stop offset=".5" stop-color="#a8c4f0"/>
      <stop offset=".75" stop-color="#c0d4f5"/>
      <stop offset="1" stop-color="#ebe4f5"/>
    </linearGradient>
    <radialGradient id="sun" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(620 120) rotate(90) scale(520 340)">
      <stop stop-color="#fff6d8" stop-opacity=".95"/>
      <stop offset=".35" stop-color="#ffe8b8" stop-opacity=".55"/>
      <stop offset=".7" stop-color="#ffd8a0" stop-opacity=".18"/>
      <stop offset="1" stop-color="#ffd8a0" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="avatarFallback" x1="100" y1="178" x2="380" y2="458" gradientUnits="userSpaceOnUse">
      <stop stop-color="#536f9f"/>
      <stop offset="1" stop-color="#8397bd"/>
    </linearGradient>
    <linearGradient id="cloudFill" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#79cfff" stop-opacity=".24"/>
      <stop offset="1" stop-color="#79cfff" stop-opacity=".12"/>
    </linearGradient>
    <filter id="cloudGlow" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="avatarShadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#121a2f" flood-opacity=".18"/>
    </filter>
    <clipPath id="avatarClip"><rect x="100" y="178" width="280" height="280" rx="58"/></clipPath>
    <path id="cloud" d="M430 324C493 324 545 280 545 225C545 172 498 129 439 127C424 88 383 60 334 60C327 60 320 61 313 62C297 26 257 0 210 0C148 0 98 44 98 99C98 108 100 118 103 127C45 131 0 173 0 225C0 280 50 324 111 324H430Z"/>
    <style>
      .eyebrow { fill: rgba(18,26,47,.7); font: 650 25px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; letter-spacing: .16em; }
      .title { fill: #0e1428; font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-weight: 650; letter-spacing: -.035em; }
      .handle { fill: rgba(18,26,47,.78); font: 550 27px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
      .domain { fill: rgba(18,26,47,.62); font: 450 24px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
      .initial { fill: #f6f8ff; font: 700 126px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
    </style>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <rect width="1200" height="630" fill="url(#sun)"/>
  <g fill="url(#cloudFill)" stroke="#e9feff" stroke-opacity=".68" stroke-width="4" filter="url(#cloudGlow)">
    <use href="#cloud" transform="translate(-85 -30) scale(.42)"/>
    <use href="#cloud" transform="translate(840 55) scale(.28)"/>
    <use href="#cloud" transform="translate(800 365) scale(.38)"/>
    <use href="#cloud" transform="translate(365 475) scale(.27)"/>
  </g>
  <g filter="url(#avatarShadow)">
    <rect x="92" y="170" width="296" height="296" rx="66" fill="rgba(255,255,255,.36)" stroke="rgba(255,255,255,.72)" stroke-width="2"/>
    ${avatar}
  </g>
  <text x="450" y="215" class="eyebrow">ATMOSPHERE ACCOUNT HOST</text>
  ${titleMarkup}
  ${identityMarkup}
</svg>`;
}

export async function renderHostSocialCardPng(
  input: HostSocialCardInput,
): Promise<Uint8Array> {
  return await renderSvgPng(buildHostSocialCardSvg(input));
}

function normalizedName(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").slice(0, 80) || "Account host";
}

function normalizedIdentity(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = value?.trim().replaceAll(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
    : normalized;
}

function titleLines(value: string): string[] {
  if (value.length <= 20) return [value];
  const naturalBreak = value.lastIndexOf(" ", 20);
  const breakAt = naturalBreak >= 8 ? naturalBreak : 20;
  const first = value.slice(0, breakAt).trim();
  const remainder = value.slice(breakAt).trim();
  const second = remainder.length > 23
    ? `${remainder.slice(0, 22).trimEnd()}…`
    : remainder;
  return [first, second];
}

function titleFontSize(lines: string[]): number {
  const longest = Math.max(...lines.map((line) => line.length));
  return longest <= 12 ? 76 : longest <= 18 ? 64 : 54;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
