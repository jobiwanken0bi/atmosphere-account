# Next.js Atmosphere Login example

This is the minimal App Router shape for a relying app. Atmosphere chooses an
account; the Next.js server verifies the signed choice and starts the app's own
AT Protocol OAuth flow.

## Button (`app/page.tsx`)

```tsx
"use client";

import Script from "next/script";

export default function Page() {
  return (
    <>
      <button
        data-atmosphere-login
        data-client-id="https://app.example/oauth/client-metadata.json"
        data-return-uri="https://app.example/api/atmosphere/callback"
        data-scope="atproto"
        data-app-name="Example app"
        data-app-homepage="https://app.example"
      />
      <Script src="https://login.atmosphereaccount.com/atmosphere-login.js" />
    </>
  );
}
```

## Server callback (`app/api/atmosphere/callback/route.ts`)

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  verifyAtmosphereLoginCallback,
} from "https://login.atmosphereaccount.com/atmosphere-login-server.js";

export async function GET(request: NextRequest) {
  const verified = await verifyAtmosphereLoginCallback({
    url: request.url,
    expectedIssuer: "https://login.atmosphereaccount.com",
    expectedClientId: "https://app.example/oauth/client-metadata.json",
    expectedReturnUri: "https://app.example/api/atmosphere/callback",
    // Supply a durable replayStore in production.
  });
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }
  const oauth = new URL("/api/oauth/start", request.url);
  oauth.searchParams.set(
    "login_hint",
    verified.claims.handle || verified.claims.sub,
  );
  return NextResponse.redirect(oauth);
}
```

The `/api/oauth/start` handler belongs to the relying app. It must create the
app's own AT Protocol OAuth request; Atmosphere never receives or brokers the
resulting app token.
