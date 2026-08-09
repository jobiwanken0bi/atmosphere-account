import {
  generateEs256KeyPair,
  hmacVerify,
  parseJwkEnv,
  publicJwkOnly,
  signEs256,
  verifyEs256,
} from "./jose.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("HMAC verification fails closed for malformed signatures", async () => {
  assertEquals(await hmacVerify("secret", "payload", "%%%"), false);
});

Deno.test("public JWK projection never exposes private key material", () => {
  const projected = publicJwkOnly(
    {
      kty: "EC",
      crv: "P-256",
      x: "x-coordinate",
      y: "y-coordinate",
      d: "private-scalar",
      kid: "key-id",
      alg: "ES256",
      use: "sig",
      key_ops: ["sign"],
    } as JsonWebKey & { kid: string },
  );
  assertEquals(projected.d, undefined);
  assertEquals(projected.key_ops, undefined);
  assertEquals(projected.kid, "key-id");
  assertEquals(projected.alg, "ES256");
  assertEquals(projected.use, "sig");
});

Deno.test("ES256 verification fails closed for malformed signatures", async () => {
  const keyPair = await generateEs256KeyPair();
  const token = await signEs256({
    header: { typ: "JWT" },
    payload: { sub: "did:plc:example" },
    privateKey: keyPair.privateKey,
  });
  const [header, payload] = token.split(".");
  const malformed = `${header}.${payload}.%%%`;

  assertEquals(await verifyEs256(malformed, keyPair.publicJwk), null);
});

Deno.test("JWK configuration errors do not echo private key material", () => {
  const privateMaterial = "private-key-material-that-must-not-be-logged";
  let message = "";
  try {
    parseJwkEnv("OAUTH_PRIVATE_JWK", privateMaterial);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!message || message.includes(privateMaterial.slice(0, 12))) {
    throw new Error("expected a redacted JWK configuration error");
  }
});
