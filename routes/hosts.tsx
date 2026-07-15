import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";
import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import HostMark from "../components/hosts/HostMark.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import type {
  AccountHost,
  AccountHostDirectoryOptions,
  AccountHostDirectoryResult,
  AccountHostSort,
  HostSignupStatus,
  HostVerificationStatus,
} from "../lib/account-hosts.ts";
import { DEFAULT_ACCOUNT_HOST_SORT } from "../lib/account-hosts.ts";
import { accountHostAvailability } from "../lib/account-hosts.ts";
import { listHostsFromAppview } from "../lib/appview-client.ts";
import { hostFriendlyProfile, hostPdsDomain } from "../lib/host-friendly.ts";
import { hostHasCurrentConformance } from "../lib/host-conformance.ts";
import { hostDetailHref } from "../lib/host-directory-navigation.ts";
import { getMessages } from "../i18n/mod.ts";

export default define.page(async function HostsPage(ctx) {
  const copy = getMessages(ctx.state.locale).hostsDirectory;
  const input = readDirectoryInput(ctx.url.searchParams);
  const appliedFilterCount = activeFilterCount(input);
  let loadFailed = false;
  const result = await loadHostsResult(input).catch((err) => {
    console.warn("[hosts] appview host list failed:", err);
    loadFailed = true;
    return emptyHostResult(input);
  });
  const { hosts: visibleHosts } = result;
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const directoryReturnTo = hostDirectoryHref(input, result.page);
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={buildAccountMenuProps(ctx.state)} active="hosts" />
        <section class="hosts-section">
          <div class="container hosts-container">
            <header class="hosts-header">
              <div>
                <p class="text-eyebrow">{copy.eyebrow}</p>
                <h1 class="text-section">{copy.headline}</h1>
                <p class="text-body mt-2">
                  {copy.intro}
                </p>
              </div>
            </header>

            <div class="hosts-search-panel">
              <form
                class="hosts-search-form"
                method="GET"
                action="/hosts"
                role="search"
              >
                <div class="explore-search-form hosts-search-query">
                  <label class="visually-hidden" for="hosts-search-input">
                    {copy.searchLabel}
                  </label>
                  <input
                    id="hosts-search-input"
                    class="explore-search-input"
                    name="q"
                    type="search"
                    value={input.query}
                    autoComplete="off"
                    spellcheck={false}
                    placeholder={copy.searchPlaceholder}
                  />
                  <button type="submit" class="explore-search-submit">
                    {copy.search}
                  </button>
                </div>
                <details class="hosts-filter-menu">
                  <summary
                    class="hosts-filter-trigger"
                    aria-label={appliedFilterCount > 0
                      ? copy.activeFilters(appliedFilterCount)
                      : copy.filters}
                    title={copy.filters}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                    >
                      <path
                        d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M10 14v6"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                      />
                    </svg>
                    {appliedFilterCount > 0 && (
                      <span
                        class="hosts-filter-count"
                        aria-label={copy.activeFilters(appliedFilterCount)}
                      >
                        {appliedFilterCount}
                      </span>
                    )}
                  </summary>
                  <div class="hosts-filter-popover">
                    <label class="hosts-filter-field">
                      <span>{copy.sortLabel}</span>
                      <select name="sort">
                        <option
                          value="recommended"
                          selected={input.sort === "recommended"}
                        >
                          {copy.sortRecommended}
                        </option>
                        <option
                          value="accounts"
                          selected={input.sort === "accounts"}
                        >
                          {copy.sortAccounts}
                        </option>
                        <option
                          value="name"
                          selected={input.sort === "name"}
                        >
                          {copy.sortName}
                        </option>
                        <option
                          value="recent"
                          selected={input.sort === "recent"}
                        >
                          {copy.sortRecent}
                        </option>
                      </select>
                    </label>
                    <label class="hosts-filter-field">
                      <span>{copy.signupLabel}</span>
                      <select name="signup">
                        <option
                          value="all"
                          selected={input.signupStatus === "all"}
                        >
                          {copy.signupAll}
                        </option>
                        <option
                          value="open"
                          selected={input.signupStatus === "open"}
                        >
                          {copy.signupOpen}
                        </option>
                        <option
                          value="invite_required"
                          selected={input.signupStatus === "invite_required"}
                        >
                          {copy.signupInvite}
                        </option>
                      </select>
                    </label>
                    <label class="hosts-filter-field">
                      <span>{copy.verificationLabel}</span>
                      <select name="verification">
                        <option
                          value="all"
                          selected={input.verificationStatus === "all"}
                        >
                          {copy.verificationAll}
                        </option>
                        <option
                          value="verified"
                          selected={input.verificationStatus === "verified"}
                        >
                          {copy.verificationVerified}
                        </option>
                        <option
                          value="claimed"
                          selected={input.verificationStatus === "claimed"}
                        >
                          {copy.verificationClaimed}
                        </option>
                        <option
                          value="observed"
                          selected={input.verificationStatus === "observed"}
                        >
                          {copy.verificationObserved}
                        </option>
                      </select>
                    </label>
                    <button type="submit" class="hosts-filter-apply">
                      {copy.apply}
                    </button>
                  </div>
                </details>
              </form>
            </div>

            <div class="hosts-directory-summary">
              <p>
                <strong>{copy.count(result.total)}</strong>
              </p>
            </div>

            {visibleHosts.length === 0
              ? (
                <div class="glass hosts-empty">
                  <p class="text-body">
                    {loadFailed
                      ? copy.loadError
                      : input.query
                      ? copy.noQueryMatch(input.query)
                      : copy.noFilterMatch}
                  </p>
                </div>
              )
              : (
                <div class="hosts-grid">
                  {visibleHosts.map((host) => (
                    <HostCard
                      key={host.host}
                      host={host}
                      linkedApps={result.linkedApps?.[host.host] ?? []}
                      copy={copy}
                      returnTo={directoryReturnTo}
                    />
                  ))}
                </div>
              )}
            {pageCount > 1 && (
              <HostPagination
                input={input}
                page={result.page}
                pageCount={pageCount}
                copy={copy}
              />
            )}
            <DirectoryRegisterCta
              href={registerHostHref()}
              label={copy.register}
            />
          </div>
        </section>
        <Footer variant="compact" />
        <script type="module" src="/hosts-filter-menu.js" />
      </div>
    </div>
  );
});

async function loadHostsResult(
  input: AccountHostDirectoryOptions,
): Promise<AccountHostDirectoryResult> {
  return await listHostsFromAppview(input);
}

interface HostDirectoryInput extends AccountHostDirectoryOptions {
  query: string;
  sort: AccountHostSort;
  signupStatus: HostSignupStatus | "all";
  verificationStatus: HostVerificationStatus | "all";
  page: number;
  pageSize: number;
}

function readDirectoryInput(search: URLSearchParams): HostDirectoryInput {
  return {
    query: search.get("q")?.trim() ?? "",
    includeLinkedApps: true,
    sort: readSort(search.get("sort")),
    signupStatus: readSignupStatus(search.get("signup")),
    verificationStatus: readVerificationStatus(search.get("verification")),
    page: readPositiveInteger(search.get("page"), 1),
    pageSize: 24,
  };
}

function readPositiveInteger(value: string | null, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

function readSort(value: string | null): AccountHostSort {
  if (value === "active") return "accounts";
  return value === "accounts" || value === "name" || value === "recent"
    ? value
    : DEFAULT_ACCOUNT_HOST_SORT;
}

function readSignupStatus(
  value: string | null,
): HostSignupStatus | "all" {
  return value === "open" || value === "invite_required" ? value : "all";
}

function readVerificationStatus(
  value: string | null,
): HostVerificationStatus | "all" {
  return value === "verified" || value === "claimed" || value === "observed"
    ? value
    : "all";
}

function emptyHostResult(
  input: AccountHostDirectoryOptions,
): AccountHostDirectoryResult {
  return {
    hosts: [],
    total: 0,
    page: Math.max(1, input.page ?? 1),
    pageSize: Math.max(1, input.pageSize ?? 24),
    sort: input.sort ?? DEFAULT_ACCOUNT_HOST_SORT,
  };
}

function HostPagination(
  { input, page, pageCount, copy }: {
    input: HostDirectoryInput;
    page: number;
    pageCount: number;
    copy: HostsDirectoryCopy;
  },
) {
  return (
    <nav class="hosts-pagination" aria-label={copy.paginationLabel}>
      {page > 1
        ? (
          <a href={hostDirectoryHref(input, page - 1)} rel="prev">
            ← {copy.previous}
          </a>
        )
        : <span aria-disabled="true">← {copy.previous}</span>}
      <span>{copy.page(page, pageCount)}</span>
      {page < pageCount
        ? (
          <a href={hostDirectoryHref(input, page + 1)} rel="next">
            {copy.next} →
          </a>
        )
        : <span aria-disabled="true">{copy.next} →</span>}
    </nav>
  );
}

function hostDirectoryHref(input: HostDirectoryInput, page: number): string {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.sort !== DEFAULT_ACCOUNT_HOST_SORT) params.set("sort", input.sort);
  if (input.signupStatus !== "all") {
    params.set("signup", input.signupStatus);
  }
  if (input.verificationStatus !== "all") {
    params.set("verification", input.verificationStatus);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/hosts${query ? `?${query}` : ""}`;
}

function activeFilterCount(input: HostDirectoryInput): number {
  return Number(input.sort !== DEFAULT_ACCOUNT_HOST_SORT) +
    Number(input.signupStatus !== "all") +
    Number(input.verificationStatus !== "all");
}

function DirectoryRegisterCta(
  { href, label }: { href: string; label: string },
) {
  return (
    <div class="directory-register-cta">
      <a href={href} class="directory-register-button">
        <span class="directory-register-button-icon" aria-hidden="true">
          +
        </span>
        <span>{label}</span>
      </a>
    </div>
  );
}

type HostsDirectoryCopy = ReturnType<typeof getMessages>["hostsDirectory"];

function HostCard(
  { host, linkedApps, copy, returnTo }: {
    host: AccountHost;
    linkedApps: NonNullable<AccountHostDirectoryResult["linkedApps"]>[string];
    copy: HostsDirectoryCopy;
    returnTo: string;
  },
) {
  const friendly = hostFriendlyProfile(host);
  const accountCountLabel = host.observedAccountCount > 0
    ? copy.accounts(host.observedAccountCount)
    : null;
  const temporarilyUnavailable = accountHostAvailability(host) === "grace";
  return (
    <a
      href={hostDetailHref(host.host, returnTo)}
      class="glass host-card"
    >
      <div class="host-card-top">
        <div class="host-card-identity">
          <HostMark host={host} />
          <div class="host-card-title-block">
            <h2>{host.displayName}</h2>
            {host.profileHandle && (
              <p class="host-card-handle">
                <AtmosphereHandle handle={host.profileHandle} />
              </p>
            )}
            <p class="host-card-domain">
              {hostPdsDomain(host)}
            </p>
          </div>
        </div>
        {(accountCountLabel || linkedApps.length > 0 ||
          temporarilyUnavailable) && (
          <div class="host-card-account-summary">
            {accountCountLabel && (
              <span
                class="host-card-account-count"
                title={accountCountLabel}
                aria-label={accountCountLabel}
              >
                <span class="host-card-account-count-full" aria-hidden="true">
                  {accountCountLabel}
                </span>
                <span
                  class="host-card-account-count-compact"
                  aria-hidden="true"
                >
                  {copy.compactAccountCount(host.observedAccountCount)}
                </span>
              </span>
            )}
            {linkedApps.length > 0 && (
              <span
                class="host-card-app"
                title={linkedAppIndicatorLabel(linkedApps, copy)}
                aria-label={linkedAppIndicatorLabel(linkedApps, copy)}
              >
                {linkedApps.length === 1 &&
                    linkedApps[0].relationship === "same_operator"
                  ? `${linkedApps[0].name} ${copy.appIndicator.toLowerCase()}`
                  : linkedApps.length > 1
                  ? `${linkedApps.length} ${copy.appsIndicator}`
                  : copy.appIndicator}
              </span>
            )}
            {temporarilyUnavailable && (
              <span class="host-card-unavailable">
                {copy.temporarilyUnavailable}
              </span>
            )}
          </div>
        )}
      </div>
      <p class="host-card-description">{friendly.summary}</p>
      <div class="host-card-footer">
        <div class="host-card-tags" aria-label={copy.factsLabel}>
          <span>{friendly.location}</span>
          <span>{friendly.signupLabel}</span>
          {hostHasCurrentConformance(host) && (
            <span class="host-card-conformance">
              {copy.compatibilityChecked}
            </span>
          )}
        </div>
        <span class="host-card-view">{copy.view}</span>
      </div>
    </a>
  );
}

function linkedAppIndicatorLabel(
  apps: NonNullable<AccountHostDirectoryResult["linkedApps"]>[string],
  copy: HostsDirectoryCopy,
): string {
  if (apps.length === 1 && apps[0].relationship === "same_operator") {
    return copy.operatesApp(apps[0].name);
  }
  return apps.length > 1
    ? copy.operatesApps(apps.length)
    : copy.appIndicatorLabel;
}

function registerHostHref(): string {
  return "/hosts/register";
}
