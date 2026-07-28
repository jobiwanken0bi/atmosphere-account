import { IS_DEV, sessionSecret } from "./env.ts";
import {
  b64uDecode,
  b64uEncode,
  hmacSign,
  hmacVerify,
  randomB64u,
} from "./jose.ts";

const DEV_COOKIE_NAME = "atmo_passkey_manage";
const PROD_COOKIE_NAME = "__Host-atmo_passkey_manage";
const TICKET_TTL_MS = 10 * 60 * 1000;

interface PasskeyManagementTicket {
  did: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

function cookieName(): string {
  return IS_DEV ? DEV_COOKIE_NAME : PROD_COOKIE_NAME;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const cookie = part.trim();
    if (!cookie.startsWith(`${name}=`)) continue;
    try {
      return decodeURIComponent(cookie.slice(name.length + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function encodeTicket(ticket: PasskeyManagementTicket): string {
  return b64uEncode(JSON.stringify(ticket));
}

function decodeTicket(payload: string): PasskeyManagementTicket | null {
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(b64uDecode(payload)),
    ) as Partial<PasskeyManagementTicket>;
    if (
      typeof parsed.did !== "string" || !parsed.did.startsWith("did:") ||
      typeof parsed.issuedAt !== "number" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.nonce !== "string" || parsed.nonce.length < 16
    ) return null;
    return parsed as PasskeyManagementTicket;
  } catch {
    return null;
  }
}

export async function buildPasskeyManagementCookie(
  did: string,
  now = Date.now(),
): Promise<string> {
  if (!did.startsWith("did:")) throw new Error("invalid passkey ticket DID");
  const payload = encodeTicket({
    did,
    issuedAt: now,
    expiresAt: now + TICKET_TTL_MS,
    nonce: randomB64u(18),
  });
  const signature = await hmacSign(sessionSecret(), payload);
  const flags = [
    "Path=/",
    `Max-Age=${Math.floor(TICKET_TTL_MS / 1000)}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (!IS_DEV) flags.push("Secure");
  return `${cookieName()}=${encodeURIComponent(`${payload}.${signature}`)}; ${
    flags.join("; ")
  }`;
}

export function clearPasskeyManagementCookie(): string {
  const flags = ["Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict"];
  if (!IS_DEV) flags.push("Secure");
  return `${cookieName()}=; ${flags.join("; ")}`;
}

export async function readPasskeyManagementTicket(
  req: Request,
  now = Date.now(),
): Promise<PasskeyManagementTicket | null> {
  const raw = readCookie(req, cookieName());
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!signature || !await hmacVerify(sessionSecret(), payload, signature)) {
    return null;
  }
  const ticket = decodeTicket(payload);
  if (!ticket || ticket.expiresAt < now || ticket.issuedAt > now + 30_000) {
    return null;
  }
  return ticket;
}

export function isPasskeyManagementReturnTo(
  returnTo: string | null | undefined,
): boolean {
  if (!returnTo) return false;
  try {
    const url = new URL(returnTo, "https://login.invalid");
    return url.origin === "https://login.invalid" &&
      (url.pathname === "/passkeys" || url.pathname === "/passkeys/");
  } catch {
    return false;
  }
}

export function passkeyManagementTicketTtlMsForTest(): number {
  return TICKET_TTL_MS;
}
