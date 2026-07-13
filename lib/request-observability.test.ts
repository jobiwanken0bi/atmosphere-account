import { recordSlowRequestLog } from "./request-observability.ts";

Deno.test("slow request logging rate-limits repeated path/status classes", () => {
  const state = new Map<string, { lastLoggedAt: number; suppressed: number }>();
  const first = recordSlowRequestLog({ key: "GET /blob 2xx", now: 1, state });
  const second = recordSlowRequestLog({ key: "GET /blob 2xx", now: 2, state });
  const third = recordSlowRequestLog({
    key: "GET /blob 2xx",
    now: 62_000,
    state,
  });
  if (!first.log || second.log || !third.log || third.suppressed !== 1) {
    throw new Error("slow request log gate did not aggregate repeated events");
  }
});
