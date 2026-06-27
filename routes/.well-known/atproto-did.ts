import { define } from "../../utils.ts";
import { ATMOSPHERE_DID } from "../../lib/env.ts";

const ATMOSPHERE_ACCOUNT_DID = "did:plc:ab7uvkn4kyf7l7prl26pz4r2";

export const handler = define.handlers({
  GET(): Response {
    return new Response(ATMOSPHERE_DID || ATMOSPHERE_ACCOUNT_DID, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  },
});
