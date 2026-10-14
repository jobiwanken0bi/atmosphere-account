import { useEffect, useState } from "preact/hooks";
import { useLocale, useT } from "../i18n/mod.ts";
import {
  ACCOUNT_COUNT_REFRESH_MS,
  type AccountCountSnapshot,
  isAccountCountSnapshot,
} from "../lib/atmosphere-account-count.ts";

const STORAGE_KEY = "atmosphere-account-count-v1";

export default function JoinAtmosphere(
  { initialSnapshot }: { initialSnapshot: AccountCountSnapshot | null },
) {
  const t = useT().join;
  const locale = useLocale();
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    const controller = new AbortController();
    let current = initialSnapshot;
    let busy = false;

    const accept = (value: unknown) => {
      if (
        controller.signal.aborted || !isAccountCountSnapshot(value) ||
        (current && Date.parse(value.updatedAt) < Date.parse(current.updatedAt))
      ) return;
      current = value;
      setSnapshot(value);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch { /* Storage is optional. */ }
    };

    try {
      accept(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
    } catch {
      /* Keep the server-rendered count when storage is unavailable. */
    }

    async function refresh() {
      if (document.hidden || busy || controller.signal.aborted) {
        return;
      }
      busy = true;
      try {
        const response = await fetch("/api/atmosphere-accounts", {
          credentials: "omit",
          headers: { Accept: "application/json" },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(5_000),
          ]),
        });
        if (response.ok && !controller.signal.aborted) {
          accept(await response.json());
        }
      } catch {
        /* Retain the last verified count through tracker outages. */
      } finally {
        busy = false;
      }
    }

    if (
      !current ||
      Date.now() - Date.parse(current.checkedAt) >= ACCOUNT_COUNT_REFRESH_MS
    ) void refresh();
    const timer = setInterval(refresh, ACCOUNT_COUNT_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [initialSnapshot]);

  return (
    <section class="landing-join" aria-labelledby="landing-join-heading">
      <div class="container landing-join-inner">
        <h2 id="landing-join-heading" class="landing-join-heading">
          {snapshot
            ? (
              <>
                <span class="landing-join-lead">{t.lead}</span>{" "}
                <a
                  class="landing-join-count"
                  href="https://bsky.jazco.dev/stats"
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t.countSource}
                >
                  {snapshot.count.toLocaleString(locale)}
                </a>{" "}
                <span class="landing-join-tail">{t.tail}</span>
              </>
            )
            : <span class="landing-join-fallback">{t.fallback}</span>}
        </h2>
        <a
          class="explore-cta-primary landing-join-button"
          href="/signin?mode=create&next=%2Fapps"
        >
          {t.createAccount}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 12h15m-6-6 6 6-6 6" />
          </svg>
        </a>
      </div>
    </section>
  );
}
