import {
  collectionBrowsePrefix,
  normalizeCollectionSearchQuery,
  parseLexiconGardenAutocomplete,
  parseLexiconGardenBrowse,
  queryLexiconGarden,
  searchPublishedCollections,
} from "./published-collection-catalog.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, got ${left}`);
}

Deno.test("published collection search validates bounded NSID fragments", () => {
  assertEquals(normalizeCollectionSearchQuery(" calendar "), "calendar");
  assertEquals(
    normalizeCollectionSearchQuery("app.bsky.feed"),
    "app.bsky.feed",
  );
  assertEquals(normalizeCollectionSearchQuery("*"), null);
  assertEquals(normalizeCollectionSearchQuery("a"), null);
  assertEquals(normalizeCollectionSearchQuery("calendar?type=query"), null);
});

Deno.test("published collection search derives a segment-aligned fallback", () => {
  assertEquals(
    collectionBrowsePrefix("community.lexicon.cal"),
    "community.lexicon",
  );
  assertEquals(
    collectionBrowsePrefix("community.lexicon.calendar."),
    "community.lexicon.calendar",
  );
  assertEquals(collectionBrowsePrefix("calendar"), "calendar");
});

Deno.test("published collection search sanitizes autocomplete results", () => {
  const parsed = parseLexiconGardenAutocomplete({
    suggestions: [
      {
        type: "nsid",
        label: "community.lexicon.calendar.eventParticipation",
        did: "did:plc:example",
        url:
          "/lexicon/did:plc:example/community.lexicon.calendar.eventParticipation",
      },
      {
        type: "nsid",
        label: "community.lexicon.calendar.eventParticipation",
        url: "https://attacker.example/",
      },
      { type: "handle", label: "calendar.example" },
      { type: "nsid", label: "com.example.invalid-name" },
      null,
    ],
  });
  assertEquals(
    parsed?.map((item) => ({
      id: item.id,
      label: item.label,
      published: item.published,
      catalogUrl: item.catalogUrl,
    })),
    [{
      id: "community.lexicon.calendar.eventParticipation",
      label: "Event Participation",
      published: true,
      catalogUrl:
        "https://lexicon.garden/lexicon/did:plc:example/community.lexicon.calendar.eventParticipation",
    }],
  );
});

Deno.test("published collection search sanitizes and caps browse results", () => {
  const parsed = parseLexiconGardenBrowse({
    lexicons: [
      "community.lexicon.calendar.event",
      "community.lexicon.calendar.event",
      "community.lexicon.calendar.rsvp",
      "not-an-nsid",
    ],
  }, 1);
  assertEquals(parsed?.map((item) => item.id), [
    "community.lexicon.calendar.event",
  ]);
  assertEquals(
    parseLexiconGardenBrowse({
      lexicons: [
        "community.lexicon.calendar.event",
      ],
    }, 0),
    [],
  );
});

Deno.test("published collection search preserves case-sensitive names", () => {
  const parsed = parseLexiconGardenAutocomplete({
    suggestions: [
      { type: "nsid", label: "com.example.fooBar" },
      { type: "nsid", label: "com.example.foobar" },
    ],
  });
  assertEquals(parsed?.map((item) => item.id), [
    "com.example.fooBar",
    "com.example.foobar",
  ]);
});

Deno.test("published collection search uses record-only autocomplete", async () => {
  let requestedUrl = "";
  const fetcher = ((input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          suggestions: [{
            type: "nsid",
            label: "community.lexicon.calendar.event",
            url: "/lexicon/example/event",
          }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  }) as typeof fetch;

  const result = await queryLexiconGarden("calendar", fetcher);
  assertEquals(result.unavailable, false);
  assertEquals(result.suggestions.map((item) => item.id), [
    "community.lexicon.calendar.event",
  ]);
  const url = new URL(requestedUrl);
  assertEquals(url.pathname, "/api/autocomplete-nsid");
  assertEquals(url.searchParams.get("type"), "record");
});

Deno.test("published collection search falls back to documented browsing", async () => {
  const requestedUrls: string[] = [];
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);
    if (requestedUrls.length === 1) {
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          lexicons: ["community.lexicon.calendar.rsvp"],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  }) as typeof fetch;

  const result = await queryLexiconGarden(
    "community.lexicon.cal",
    fetcher,
  );
  assertEquals(result.unavailable, false);
  assertEquals(result.suggestions.map((item) => item.id), [
    "community.lexicon.calendar.rsvp",
  ]);
  const fallbackUrl = new URL(requestedUrls[1]);
  assertEquals(fallbackUrl.pathname, "/xrpc/garden.lexicon.browse");
  assertEquals(fallbackUrl.searchParams.get("prefix"), "community.lexicon");
  assertEquals(fallbackUrl.searchParams.get("lexiconType"), "record");
});

Deno.test("published browse fallback filters before applying the result cap", async () => {
  let requestCount = 0;
  const fetcher = (() => {
    requestCount++;
    if (requestCount === 1) {
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          lexicons: [
            ...Array.from(
              { length: 25 },
              (_, index) => `ai.example.record${index}`,
            ),
            "app.bsky.feed.post",
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  }) as typeof fetch;

  const result = await queryLexiconGarden("app.bsky", fetcher);
  assertEquals(result.suggestions.map((item) => item.id), [
    "app.bsky.feed.post",
  ]);
});

Deno.test("published search cache keeps case-sensitive queries separate", async () => {
  let requestCount = 0;
  const fetcher = (() => {
    requestCount++;
    return Promise.resolve(
      new Response(JSON.stringify({ suggestions: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;

  await searchPublishedCollections("fooBar", { fetcher, now: 123_456 });
  await searchPublishedCollections("foobar", { fetcher, now: 123_456 });
  assertEquals(requestCount, 2);
});

Deno.test("published collection search rejects redirects and non-JSON bodies", async () => {
  const redirects: Array<RequestRedirect | undefined> = [];
  let calls = 0;
  const result = await queryLexiconGarden(
    "app.bsky",
    ((_input, init) => {
      redirects.push(init?.redirect);
      calls++;
      return Promise.resolve(
        calls === 1
          ? new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1/private" },
          })
          : new Response('{"lexicons":[]}', {
            headers: { "content-type": "text/html" },
          }),
      );
    }) as typeof fetch,
  );

  assertEquals(redirects, ["error", "error"]);
  assertEquals(result, { suggestions: [], unavailable: true });
});
