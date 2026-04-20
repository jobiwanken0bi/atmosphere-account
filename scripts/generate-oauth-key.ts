/**
 * Generate an ES256 (P-256) keypair as JWKs for the atproto OAuth
 * confidential client. Prints two env-var assignments:
 *   - OAUTH_PRIVATE_JWK  (set in production secrets; never check in)
 *   - OAUTH_PUBLIC_JWK   (used by /oauth/jwks.json)
 *
 * Usage:
 *   deno run --allow-read --allow-env scripts/generate-oauth-key.ts
 */
const KEY_USE_SIG = "sig";
const ALG = "ES256";

function bufToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

async function main(): Promise<void> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  const kid = bufToBase64Url(crypto.getRandomValues(new Uint8Array(8)).buffer)
    .slice(0, 12);

  const enrich = (jwk: JsonWebKey): JsonWebKey =>
    ({
      ...jwk,
      use: KEY_USE_SIG,
      alg: ALG,
      kid,
    }) as JsonWebKey;

  const priv = enrich(privateJwk);
  const pub = enrich(publicJwk);

  console.log("# Add the following to your environment (.env.local for dev,");
  console.log("# Deno Deploy project secrets for production).");
  console.log("# DO NOT commit OAUTH_PRIVATE_JWK to source control.\n");
  console.log(`OAUTH_PRIVATE_JWK='${JSON.stringify(priv)}'`);
  console.log(`OAUTH_PUBLIC_JWK='${JSON.stringify(pub)}'`);
  console.log(`OAUTH_KID='${kid}'`);
  console.log();
  console.log(
    "# Optional: a 32+ byte random string for signing session cookies.",
  );
  const secret = bufToBase64Url(
    crypto.getRandomValues(new Uint8Array(32)).buffer,
  );
  console.log(`SESSION_SECRET='${secret}'`);
}

if (import.meta.main) {
  await main();
}
