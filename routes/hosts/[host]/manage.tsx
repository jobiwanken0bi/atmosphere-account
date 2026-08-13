import { define } from "../../../utils.ts";
import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import AtmosphereHandle from "../../../components/AtmosphereHandle.tsx";
import HostMark from "../../../components/hosts/HostMark.tsx";
import HostProfileSaveButton from "../../../islands/HostProfileSaveButton.tsx";
import HostManageSavedStatus from "../../../islands/HostManageSavedStatus.tsx";
import { bskyCdnAvatarUrl } from "../../../lib/avatar.ts";
import { buildAccountMenuProps } from "../../../lib/account-menu-props.ts";
import { proxyAppviewPageResponse } from "../../../lib/appview-client.ts";
import {
  type AccountHost,
  type AccountHostClaim,
  type AccountHostClaimRecovery,
  getAccountHost,
  getAccountHostClaim,
  getPendingAccountHostClaimRecovery,
  type HostSignupStatus,
  isAccountHostPubliclyListable,
  updateAccountHostDashboardSettings,
  updateAccountHostDirectoryListing,
  updateAccountHostProfileSettings,
  verifiedAccountHostOwnerDid,
} from "../../../lib/account-hosts.ts";
import {
  buildHostDashboardState,
  fetchHostDashboardManifest,
  type HostDashboardCapability,
  hostDashboardCapabilityStatusLabel,
  type HostDashboardFetchResult,
  hostDashboardManifestUrl,
} from "../../../lib/host-dashboard.ts";
import {
  publishHostRecords,
  publishHostServiceRecord,
} from "../../../lib/host-records.ts";
import type { BlobRef } from "../../../lib/lexicons.ts";
import {
  getSessionForCapabilities,
  type SessionData,
} from "../../../lib/oauth.ts";
import {
  HOST_MANAGEMENT_CAPABILITIES,
  oauthReauthorizationUrl,
  oauthSigninUrl,
} from "../../../lib/oauth-action.ts";
import {
  getBskyProfile,
  isPdsScopeMissingError,
  PdsBlobUploadError,
  uploadBlob,
} from "../../../lib/pds.ts";
import {
  isPrivateNetworkUrl,
  readFormDataRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../lib/security.ts";
import { enforceDurableRateLimit } from "../../../lib/rate-limit.ts";
import {
  hasHostProfileResumeMarker,
  hostProfileResumePath,
  withoutHostProfileResumeMarker,
} from "../../../lib/host-profile-resume.ts";
import { isLocalDevHostClaim } from "../../../lib/host-claim-proof.ts";
import { createHostOwnerTransferIntent } from "../../../lib/host-owner-transfer-intent.ts";
import { oauthAddAccountHref } from "../oauth-entry.ts";

type ManageState =
  | "ready"
  | "not-claimed"
  | "not-owner"
  | "authority-unavailable"
  | "error";

type ManageSavedSection =
  | "directory"
  | "signup"
  | "profile"
  | "account"
  | "advanced";

const SIGNUP_STATUSES: Array<{ value: HostSignupStatus; label: string }> = [
  { value: "open", label: "Open signup" },
  { value: "invite_required", label: "Invite required" },
  { value: "closed", label: "Closed" },
  { value: "unknown", label: "Not sure yet" },
];

const HOST_AVATAR_MAX_BYTES = 1_000_000;
const MAX_HOST_MANAGE_FORM_BYTES = HOST_AVATAR_MAX_BYTES + 64_000;
const HOST_AVATAR_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type HostPublishResult =
  | {
    ok: true;
    avatarUrl?: string | null;
    serviceRecordUri?: string | null;
    serviceRecordCid?: string | null;
  }
  | { ok: false; message: string; reauthorization?: boolean };

interface ManageFormValues {
  displayName: string;
  description: string;
  dataLocation: string;
  homepageUrl: string;
  signupUrl: string;
  signupStatus: HostSignupStatus;
  profileHandle: string;
  bskyProfileVisible: boolean;
  serviceEndpoint: string;
  accountManagementUrl: string;
  manifestUrl: string;
  supportUrl: string;
}

interface HostManagePageProps {
  host: AccountHost | null;
  claim: AccountHostClaim | null;
  state: ManageState;
  account: ReturnType<typeof buildAccountMenuProps>;
  values: ManageFormValues;
  validation: HostDashboardFetchResult | null;
  error: string | null;
  notice?: string | null;
  recovery?: AccountHostClaimRecovery | null;
  savedSection?: ManageSavedSection | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("host manage page", err),
    );
    if (proxied) return proxied;

    const hostId = decodeURIComponent(ctx.params.host).toLowerCase();
    const host = await getAccountHost(hostId).catch(() => null);
    const account = buildAccountMenuProps(ctx.state);
    if (!host) {
      return ctx.render(
        <HostManagePage
          host={null}
          claim={null}
          state="error"
          account={account}
          values={emptyValues()}
          validation={null}
          error="Host not found."
        />,
        { status: 404 },
      );
    }
    if (!ctx.state.user) return redirectToSignin(host, ctx.url);
    const [claim, recovery] = await Promise.all([
      getAccountHostClaim(host.host).catch(() => null),
      getPendingAccountHostClaimRecovery(host.host).catch(() => null),
    ]);
    const ownerDid = await verifiedAccountHostOwnerDid(host, claim).catch(() =>
      null
    );
    const state = manageStateForUser(claim, ownerDid, ctx.state.user.did);
    if (hasHostProfileResumeMarker(ctx.url) && state !== "ready") {
      return new Response(null, {
        status: 303,
        headers: { location: withoutHostProfileResumeMarker(ctx.url) },
      });
    }
    if (
      state === "ready" &&
      !isLocalDevHostClaim(host.host) &&
      !await getSessionForCapabilities(
        ctx.state.user.did,
        HOST_MANAGEMENT_CAPABILITIES,
        { quiet: true },
      )
    ) {
      return redirectToAuthorization(
        host,
        ctx.url,
        HOST_MANAGEMENT_CAPABILITIES,
      );
    }
    return ctx.render(
      <HostManagePage
        host={host}
        claim={claim}
        state={state}
        account={account}
        values={valuesFromHost(host)}
        validation={null}
        recovery={recovery}
        error={manageStateError(state) ??
          (ctx.url.searchParams.get("linkError") === "1"
            ? "The app connection could not be completed. Ask the app owner to start a new connection from app hosting."
            : null)}
        notice={ctx.url.searchParams.get("transferred") === "1"
          ? "Managing account changed. You can remove the temporary DNS record now. Review the profile and app connections before republishing."
          : ctx.url.searchParams.get("strengthened") === "1"
          ? "Ownership strengthened with DNS. You can remove the temporary DNS record now."
          : ctx.url.searchParams.get("linked") === "1"
          ? ctx.url.searchParams.get("dns") === "1"
            ? "Host claimed and connected. You can remove the temporary DNS record now."
            : ctx.url.searchParams.get("claimed") === "1"
            ? "Host claimed and connected successfully."
            : "Host connected to the app successfully."
          : ctx.url.searchParams.get("claimed") === "1"
          ? ctx.url.searchParams.get("dns") === "1"
            ? "Host claimed. You can remove the temporary DNS record now, then review the settings below."
            : "Host claimed successfully. Review its directory visibility and account routes below."
          : null}
        savedSection={manageSavedSection(ctx.url)}
      />,
      { status: state === "ready" ? 200 : 403 },
    );
  },

  async POST(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("host manage update", err),
    );
    if (proxied) return proxied;

    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "host-management-update",
      capacity: 20,
      refillMs: 60_000,
    });
    if (limited) return limited;

    const large = rejectLargeRequest(ctx.req, MAX_HOST_MANAGE_FORM_BYTES);
    if (large) return large;

    const hostId = decodeURIComponent(ctx.params.host).toLowerCase();
    const host = await getAccountHost(hostId).catch(() => null);
    const account = buildAccountMenuProps(ctx.state);
    if (!host) {
      return ctx.render(
        <HostManagePage
          host={null}
          claim={null}
          state="error"
          account={account}
          values={emptyValues()}
          validation={null}
          error="Host not found."
        />,
        { status: 404 },
      );
    }
    if (!ctx.state.user) return redirectToSignin(host, ctx.url);

    const claim = await getAccountHostClaim(host.host).catch(() => null);
    const ownerDid = await verifiedAccountHostOwnerDid(host, claim).catch(() =>
      null
    );
    const state = manageStateForUser(claim, ownerDid, ctx.state.user.did);
    if (state !== "ready") {
      return ctx.render(
        <HostManagePage
          host={host}
          claim={claim}
          state={state}
          account={account}
          values={valuesFromHost(host)}
          validation={null}
          error={manageStateError(state)}
        />,
        { status: 403 },
      );
    }

    let form: FormData | null;
    try {
      form = await readFormDataRequestWithLimit(
        ctx.req,
        MAX_HOST_MANAGE_FORM_BYTES,
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return new Response("request body too large", { status: 413 });
      }
      form = null;
    }
    const values = valuesFromForm(form, host);
    const action = textValue(form?.get("action"));
    const hostProfileJson = action === "save_profile" &&
      requestAcceptsJson(ctx.req);
    const requiredCapabilities = HOST_MANAGEMENT_CAPABILITIES;
    const session = await getSessionForCapabilities(
      ctx.state.user.did,
      requiredCapabilities,
      { quiet: true },
    );
    const localDevFixture = isLocalDevHostClaim(host.host);
    if (!session && !localDevFixture) {
      if (hostProfileJson) {
        return hostProfileReauthorizationResponse(
          host,
          ctx.url,
          requiredCapabilities,
        );
      }
      return redirectToAuthorization(host, ctx.url, requiredCapabilities);
    }
    if (!session && fileFromForm(form?.get("avatarUpload"))) {
      const message =
        "Local .test fixtures need a real OAuth-backed account before they can upload an avatar.";
      if (hostProfileJson) return hostProfileErrorResponse(422, message);
      return ctx.render(
        <HostManagePage
          host={host}
          claim={claim}
          state="ready"
          account={account}
          values={values}
          validation={null}
          error={message}
        />,
        { status: 422 },
      );
    }
    if (action === "start_owner_transfer") {
      if (localDevFixture) {
        return new Response(
          "Local .test fixtures cannot change manager because they cannot complete public DNS verification.",
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      }
      if (!session) {
        return redirectToAuthorization(host, ctx.url, requiredCapabilities);
      }
      const transfer = await createHostOwnerTransferIntent({
        host: host.host,
        authenticatedOwnerDid: ctx.state.user.did,
      });
      if (!transfer.ok) {
        return ctx.render(
          <HostManagePage
            host={host}
            claim={claim}
            state="ready"
            account={account}
            values={valuesFromHost(host)}
            validation={null}
            error="The managing-account change could not be started. Refresh and try again."
          />,
          { status: 409 },
        );
      }
      const next = managedHostTransferNextHref(host, transfer.value.token);
      return new Response(null, {
        status: 303,
        headers: {
          location: oauthAddAccountHref(
            managedHostTransferAuthorizationHref(host, next),
          ),
        },
      });
    }
    if (action === "save_listing") {
      const listed = form?.get("directory_listing") === "1";
      const updated = await updateAccountHostDirectoryListing(
        host.host,
        ctx.state.user.did,
        listed,
      );
      if (!updated) {
        return ctx.render(
          <HostManagePage
            host={host}
            claim={claim}
            state="ready"
            account={account}
            values={valuesFromHost(host)}
            validation={null}
            error="Directory visibility could not be updated. Try again."
          />,
          { status: 409 },
        );
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: managedHostSaveLocation(host, "directory"),
        },
      });
    }
    if (action === "save_profile" || action === "save_signup") {
      const publication = await publishManagedHostProfile(
        ctx.state.user,
        session,
        host,
        values,
        form,
      );
      if (!publication.ok) {
        if (publication.reauthorization) {
          if (hostProfileJson) {
            return hostProfileReauthorizationResponse(
              host,
              ctx.url,
              requiredCapabilities,
              true,
            );
          }
          return redirectToAuthorization(
            host,
            ctx.url,
            requiredCapabilities,
            true,
          );
        }
        if (hostProfileJson) {
          return hostProfileErrorResponse(422, publication.message);
        }
        return ctx.render(
          <HostManagePage
            host={host}
            claim={claim}
            state="ready"
            account={account}
            values={values}
            validation={null}
            error={publication.message}
          />,
          { status: 422 },
        );
      }
      const result = await updateAccountHostProfileSettings(host.host, {
        displayName: values.displayName,
        description: values.description,
        dataLocation: values.dataLocation,
        homepageUrl: values.homepageUrl,
        signupUrl: values.signupUrl,
        signupStatus: values.signupStatus,
        profileHandle: values.profileHandle,
        bskyProfileVisible: values.bskyProfileVisible,
        avatarUrl: publication.avatarUrl,
      }, ctx.state.user.did);
      if (result.ok) {
        if (publication.serviceRecordUri) {
          await updateAccountHostDashboardSettings(host.host, {
            serviceEndpoint: host.serviceEndpoint,
            accountManagementUrl: host.accountManagementUrl,
            dashboardUrl: host.dashboardUrl,
            capabilityManifestUrl: host.capabilityManifestUrl,
            capabilitiesJson: host.capabilitiesJson,
            supportUrl: host.supportUrl,
            serviceRecordUri: publication.serviceRecordUri,
            serviceRecordCid: publication.serviceRecordCid ?? null,
          }, ctx.state.user.did);
        }
        const redirectUrl = managedHostSaveLocation(
          result.host,
          action === "save_signup" ? "signup" : "profile",
        );
        return hostProfileJson
          ? hostProfileJsonResponse(200, { ok: true, redirectUrl })
          : new Response(null, {
            status: 303,
            headers: { location: redirectUrl },
          });
      }
      if (hostProfileJson) {
        return hostProfileErrorResponse(422, result.message);
      }
      return ctx.render(
        <HostManagePage
          host={host}
          claim={claim}
          state="ready"
          account={account}
          values={values}
          validation={null}
          error={result.message}
        />,
        { status: 422 },
      );
    }

    const settingsAction = action === "validate" ? "validate" : "save";
    const settingsSavedSection: ManageSavedSection = action === "save_advanced"
      ? "advanced"
      : "account";
    const fieldIssues: HostDashboardFetchResult["issues"] = [];
    const serviceEndpoint = normalizeServiceEndpointField(
      values.serviceEndpoint,
      fieldIssues,
    );
    const accountManagementUrl = values.accountManagementUrl
      ? normalizeUrlField(
        values.accountManagementUrl,
        "account management URL",
        "$.accountManagementUrl",
        fieldIssues,
      )
      : null;
    const manifestUrl = values.manifestUrl
      ? normalizeManifestField(values.manifestUrl, fieldIssues)
      : null;
    const supportUrl = normalizeUrlField(
      values.supportUrl,
      "support URL",
      "$.supportUrl",
      fieldIssues,
    );

    if (fieldIssues.some((issue) => issue.severity === "error")) {
      return ctx.render(
        <HostManagePage
          host={host}
          claim={claim}
          state="ready"
          account={account}
          values={values}
          validation={{
            ok: false,
            manifest: null,
            issues: fieldIssues,
            url: manifestUrl ?? values.manifestUrl,
            status: null,
          }}
          error="Fix the host account settings before validating again."
        />,
        { status: 422 },
      );
    }

    const validation = manifestUrl
      ? await fetchHostDashboardManifest(manifestUrl, {
        expectedHost: host.host,
        timeoutMs: 5000,
      })
      : null;
    if (settingsAction === "save" && (!manifestUrl || validation?.ok)) {
      const publication = await publishManagedHostService(
        ctx.state.user,
        session,
        host,
        values,
        serviceEndpoint,
        accountManagementUrl,
        supportUrl,
      );
      if (!publication.ok) {
        if (publication.reauthorization) {
          return redirectToAuthorization(
            host,
            ctx.url,
            HOST_MANAGEMENT_CAPABILITIES,
            true,
          );
        }
        return ctx.render(
          <HostManagePage
            host={host}
            claim={claim}
            state="ready"
            account={account}
            values={values}
            validation={validation}
            error={publication.message}
          />,
          { status: 422 },
        );
      }
      const updated = await updateAccountHostDashboardSettings(host.host, {
        serviceEndpoint,
        accountManagementUrl,
        dashboardUrl: accountManagementUrl,
        capabilityManifestUrl: validation?.url ?? null,
        capabilitiesJson: JSON.stringify(
          validation?.manifest?.capabilities ?? {},
        ),
        supportUrl: validation?.manifest?.supportUrl ?? supportUrl,
        serviceRecordUri: publication.serviceRecordUri ?? null,
        serviceRecordCid: publication.serviceRecordCid ?? null,
      }, ctx.state.user.did);
      if (!updated) {
        return ctx.render(
          <HostManagePage
            host={host}
            claim={claim}
            state="ready"
            account={account}
            values={values}
            validation={validation}
            error="Account links could not be saved. Refresh and try again."
          />,
          { status: 409 },
        );
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: managedHostSaveLocation(host, settingsSavedSection),
        },
      });
    }

    return ctx.render(
      <HostManagePage
        host={host}
        claim={claim}
        state="ready"
        account={account}
        values={values}
        validation={validation}
        error={settingsAction === "save" && validation && !validation.ok
          ? "The manifest must pass validation before it can be saved."
          : null}
      />,
      { status: validation?.ok ?? true ? 200 : 422 },
    );
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Host management is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function publishManagedHostProfile(
  user: { did: string; handle: string },
  session: SessionData | null,
  host: AccountHost,
  values: ManageFormValues,
  form: FormData | null,
): Promise<HostPublishResult> {
  const avatarFile = fileFromForm(form?.get("avatarUpload"));
  if (!session) return { ok: true };
  const bsky = await getBskyProfile(session.pdsUrl, user.did).catch(() => null);
  let avatar: BlobRef | undefined = bsky?.avatar ?? undefined;
  let avatarUrl: string | undefined;

  if (avatarFile) {
    const upload = await uploadHostAvatar(
      user.did,
      session.pdsUrl,
      avatarFile,
    );
    if (!upload.ok) return upload;
    avatar = upload.avatar;
    avatarUrl = upload.avatarUrl;
  } else if (!host.avatarUrl && avatar?.ref?.$link) {
    avatarUrl = bskyCdnAvatarUrl(user.did, avatar.ref.$link);
  }

  try {
    const serviceEndpoint = host.serviceEndpoint || session.pdsUrl;
    const records = await publishHostRecords(user, session.pdsUrl, {
      host: host.host,
      displayName: values.displayName,
      description: values.description,
      dataLocation: values.dataLocation,
      homepageUrl: values.homepageUrl,
      signupUrl: values.signupUrl,
      serviceEndpoint,
      accountManagementUrl: host.accountManagementUrl,
      supportUrl: host.supportUrl,
      signupStatus: values.signupStatus,
      avatar,
      createdAt: isoFromMs(host.createdAt),
      updatedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      avatarUrl,
      serviceRecordUri: records.service.uri,
      serviceRecordCid: records.service.cid,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message:
        `Host record publish failed: ${message}. Sign in again if this account was authorized before host permissions were added.`,
      reauthorization: isHostAuthorizationError(err),
    };
  }
}

async function publishManagedHostService(
  user: { did: string; handle: string },
  session: SessionData | null,
  host: AccountHost,
  values: ManageFormValues,
  serviceEndpoint: string | null,
  accountManagementUrl: string | null,
  supportUrl: string | null,
): Promise<HostPublishResult> {
  if (!session) return { ok: true };
  try {
    const endpoint = serviceEndpoint || session.pdsUrl;
    const service = await publishHostServiceRecord(user, session.pdsUrl, {
      host: host.host,
      displayName: host.displayName,
      description: host.description,
      dataLocation: host.dataLocation ?? "",
      homepageUrl: host.homepageUrl,
      signupUrl: values.signupUrl,
      serviceEndpoint: endpoint,
      accountManagementUrl,
      supportUrl,
      signupStatus: values.signupStatus,
      createdAt: isoFromMs(host.createdAt),
      updatedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      serviceRecordUri: service.uri,
      serviceRecordCid: service.cid,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message:
        `Host service record publish failed: ${message}. Sign in again if this account was authorized before host permissions were added.`,
      reauthorization: isHostAuthorizationError(err),
    };
  }
}

async function uploadHostAvatar(
  did: string,
  pdsUrl: string,
  file: File,
): Promise<
  | { ok: true; avatar: BlobRef; avatarUrl: string }
  | { ok: false; message: string; reauthorization?: boolean }
> {
  if (!HOST_AVATAR_MIME_TYPES.has(file.type)) {
    return { ok: false, message: "Host avatar must be PNG, JPEG, or WebP." };
  }
  if (file.size > HOST_AVATAR_MAX_BYTES) {
    return { ok: false, message: "Host avatar must be under 1 MB." };
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const avatar = await uploadBlob(did, pdsUrl, bytes, file.type);
    return {
      ok: true,
      avatar,
      avatarUrl: `/api/atproto/blob?did=${encodeURIComponent(did)}&cid=${
        encodeURIComponent(avatar.ref.$link)
      }`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Host avatar upload failed: ${message}`,
      reauthorization: isHostAuthorizationError(err),
    };
  }
}

function isHostAuthorizationError(value: unknown): boolean {
  if (isPdsScopeMissingError(value)) return true;
  if (value instanceof PdsBlobUploadError && value.status === 403) return true;
  return value instanceof Error &&
    /(?:ScopeMissingError|failed: HTTP 403)/i.test(value.message);
}

function fileFromForm(
  value: FormDataEntryValue | null | undefined,
): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}

function isoFromMs(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

function formatRecoveryTime(value: number): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function HostManagePage(props: HostManagePageProps) {
  const {
    host,
    claim,
    state,
    account,
    values,
    validation,
    error,
    notice,
    recovery,
    savedSection,
  } = props;
  const dashboard = buildHostDashboardState({ host });
  const publicHostPageIsReady = !!host && isAccountHostPubliclyListable(host);
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <main
          class="signin-page-section host-manage-section"
          id="main-content"
        >
          <div class="container signin-page-container">
            <a
              href={publicHostPageIsReady
                ? `/hosts/${encodeURIComponent(host.host)}`
                : "/hosts"}
              class="text-link-button"
            >
              ← {publicHostPageIsReady ? "Back to host" : "Back to hosts"}
            </a>
            <div class="glass signin-page-card host-manage-card">
              {host
                ? (
                  <>
                    <div class="host-claim-heading">
                      <HostMark host={host} />
                      <div>
                        <p class="text-eyebrow">Manage account host</p>
                        <h1 class="host-claim-title">{host.displayName}</h1>
                        <p class="profile-hero-handle">
                          {host.profileHandle
                            ? <AtmosphereHandle handle={host.profileHandle} />
                            : host.host}
                        </p>
                      </div>
                    </div>
                    <p class="text-body host-claim-copy">
                      Manage where people create accounts, where they return for
                      account settings, and how this host appears in the
                      directory. Passwords, sessions, recovery, and migration
                      stay with your host.
                    </p>
                    <ManageBody
                      host={host}
                      claim={claim}
                      state={state}
                      values={values}
                      validation={validation}
                      error={error}
                      notice={notice ?? null}
                      recovery={recovery ?? null}
                      savedSection={savedSection ?? null}
                      dashboard={dashboard}
                      activeDid={account.user?.did ?? ""}
                      activeHandle={account.user?.handle ?? ""}
                      rememberedAccounts={account.rememberedAccounts}
                    />
                  </>
                )
                : (
                  <>
                    <p class="text-eyebrow">Manage account host</p>
                    <h1 class="host-claim-title">Host not found</h1>
                    <p class="text-body host-claim-copy">
                      This host is not listed yet.
                    </p>
                  </>
                )}
            </div>
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function ManageBody(
  {
    host,
    claim,
    state,
    values,
    validation,
    error,
    notice,
    recovery,
    dashboard,
    activeDid,
    activeHandle,
    rememberedAccounts,
    savedSection,
  }: {
    host: AccountHost;
    claim: AccountHostClaim | null;
    state: ManageState;
    values: ManageFormValues;
    validation: HostDashboardFetchResult | null;
    error: string | null;
    notice: string | null;
    recovery: AccountHostClaimRecovery | null;
    dashboard: ReturnType<typeof buildHostDashboardState>;
    activeDid: string;
    activeHandle: string;
    rememberedAccounts: Array<{ did: string; handle: string }>;
    savedSection: ManageSavedSection | null;
  },
) {
  if (state === "not-claimed") {
    return (
      <div class="host-claim-panel">
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <p class="host-claim-panel-title">Claim required</p>
        <p class="text-body">
          Verify control of the host with a temporary DNS TXT record before
          saving host account-page settings.
        </p>
        <a
          class="directory-register-button host-claim-secondary-action"
          href={`/hosts/${encodeURIComponent(host.host)}/claim`}
        >
          <span>Claim this host</span>
        </a>
      </div>
    );
  }

  if (state === "authority-unavailable") {
    return (
      <div class="host-claim-panel">
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <p class="host-claim-panel-title">
          Operator verification unavailable
        </p>
        <p class="text-body">
          This site could not reverify the stored ownership claim, so it is not
          showing that claimant as the operator or allowing listing changes.
          Nothing has been changed; try again later.
        </p>
      </div>
    );
  }

  if (state === "not-owner") {
    return (
      <div class="host-claim-panel">
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <p class="host-claim-panel-title">
          Managed by <AtmosphereHandle handle={claim?.claimantHandle} />
        </p>
        <p class="text-body">
          Switch to the claiming account to edit account-page settings for this
          host.
        </p>
        <a
          class="directory-register-button host-claim-secondary-action"
          href={managedHostAddAccountHref(
            host,
            `/hosts/${encodeURIComponent(host.host)}/manage`,
          )}
        >
          <span>Use another account</span>
        </a>
      </div>
    );
  }

  const signupEligible = Boolean(
    values.signupUrl &&
      (values.signupStatus === "open" ||
        values.signupStatus === "invite_required"),
  );
  const signupCtaLabel = values.signupStatus === "invite_required"
    ? "Request invite"
    : "Create account";
  const accountRouteUrl = dashboard?.accountManagementUrl ?? null;
  const dnsUpgradeHref = `/hosts/${
    encodeURIComponent(host.host)
  }/claim?${new URLSearchParams({
    publish: host.operatorListingOptIn === false ? "0" : "1",
  })}`;
  const ownershipProof = claim?.method === "dns_txt"
    ? "Verified with DNS"
    : claim?.method === "pds_contact_email"
    ? "Verified by contact email"
    : claim?.method === "atproto_handle"
    ? "Verified by handle"
    : "Verified managing account";

  return (
    <>
      {notice && (
        <p class="profile-form-status profile-form-status--ok" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p
          class="profile-form-status profile-form-status--error"
          role="alert"
        >
          {error}
        </p>
      )}
      <div class="host-manage-nav-wrap">
        <p class="text-eyebrow">Jump to</p>
        <nav class="host-manage-nav" aria-label="Host management sections">
          <a href="#public-presence">Public presence</a>
          <a href="#account-journeys">Account journeys</a>
          <a href="#connections-ownership">Connections &amp; ownership</a>
          <a href="#advanced-settings">Advanced</a>
        </nav>
      </div>
      {claim?.method === "pds_contact_email" &&
        recovery?.status === "pending" &&
        recovery.currentOwnerDid === activeDid && (
        <section
          class="host-claim-panel host-claim-recovery-warning"
          aria-labelledby="host-recovery-warning-title"
        >
          <p
            id="host-recovery-warning-title"
            class="host-claim-panel-title"
          >
            DNS recovery in progress
          </p>
          <p class="text-body">
            <AtmosphereHandle handle={recovery.requesterHandle} />{" "}
            verified current DNS control of{" "}
            {host.host}. DNS is authoritative, while this account remains the
            manager during the 48-hour review period. Starting{" "}
            <strong>{formatRecoveryTime(recovery.eligibleAt)}</strong>, the
            requester can generate and verify a fresh DNS record to finish
            recovery.
          </p>
          <p class="text-body">
            Completing a fresh DNS verification for this account supersedes the
            pending recovery. If you did not expect this, review the domain’s
            DNS or contact{" "}
            <a href="mailto:contact@atmosphereaccount.com">
              contact@atmosphereaccount.com
            </a>.
          </p>
          <a class="directory-register-button" href={dnsUpgradeHref}>
            Strengthen ownership with DNS
          </a>
        </section>
      )}
      <section
        class="host-manage-overview"
        aria-labelledby="host-manage-overview-title"
      >
        <div class="host-manage-group-heading">
          <div>
            <p class="text-eyebrow">Overview</p>
            <h2 id="host-manage-overview-title">Host status</h2>
          </div>
          <a
            class="text-link-button"
            href={`/hosts/${encodeURIComponent(host.host)}`}
          >
            View public host ↗
          </a>
        </div>
        <div class="host-manage-status-grid">
          <a href="#directory-visibility" class="host-manage-status-item">
            <span>Directory</span>
            <strong>
              {host.operatorListingOptIn === false ? "Hidden" : "Visible"}
            </strong>
          </a>
          <a href="#signup" class="host-manage-status-item">
            <span>Sign-up</span>
            <strong>{signupEligible ? "Available" : "Not listed"}</strong>
          </a>
          <a href="#account-links" class="host-manage-status-item">
            <span>Account link</span>
            <strong>{accountRouteUrl ? "Connected" : "Needs setup"}</strong>
          </a>
          <a href="#managing-account" class="host-manage-status-item">
            <span>Ownership</span>
            <strong>{ownershipProof}</strong>
          </a>
        </div>
      </section>
      <section
        id="public-presence"
        class="host-manage-group"
        aria-labelledby="public-presence-title"
      >
        <div class="host-manage-group-heading">
          <div>
            <p class="text-eyebrow">Public presence</p>
            <h2 id="public-presence-title">How this host appears</h2>
            <p class="text-body">
              Manage the profile people see and whether it is visible in the
              public directory.
            </p>
          </div>
        </div>
        <section
          id="public-profile"
          class="host-manage-current host-manage-profile-section"
        >
          <div class="host-detail-dashboard-head">
            <div>
              <p class="text-eyebrow">Public profile</p>
              <h3>What people see on your listing</h3>
              <p class="text-body">
                The friendly name, avatar, description, and profile link shown
                on host cards and the host detail page.
              </p>
            </div>
          </div>
          <form
            method="POST"
            encType="multipart/form-data"
            class="host-manage-form"
          >
            <div class="profile-form-row host-register-profile-row host-manage-profile-identity">
              <div class="profile-form-avatar host-manage-profile-avatar">
                <HostMark host={host} />
                <label class="profile-form-button-secondary">
                  Replace avatar
                  <input
                    type="file"
                    name="avatarUpload"
                    accept="image/png,image/jpeg,image/webp"
                    class="sr-only"
                  />
                </label>
                <p class="profile-form-hint host-manage-avatar-optional">
                  Optional. Stored with the managing account.
                </p>
              </div>
              <div class="profile-form-fields host-manage-profile-primary-fields">
                <label class="profile-form-field">
                  <span class="profile-form-label">Host name</span>
                  <input
                    class="profile-form-input"
                    type="text"
                    name="displayName"
                    value={values.displayName}
                    maxLength={80}
                    required
                  />
                </label>
                <label class="profile-form-field">
                  <span class="profile-form-label">Website</span>
                  <input
                    class="profile-form-input"
                    type="url"
                    name="homepageUrl"
                    value={values.homepageUrl}
                    placeholder="https://pckt.cafe"
                  />
                </label>
                <label class="profile-form-field">
                  <span class="profile-form-label">Data location</span>
                  <input
                    class="profile-form-input"
                    type="text"
                    name="dataLocation"
                    value={values.dataLocation}
                    placeholder="Europe"
                    maxLength={120}
                  />
                  <span class="profile-form-hint">
                    Optional. Where account data is primarily hosted, if the
                    host publishes that information.
                  </span>
                </label>
              </div>
            </div>
            <div class="profile-form-fields host-manage-profile-fields">
              <label class="profile-form-field">
                <span class="profile-form-label">Host account handle</span>
                <input
                  class="profile-form-input"
                  type="text"
                  name="profileHandle"
                  value={values.profileHandle}
                  placeholder="pckt.blog"
                  autoComplete="off"
                  spellcheck={false}
                />
                <span class="profile-form-hint">
                  Used for the host avatar, public handle, and optional Bluesky
                  profile button.
                </span>
              </label>
              <label class="profile-form-field">
                <span class="profile-form-label">Description</span>
                <textarea
                  class="profile-form-input"
                  name="description"
                  rows={4}
                  maxLength={600}
                  placeholder="A short, non-technical description of who this host is for."
                >
                  {values.description}
                </textarea>
              </label>
              <input type="hidden" name="bskyProfileVisible" value="0" />
              <div
                class={`atmosphere-row host-profile-toggle ${
                  values.bskyProfileVisible ? "is-on" : ""
                }`}
              >
                <label class="atmosphere-row-toggle">
                  <input
                    type="checkbox"
                    name="bskyProfileVisible"
                    value="1"
                    checked={values.bskyProfileVisible}
                    aria-label="Show Bluesky profile button on the public host page"
                  />
                  <span class="atmosphere-toggle-track" aria-hidden="true">
                    <span class="atmosphere-toggle-thumb" />
                  </span>
                </label>
                <span class="atmosphere-row-body">
                  <span class="atmosphere-row-copy">
                    <span class="atmosphere-row-title">
                      Show Bluesky profile button
                    </span>
                    <span class="atmosphere-row-subtitle">
                      Adds a small Bluesky icon link to the public host page.
                    </span>
                  </span>
                </span>
              </div>
            </div>
            <div class="host-manage-actions">
              <HostProfileSaveButton
                did={activeDid}
                host={host.host}
                targetName={host.displayName}
                currentHandle={activeHandle}
                initialSaved={savedSection === "profile"}
                rememberedAccounts={rememberedAccounts}
              />
            </div>
          </form>
        </section>
        <section
          id="directory-visibility"
          class="host-manage-current host-manage-listing-section"
        >
          <div class="host-detail-dashboard-head">
            <div>
              <p class="text-eyebrow">Public directory</p>
              <h3>Show this host in the directory</h3>
              <p class="text-body">
                This host is listed because you manage it. Turn visibility off
                to hide its directory card and public host page.
              </p>
            </div>
          </div>
          <form method="POST" class="host-manage-form" data-submit-once="true">
            <label class="profile-form-toggle">
              <input
                type="checkbox"
                name="directory_listing"
                value="1"
                checked={host.operatorListingOptIn !== false}
              />
              <span class="profile-form-toggle-body">
                <span class="profile-form-toggle-label">
                  Show this host in the public directory
                </span>
                <span class="profile-form-toggle-hint">
                  Turning this off hides the host page and directory card. You
                  can turn it back on at any time.
                </span>
              </span>
            </label>
            <div class="host-manage-actions">
              <button
                class="directory-register-button host-manage-save"
                type="submit"
                name="action"
                value="save_listing"
                data-pending-label="Saving visibility…"
              >
                <span data-submit-once-label>Save changes</span>
              </button>
              <HostManageSavedStatus
                saved={savedSection === "directory"}
              />
            </div>
          </form>
        </section>
      </section>
      <section
        id="account-journeys"
        class="host-manage-group"
        aria-labelledby="account-journeys-title"
      >
        <div class="host-manage-group-heading">
          <div>
            <p class="text-eyebrow">Account journeys</p>
            <h2 id="account-journeys-title">Where people go</h2>
            <p class="text-body">
              Set the destinations for creating an account and returning to
              manage one.
            </p>
          </div>
        </div>
        <section
          id="signup"
          class="host-manage-current host-manage-signup-section"
        >
          <div class="host-detail-dashboard-head">
            <div>
              <p class="text-eyebrow">Sign-up</p>
              <h3>Where people create accounts</h3>
              <p class="text-body">
                Choose whether this host appears as a place to create an account
                during Login with Atmosphere. Account creation stays on your
                site; this directory only links people there.
              </p>
            </div>
          </div>
          <div
            class={`host-claim-panel ${
              signupEligible ? "host-claim-panel-ok" : ""
            }`}
          >
            <p class="host-claim-panel-title">
              {signupEligible
                ? "You appear in the account picker"
                : "Not shown in the account picker yet"}
            </p>
            {signupEligible
              ? (
                <>
                  <p class="text-body">
                    People creating a new account see a row like this:
                  </p>
                  <div class="host-signup-preview" aria-hidden="true">
                    <HostMark host={host} />
                    <span class="host-signup-preview-name">
                      {values.displayName || host.displayName}
                    </span>
                    <span class="directory-register-button host-signup-preview-cta">
                      {signupCtaLabel}
                    </span>
                  </div>
                </>
              )
              : (
                <p class="text-body">
                  Choose <strong>Open signup</strong> or{" "}
                  <strong>Invite required</strong>{" "}
                  and add a signup URL to show up.
                </p>
              )}
          </div>
          <form method="POST" class="host-manage-form" data-submit-once="true">
            <label class="profile-form-field">
              <span class="profile-form-label">Signup status</span>
              <select
                class="profile-form-input"
                name="signupStatus"
                value={values.signupStatus}
              >
                {SIGNUP_STATUSES.map((status) => (
                  <option
                    value={status.value}
                    selected={values.signupStatus === status.value}
                  >
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label class="profile-form-field">
              <span class="profile-form-label">Signup URL</span>
              <input
                class="profile-form-input"
                type="url"
                name="signupUrl"
                value={values.signupUrl}
                placeholder="https://pckt.cafe/signup"
              />
              <span class="profile-form-hint">
                The direct create-account or invite-request flow. This can be
                different from your public website.
              </span>
            </label>
            <div class="host-manage-actions">
              <button
                class="directory-register-button host-manage-save"
                type="submit"
                name="action"
                value="save_signup"
                data-pending-label="Saving sign-up…"
              >
                <span data-submit-once-label>Save changes</span>
              </button>
              <HostManageSavedStatus saved={savedSection === "signup"} />
            </div>
          </form>
        </section>
        <section id="account-links" class="host-manage-current">
          <div class="host-detail-dashboard-head">
            <div>
              <p class="text-eyebrow">Account management</p>
              <h3>Where people manage their accounts</h3>
              <p class="text-body">
                This site links people back to the account controls on your host
                for passwords, sessions, OAuth grants, exports, and migration.
              </p>
            </div>
          </div>
          {accountRouteUrl
            ? (
              <div class="host-claim-panel host-claim-panel-ok">
                <p class="host-claim-panel-title">Deep-link target</p>
                <p class="text-body">
                  “Manage account at host” sends people to{" "}
                  <a
                    href={accountRouteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    class="text-link-button host-manage-route-link"
                  >
                    {accountRouteUrl} ↗
                  </a>
                </p>
              </div>
            )
            : (
              <div class="host-claim-panel">
                <p class="host-claim-panel-title">No account page yet</p>
                <p class="text-body">
                  Add your PDS service endpoint below. This site then routes
                  people to the /account path on that origin unless you set an
                  override.
                </p>
              </div>
            )}
          <form method="POST" class="host-manage-form" data-submit-once="true">
            <label class="profile-form-field">
              <span class="profile-form-label">PDS service endpoint</span>
              <input
                class="profile-form-input"
                type="url"
                name="service_endpoint"
                value={values.serviceEndpoint}
                placeholder="https://pds.example"
                required
              />
              <span class="profile-form-hint">
                The canonical PDS origin for this host.
              </span>
            </label>
            <label class="profile-form-field">
              <span class="profile-form-label">
                Account management URL override
              </span>
              <input
                class="profile-form-input"
                type="url"
                name="account_management_url"
                value={values.accountManagementUrl}
                placeholder="https://pds.example/account"
              />
              <span class="profile-form-hint">
                Optional. This site uses `/account` on the PDS endpoint by
                default. Add an override only when this host uses another URL.
              </span>
            </label>
            <label class="profile-form-field">
              <span class="profile-form-label">Support URL</span>
              <input
                class="profile-form-input"
                type="url"
                name="support_url"
                value={values.supportUrl}
                placeholder="https://host.example/support"
              />
              <span class="profile-form-hint">
                Optional help, support, terms, or contact page for this host.
              </span>
            </label>
            <div class="host-manage-actions">
              <button
                class="directory-register-button host-manage-save"
                type="submit"
                name="action"
                value="save_account"
                data-pending-label="Saving account links…"
              >
                <span data-submit-once-label>Save changes</span>
              </button>
              <HostManageSavedStatus saved={savedSection === "account"} />
            </div>
          </form>
        </section>
      </section>
      <section
        id="connections-ownership"
        class="host-manage-group"
        aria-labelledby="connections-ownership-title"
      >
        <div class="host-manage-group-heading">
          <div>
            <p class="text-eyebrow">Host relationships</p>
            <h2 id="connections-ownership-title">
              Connections &amp; ownership
            </h2>
            <p class="text-body">
              Connect related apps and control which Atmosphere account manages
              this host.
            </p>
          </div>
        </div>
        <section
          id="app-connections"
          class="host-manage-current directory-relationship-entry"
        >
          <div>
            <p class="text-eyebrow">Apps and host identity</p>
            <h3>Connect this host to its apps</h3>
            <p class="text-body">
              The app and host keep separate public profiles. Verified
              connections show whether the host provides account services for an
              app or the two share an operator. Different app accounts must
              approve the connection too.
            </p>
          </div>
          <a
            class="directory-register-button"
            href={`/hosts/${encodeURIComponent(host.host)}/manage/apps`}
          >
            Manage app connections
          </a>
        </section>
        {isLocalDevHostClaim(host.host)
          ? (
            <section
              id="managing-account"
              class="host-manage-current directory-relationship-entry"
            >
              <div>
                <p class="text-eyebrow">Managing account</p>
                <h3>Local fixture manager</h3>
                <p class="text-body">
                  Managing-account changes are unavailable for local{" "}
                  <code>.test</code>{" "}
                  fixtures because they cannot complete public DNS verification.
                </p>
              </div>
            </section>
          )
          : (
            <section
              id="managing-account"
              class="host-manage-current directory-relationship-entry"
            >
              <div>
                <p class="text-eyebrow">Managing account</p>
                <h3>
                  Managed by <AtmosphereHandle handle={claim?.claimantHandle} />
                </h3>
                <p class="text-body">
                  {claim?.method === "pds_contact_email"
                    ? "Ownership currently uses the contact email published by this PDS. Verify DNS to strengthen its proof. To change the manager, choose the new account and prove control with DNS."
                    : "One account manages this host. To change it, choose the new account and prove control again with DNS. This account stays in control until verification succeeds."}
                </p>
              </div>
              <div class="host-manage-actions">
                {claim?.method === "pds_contact_email" && (
                  <a class="directory-register-button" href={dnsUpgradeHref}>
                    Strengthen ownership with DNS
                  </a>
                )}
                <form method="POST" data-submit-once="true">
                  <input
                    type="hidden"
                    name="action"
                    value="start_owner_transfer"
                  />
                  <button
                    type="submit"
                    class="directory-register-button host-manage-owner-transfer"
                    data-pending-label="Preparing account change…"
                  >
                    <span data-submit-once-label>Change managing account</span>
                  </button>
                </form>
              </div>
            </section>
          )}
      </section>
      <details
        id="advanced-settings"
        class="host-manage-group host-manage-advanced-group"
        open={Boolean(validation) || savedSection === "advanced"}
      >
        <summary class="host-manage-group-summary">
          <span>
            <span class="text-eyebrow">Advanced</span>
            <strong>Manifest and capabilities</strong>
          </span>
          <span class="host-manage-summary-chevron" aria-hidden="true" />
        </summary>
        <div class="host-manage-advanced-content">
          <section class="host-manage-current">
            <div class="host-detail-dashboard-head">
              <div>
                <p class="text-eyebrow">Capability manifest</p>
                <h3>Declare standardized host features</h3>
                <p class="text-body">
                  Optional. Validate and publish a capability self-report for
                  the directory and conformance checks. It does not change the
                  sign-in experience.
                </p>
              </div>
            </div>
            <form
              method="POST"
              class="host-manage-form"
              data-submit-once="true"
            >
              <label class="profile-form-field">
                <span class="profile-form-label">Manifest URL</span>
                <input
                  class="profile-form-input"
                  type="url"
                  name="manifest_url"
                  value={values.manifestUrl}
                  placeholder={`https://${host.host}/.well-known/atmosphere-host-dashboard.json`}
                />
                <span class="profile-form-hint">
                  The public URL of this host’s Atmosphere capability manifest.
                </span>
              </label>
              <div class="host-manage-actions">
                <button
                  class="profile-form-button-secondary profile-form-button-secondary--lg"
                  type="submit"
                  name="action"
                  value="validate"
                  data-pending-label="Validating manifest…"
                >
                  <span data-submit-once-label>Validate manifest</span>
                </button>
                <button
                  class="directory-register-button host-manage-save"
                  type="submit"
                  name="action"
                  value="save_advanced"
                  data-pending-label="Saving manifest…"
                >
                  <span data-submit-once-label>Save changes</span>
                </button>
                <HostManageSavedStatus
                  saved={savedSection === "advanced"}
                />
              </div>
            </form>
          </section>

          {validation && <ValidationPanel validation={validation} />}

          {dashboard && (
            <section class="host-manage-current">
              <div class="host-detail-dashboard-head">
                <div>
                  <p class="text-eyebrow">Capability self-report</p>
                  <h3>Declared capabilities</h3>
                  <p class="text-body">
                    People signing in don’t see this grid, and it doesn’t change
                    sign-up or account routing.
                  </p>
                </div>
              </div>
              <div class="host-detail-capability-grid">
                {dashboard.capabilities.map((capability) => (
                  <HostCapabilitySummary
                    key={capability.key}
                    capability={capability}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </details>
    </>
  );
}

function ValidationPanel(
  { validation }: { validation: HostDashboardFetchResult },
) {
  const supported = validation.manifest?.capabilities
    ? Object.values(validation.manifest.capabilities).filter((capability) =>
      capability?.state === "supported"
    ).length
    : 0;
  return (
    <section
      class={`host-manage-validation ${
        validation.ok
          ? "host-manage-validation--ok"
          : "host-manage-validation--error"
      }`}
    >
      <div>
        <p class="host-claim-panel-title">
          {validation.ok ? "Manifest passed" : "Manifest needs changes"}
        </p>
        <p class="text-body">
          {validation.ok
            ? `${supported} standardized capabilities are marked supported.`
            : "Fix the errors below before this site saves compatibility."}
        </p>
        <p class="host-manage-validation-url">{validation.url}</p>
      </div>
      {validation.issues.length > 0 && (
        <ul class="host-manage-issues">
          {validation.issues.map((issue) => (
            <li
              key={`${issue.path}:${issue.message}`}
              class={`host-manage-issue host-manage-issue--${issue.severity}`}
            >
              <strong>{issue.severity}</strong>
              <span>{issue.path}</span>
              <p>{issue.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HostCapabilitySummary(
  { capability }: { capability: HostDashboardCapability },
) {
  return (
    <article
      class={`host-detail-capability host-detail-capability--${capability.state}`}
    >
      <span>{capability.label}</span>
      <strong>{hostDashboardCapabilityStatusLabel(capability.state)}</strong>
    </article>
  );
}

function manageStateForUser(
  claim: AccountHostClaim | null,
  verifiedOwnerDid: string | null,
  did: string,
): ManageState {
  if (!claim) return "not-claimed";
  if (!verifiedOwnerDid) return "authority-unavailable";
  return verifiedOwnerDid === did ? "ready" : "not-owner";
}

function manageStateError(state: ManageState): string | null {
  if (state === "not-claimed") {
    return "Claim this host before managing account routing.";
  }
  if (state === "authority-unavailable") {
    return "The stored host owner could not be reverified.";
  }
  if (state === "not-owner") {
    return "This signed-in account cannot manage the host listing.";
  }
  return null;
}

function redirectToSignin(host: AccountHost, url: URL): Response {
  return redirectToAuthorization(host, url, HOST_MANAGEMENT_CAPABILITIES);
}

function redirectToAuthorization(
  host: AccountHost,
  url: URL,
  capabilities: readonly ("host" | "media")[],
  force = false,
): Response {
  const next = `${url.pathname}${url.search}`;
  return new Response(null, {
    status: 303,
    headers: {
      location: managedHostAuthorizationHref(host, next, capabilities, force),
    },
  });
}

function hostProfileReauthorizationResponse(
  host: AccountHost,
  url: URL,
  capabilities: readonly ("host" | "media")[],
  force = false,
): Response {
  return hostProfileJsonResponse(403, {
    error: "reauth_required",
    reauthUrl: managedHostAuthorizationHref(
      host,
      hostProfileResumePath(url),
      capabilities,
      force,
    ),
  });
}

function hostProfileErrorResponse(status: number, detail: string): Response {
  return hostProfileJsonResponse(status, {
    error: "host_profile_save_failed",
    detail,
  });
}

function hostProfileJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function requestAcceptsJson(request: Request): boolean {
  return request.headers.get("accept")?.includes("application/json") ?? false;
}

export function managedHostAuthorizationHref(
  host: Pick<AccountHost, "displayName">,
  next: string,
  capabilities: readonly ("host" | "media")[] = HOST_MANAGEMENT_CAPABILITIES,
  force = false,
): string {
  const buildUrl = force ? oauthReauthorizationUrl : oauthSigninUrl;
  return buildUrl({
    next,
    action: "host_manage",
    capabilities,
    name: host.displayName,
  });
}

export function managedHostAddAccountHref(
  host: Pick<AccountHost, "displayName">,
  next: string,
): string {
  return oauthAddAccountHref(managedHostAuthorizationHref(host, next));
}

export function managedHostTransferNextHref(
  host: Pick<AccountHost, "host" | "operatorListingOptIn">,
  transferToken: string,
): string {
  return `/hosts/${encodeURIComponent(host.host)}/claim?${new URLSearchParams({
    transfer_intent: transferToken,
    publish: host.operatorListingOptIn === false ? "0" : "1",
  })}`;
}

export function managedHostTransferAuthorizationHref(
  host: Pick<AccountHost, "displayName">,
  next: string,
): string {
  return oauthSigninUrl({
    next,
    action: "host_transfer",
    capabilities: HOST_MANAGEMENT_CAPABILITIES,
    name: host.displayName,
  });
}

export function managedHostSaveLocation(
  host: Pick<AccountHost, "host">,
  section: ManageSavedSection,
): string {
  return `/hosts/${encodeURIComponent(host.host)}/manage?${new URLSearchParams({
    saved: section,
  })}#${manageSectionAnchor(section)}`;
}

function manageSavedSection(url: URL): ManageSavedSection | null {
  const saved = url.searchParams.get("saved");
  if (
    saved === "directory" || saved === "signup" || saved === "profile" ||
    saved === "account" || saved === "advanced"
  ) return saved;
  // Preserve the short-lived URL emitted by the previous directory form.
  return url.searchParams.get("listing") === "saved" ? "directory" : null;
}

function manageSectionAnchor(section: ManageSavedSection): string {
  if (section === "directory") return "directory-visibility";
  if (section === "signup") return "signup";
  if (section === "profile") return "public-profile";
  if (section === "account") return "account-links";
  return "advanced-settings";
}

function valuesFromHost(host: AccountHost): ManageFormValues {
  const savedAccountPageUrl = host.accountManagementUrl ??
    host.dashboardUrl ??
    "";
  return {
    displayName: host.displayName,
    description: host.description,
    dataLocation: host.dataLocation ?? "",
    homepageUrl: host.homepageUrl ?? "",
    signupUrl: host.signupUrl ?? "",
    signupStatus: host.signupStatus,
    profileHandle: host.profileHandle ?? "",
    bskyProfileVisible: host.bskyProfileVisible,
    serviceEndpoint: host.serviceEndpoint ?? "",
    accountManagementUrl: savedAccountPageUrl,
    manifestUrl: host.capabilityManifestUrl ?? "",
    supportUrl: host.supportUrl ?? "",
  };
}

function valuesFromForm(
  form: FormData | null,
  host: AccountHost,
): ManageFormValues {
  if (!form) return valuesFromHost(host);
  const fallback = valuesFromHost(host);
  return {
    displayName: textValue(form.get("displayName")) || fallback.displayName,
    description: form.has("description")
      ? textValue(form.get("description"))
      : fallback.description,
    dataLocation: form.has("dataLocation")
      ? textValue(form.get("dataLocation"))
      : fallback.dataLocation,
    homepageUrl: form.has("homepageUrl")
      ? textValue(form.get("homepageUrl"))
      : fallback.homepageUrl,
    signupUrl: form.has("signupUrl")
      ? textValue(form.get("signupUrl"))
      : fallback.signupUrl,
    signupStatus: form.has("signupStatus")
      ? readSignupStatus(form.get("signupStatus"))
      : fallback.signupStatus,
    profileHandle: form.has("profileHandle")
      ? textValue(form.get("profileHandle"))
      : fallback.profileHandle,
    bskyProfileVisible: form.has("bskyProfileVisible")
      ? formHasValue(form, "bskyProfileVisible", "1")
      : fallback.bskyProfileVisible,
    serviceEndpoint: textValue(form.get("service_endpoint")) ||
      fallback.serviceEndpoint,
    accountManagementUrl: form.has("account_management_url")
      ? textValue(form.get("account_management_url"))
      : fallback.accountManagementUrl,
    manifestUrl: textValue(form.get("manifest_url")) || fallback.manifestUrl,
    supportUrl: textValue(form.get("support_url")) || fallback.supportUrl,
  };
}

function emptyValues(): ManageFormValues {
  return {
    displayName: "",
    description: "",
    dataLocation: "",
    homepageUrl: "",
    signupUrl: "",
    signupStatus: "unknown",
    profileHandle: "",
    bskyProfileVisible: true,
    serviceEndpoint: "",
    accountManagementUrl: "",
    manifestUrl: "",
    supportUrl: "",
  };
}

function textValue(value: FormDataEntryValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function readSignupStatus(
  value: FormDataEntryValue | null | undefined,
): HostSignupStatus {
  return value === "open" || value === "invite_required" ||
      value === "closed" || value === "unknown"
    ? value
    : "unknown";
}

function formHasValue(
  form: FormData | null,
  name: string,
  value: string,
): boolean {
  return form?.getAll(name).some((entry) => entry === value) ?? false;
}

function normalizeManifestField(
  value: string,
  issues: HostDashboardFetchResult["issues"],
): string | null {
  const manifestUrl = hostDashboardManifestUrl(value);
  if (!manifestUrl) {
    issues.push({
      severity: "error",
      path: "$.manifestUrl",
      message: "Manifest URL must be absolute HTTP(S).",
    });
    return null;
  }
  if (isPrivateNetworkUrl(manifestUrl, { allowHttp: true })) {
    issues.push({
      severity: "error",
      path: "$.manifestUrl",
      message: "Manifest URL must be public HTTP(S).",
    });
    return null;
  }
  return manifestUrl;
}

function normalizeServiceEndpointField(
  value: string,
  issues: HostDashboardFetchResult["issues"],
): string | null {
  if (!value) {
    issues.push({
      severity: "error",
      path: "$.serviceEndpoint",
      message: "PDS service endpoint is required.",
    });
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username || url.password ||
      isPrivateNetworkUrl(url.toString(), { allowHttp: true })
    ) {
      throw new Error("invalid public URL");
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    issues.push({
      severity: "error",
      path: "$.serviceEndpoint",
      message: "PDS service endpoint must be a public HTTPS origin.",
    });
    return null;
  }
}

function normalizeUrlField(
  value: string,
  label: string,
  path: string,
  issues: HostDashboardFetchResult["issues"],
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.username || url.password ||
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      isPrivateNetworkUrl(url.toString(), { allowHttp: true })
    ) {
      throw new Error("invalid public URL");
    }
    url.hash = "";
    return url.toString();
  } catch {
    issues.push({
      severity: "error",
      path,
      message: `${label} must be public HTTP(S).`,
    });
    return null;
  }
}
