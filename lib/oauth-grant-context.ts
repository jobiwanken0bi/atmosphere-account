import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-local ownership for OAuth grants. Keeping this separate from the
 * account DID prevents two browsers signed into the same account from sharing
 * a refresh token or DPoP key.
 */
export interface OAuthGrantContext {
  appSessionId: string;
  grantId: string | null;
}

const storage = new AsyncLocalStorage<OAuthGrantContext>();

export function currentOAuthGrantContext(): OAuthGrantContext | null {
  return storage.getStore() ?? null;
}

export function withOAuthGrantContext<T>(
  context: OAuthGrantContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}
