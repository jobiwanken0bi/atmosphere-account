import {
  classifyProfilePdsFailure,
  profilePdsFailureResponse,
  retryTransientProfileRead,
} from "./profile-pds-resilience.ts";
import {
  PdsBlobUploadError,
  PdsRecordReadError,
  PdsRecordWriteError,
} from "./pds.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("profile PDS failures distinguish reconnect, throttling, and uncertain writes", () => {
  const scope = classifyProfilePdsFailure(
    new PdsRecordWriteError(
      "putRecord",
      403,
      JSON.stringify({ error: "ScopeMissingError" }),
    ),
    "write",
  );
  assertEquals(scope.code, "reconnect_required");
  assertEquals(scope.status, 409);
  assertEquals(scope.retryable, false);

  const throttled = classifyProfilePdsFailure(
    new PdsBlobUploadError(429, "busy", "17"),
    "avatar",
  );
  assertEquals(throttled.code, "rate_limited");
  assertEquals(throttled.retryAfter, "17");

  const uncertain = classifyProfilePdsFailure(
    new TypeError("connection closed"),
    "write",
  );
  assertEquals(uncertain.code, "upstream_unavailable");
  assertEquals(uncertain.retryable, false);
  assertEquals(uncertain.outcomeUncertain, true);

  const upstreamWrite = classifyProfilePdsFailure(
    new PdsRecordWriteError("putRecord", 500, "upstream failed"),
    "write",
  );
  assertEquals(upstreamWrite.code, "upstream_unavailable");
  assertEquals(upstreamWrite.outcomeUncertain, true);
});

Deno.test("transient profile reads retry once but rejected reads do not", async () => {
  let calls = 0;
  let waits = 0;
  const value = await retryTransientProfileRead(
    () => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new PdsRecordReadError(503, "unavailable"));
      }
      return Promise.resolve("profile");
    },
    {
      wait: () => {
        waits += 1;
        return Promise.resolve();
      },
    },
  );
  assertEquals(value, "profile");
  assertEquals(calls, 2);
  assertEquals(waits, 1);

  calls = 0;
  await retryTransientProfileRead(() => {
    calls += 1;
    return Promise.reject(new PdsRecordReadError(400, "bad request"));
  }, { wait: () => Promise.resolve() }).then(
    () => {
      throw new Error("rejected reads must not be retried");
    },
    () => undefined,
  );
  assertEquals(calls, 1);

  calls = 0;
  await retryTransientProfileRead(() => {
    calls += 1;
    return Promise.reject(new PdsRecordReadError(429, "busy", "30"));
  }, { wait: () => Promise.resolve() }).then(
    () => {
      throw new Error("rate-limited reads must honor Retry-After");
    },
    () => undefined,
  );
  assertEquals(calls, 1);

  calls = 0;
  await retryTransientProfileRead(() => {
    calls += 1;
    return Promise.reject(
      new PdsRecordReadError(503, "maintenance", "30"),
    );
  }, { wait: () => Promise.resolve() }).then(
    () => {
      throw new Error("5xx reads with Retry-After must not be retried early");
    },
    () => undefined,
  );
  assertEquals(calls, 1);
});

Deno.test("profile PDS responses preserve safe retry hints without leaking upstream bodies", async () => {
  const logLines: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => {
    logLines.push(values.map(String).join(" "));
  };
  try {
    const privateDetail = "OAuth_PRIVATE_JWK=private-upstream-detail";
    const response = profilePdsFailureResponse(
      "read",
      new PdsRecordReadError(429, privateDetail, "9"),
    );
    assertEquals(response.status, 503);
    assertEquals(response.headers.get("retry-after"), "9");
    assertEquals(
      response.headers.get("x-atmosphere-error-code"),
      "rate_limited",
    );
    assertEquals((await response.text()).includes(privateDetail), false);
    assertEquals(logLines.length, 1);
    assertEquals(logLines[0], "[profile] PDS request failed");
    assertEquals(logLines[0].includes(privateDetail), false);
  } finally {
    console.warn = originalWarn;
  }
});
