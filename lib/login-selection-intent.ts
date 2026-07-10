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
  did: string;
  client_id: string;
  return_uri: string;
  state: string;
  scope?: string;
  iat: number;
  exp: number;
  nonce: string;
}

export async function createLoginSelectionIntent(
  request: LoginRequest,
  did: string,
  options: { now?: number; secret?: string } = {},
): Promise<string> {
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const payload: SelectionIntentPayload = {
    v: INTENT_VERSION,
    did,
    client_id: request.clientId,
    return_uri: request.returnUri,
    state: request.state,
    ...(request.scope ? { scope: request.scope } : {}),
    iat: now,
    exp: now + INTENT_TTL_SEC,
    nonce: randomB64u(12),
  };
  const encoded = b64uEncode(JSON.stringify(payload));
  const signature = await hmacSign(options.secret ?? sessionSecret(), encoded);
  return `${encoded}.${signature}`;
}

export async function verifyLoginSelectionIntent(
  token: string,
  request: LoginRequest,
  did: string,
  options: { now?: number; secret?: string } = {},
): Promise<boolean> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const validSignature = await hmacVerify(
    options.secret ?? sessionSecret(),
    encoded,
    signature,
  ).catch(() => false);
  if (!validSignature) return false;

  let payload: SelectionIntentPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(b64uDecode(encoded)),
    ) as SelectionIntentPayload;
  } catch {
    return false;
  }

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  return payload.v === INTENT_VERSION &&
    payload.did === did && did.startsWith("did:") &&
    payload.client_id === request.clientId &&
    payload.return_uri === request.returnUri &&
    payload.state === request.state &&
    (payload.scope ?? null) === (request.scope ?? null) &&
    Number.isInteger(payload.iat) && payload.iat <= now + 30 &&
    Number.isInteger(payload.exp) && payload.exp >= now &&
    payload.exp - payload.iat <= INTENT_TTL_SEC &&
    typeof payload.nonce === "string" && payload.nonce.length >= 12;
}
