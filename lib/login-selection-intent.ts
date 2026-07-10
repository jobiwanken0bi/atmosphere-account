import type { LoginRequest } from "./atmosphere-login.ts";
import { sessionSecret } from "./env.ts";
import {
  b64uDecode,
  b64uEncode,
  hmacSign,
  hmacVerify,
  randomB64u,
} from "./jose.ts";

const INTENT_VERSION = 1;
const INTENT_TTL_SEC = 5 * 60;

interface SelectionIntentPayload {
  v: number;
  d: string;
  c: string;
  r: string;
  s: string;
  o?: string;
  i: number;
  e: number;
  n: string;
}

export async function createLoginSelectionIntent(
  request: LoginRequest,
  did: string,
  options: { now?: number; secret?: string } = {},
): Promise<string> {
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const payload: SelectionIntentPayload = {
    v: INTENT_VERSION,
    d: did,
    c: request.clientId,
    r: request.returnUri,
    s: request.state,
    ...(request.scope ? { o: request.scope } : {}),
    i: now,
    e: now + INTENT_TTL_SEC,
    n: randomB64u(9),
  };
  const encoded = b64uEncode(JSON.stringify(payload));
  const signature = await hmacSign(options.secret ?? sessionSecret(), encoded);
  return `${encoded}.${signature}`;
}

export async function readLoginSelectionIntent(
  token: string,
  options: { now?: number; secret?: string } = {},
): Promise<{ request: LoginRequest; did: string } | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const validSignature = await hmacVerify(
    options.secret ?? sessionSecret(),
    encoded,
    signature,
  ).catch(() => false);
  if (!validSignature) return null;

  let payload: SelectionIntentPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(b64uDecode(encoded)),
    ) as SelectionIntentPayload;
  } catch {
    return null;
  }

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const valid = payload.v === INTENT_VERSION &&
    typeof payload.d === "string" && payload.d.startsWith("did:") &&
    typeof payload.c === "string" && payload.c.length > 0 &&
    typeof payload.r === "string" && payload.r.length > 0 &&
    typeof payload.s === "string" && payload.s.length > 0 &&
    (payload.o === undefined || typeof payload.o === "string") &&
    Number.isInteger(payload.i) && payload.i <= now + 30 &&
    Number.isInteger(payload.e) && payload.e >= now &&
    payload.e - payload.i <= INTENT_TTL_SEC &&
    typeof payload.n === "string" && payload.n.length >= 12;
  if (!valid) return null;
  return {
    did: payload.d,
    request: {
      clientId: payload.c,
      returnUri: payload.r,
      state: payload.s,
      scope: payload.o ?? null,
    },
  };
}
