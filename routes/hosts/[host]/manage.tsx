import { define } from "../../../utils.ts";
import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import AtmosphereHandle from "../../../components/AtmosphereHandle.tsx";
import HostMark from "../../../components/hosts/HostMark.tsx";
import { bskyCdnAvatarUrl } from "../../../lib/avatar.ts";
import { buildAccountMenuProps } from "../../../lib/account-menu-props.ts";
import { proxyAppviewPageResponse } from "../../../lib/appview-client.ts";
import {
  type AccountHost,
  type AccountHostClaim,
  getAccountHost,
  getAccountHostClaim,
  type HostSignupStatus,
  updateAccountHostDashboardSettings,
  updateAccountHostProfileSettings,
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
import { loadSession } from "../../../lib/oauth.ts";
import { getBskyProfile, uploadBlob } from "../../../lib/pds.ts";
import {
  isPrivateNetworkUrl,
  rejectLargeRequest,
} from "../../../lib/security.ts";
import { enforceDurableRateLimit } from "../../../lib/rate-limit.ts";

type ManageState = "ready" | "not-claimed" | "not-owner" | "error";

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
  | { ok: false; message: string };

interface ManageFormValues {
  displayName: string;
  description: string;
  dataLocation: string;
  homepageUrl: string;
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
    if (!ctx.state.user) return redirectToSignin(host.host, ctx.url);
    const claim = await getAccountHostClaim(host.host).catch(() => null);
    const state = manageStateForUser(claim, ctx.state.user.did);
    return ctx.render(
      <HostManagePage
        host={host}
        claim={claim}
        state={state}
        account={account}
        values={valuesFromHost(host)}
        validation={null}
        error={state === "not-claimed"
          ? "Claim this host before managing account routing."
          : state === "not-owner"
          ? "This signed-in account cannot manage the host listing."
          : null}
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
    if (!ctx.state.user) return redirectToSignin(host.host, ctx.url);

    const claim = await getAccountHostClaim(host.host).catch(() => null);
    const state = manageStateForUser(claim, ctx.state.user.did);
    if (state !== "ready") {
      return ctx.render(
        <HostManagePage
          host={host}
          claim={claim}
          state={state}
          account={account}
          values={valuesFromHost(host)}
          validation={null}
          error={state === "not-claimed"
            ? "Claim this host before managing account routing."
            : "This signed-in account cannot manage the host listing."}
        />,
        { status: 403 },
      );
    }

    const form = await ctx.req.formData().catch(() => null);
    const values = valuesFromForm(form, host);
    const action = textValue(form?.get("action"));
    if (action === "save_profile") {
      const publication = await publishManagedHostProfile(
        ctx.state.user,
        host,
        values,
        form,
      );
      if (!publication.ok) {
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
        signupStatus: values.signupStatus,
        profileHandle: values.profileHandle,
        bskyProfileVisible: values.bskyProfileVisible,
        avatarUrl: publication.avatarUrl,
      });
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
          });
        }
        return new Response(null, {
          status: 303,
          headers: {
            location: `/hosts/${
              encodeURIComponent(result.host.host)
            }?managed=1`,
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
          validation={null}
          error={result.message}
        />,
        { status: 422 },
      );
    }

    const settingsAction = action === "validate" ? "validate" : "save";
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
        host,
        values,
        serviceEndpoint,
        accountManagementUrl,
        supportUrl,
      );
      if (!publication.ok) {
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
      await updateAccountHostDashboardSettings(host.host, {
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
      });
      return new Response(null, {
        status: 303,
        headers: {
          location: `/hosts/${encodeURIComponent(host.host)}?managed=1`,
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
  host: AccountHost,
  values: ManageFormValues,
  form: FormData | null,
): Promise<HostPublishResult> {
  const session = await loadSession(user.did).catch(() => null);
  const avatarFile = fileFromForm(form?.get("avatarUpload"));
  if (!session) {
    if (avatarFile) {
      return {
        ok: false,
        message:
          "Sign in again before uploading a host avatar. Image uploads publish to the host account's PDS.",
      };
    }
    return { ok: true };
  }

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
    };
  }
}

async function publishManagedHostService(
  user: { did: string; handle: string },
  host: AccountHost,
  values: ManageFormValues,
  serviceEndpoint: string | null,
  accountManagementUrl: string | null,
  supportUrl: string | null,
): Promise<HostPublishResult> {
  const session = await loadSession(user.did).catch(() => null);
  if (!session) return { ok: true };
  try {
    const endpoint = serviceEndpoint || session.pdsUrl;
    const service = await publishHostServiceRecord(user, session.pdsUrl, {
      host: host.host,
      displayName: host.displayName,
      description: host.description,
      dataLocation: host.dataLocation ?? "",
      homepageUrl: host.homepageUrl,
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
    };
  }
}

async function uploadHostAvatar(
  did: string,
  pdsUrl: string,
  file: File,
): Promise<
  | { ok: true; avatar: BlobRef; avatarUrl: string }
  | { ok: false; message: string }
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
    return { ok: false, message: `Host avatar upload failed: ${message}` };
  }
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

function HostManagePage(props: HostManagePageProps) {
  const { host, claim, state, account, values, validation, error } = props;
  const dashboard = buildHostDashboardState({ host });
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <section class="signin-page-section host-manage-section">
          <div class="container signin-page-container">
            <a
              href={host ? `/hosts/${encodeURIComponent(host.host)}` : "/hosts"}
              class="text-link-button"
            >
              Back to host
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
                      Edit the public host profile and account-page routing.
                      Atmosphere shows the friendly listing; the host remains
                      the authority for account controls.
                    </p>
                    <ManageBody
                      host={host}
                      claim={claim}
                      state={state}
                      values={values}
                      validation={validation}
                      error={error}
                      dashboard={dashboard}
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
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function ManageBody(
  { host, claim, state, values, validation, error, dashboard }: {
    host: AccountHost;
    claim: AccountHostClaim | null;
    state: ManageState;
    values: ManageFormValues;
    validation: HostDashboardFetchResult | null;
    error: string | null;
    dashboard: ReturnType<typeof buildHostDashboardState>;
  },
) {
  if (state === "not-claimed") {
    return (
      <div class="host-claim-panel">
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <p class="host-claim-panel-title">Claim required</p>
        <p class="text-body">
          Claim this host with its linked ATProto account before saving host
          account-page settings.
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

  if (state === "not-owner") {
    return (
      <div class="host-claim-panel">
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
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
          href={`/oauth/add-account?next=${
            encodeURIComponent(`/hosts/${encodeURIComponent(host.host)}/manage`)
          }`}
        >
          <span>Use another account</span>
        </a>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p class="profile-form-status profile-form-status--error">{error}</p>
      )}
      <section class="host-manage-current host-manage-profile-section">
        <div class="host-detail-dashboard-head">
          <div>
            <p class="text-eyebrow">Public host profile</p>
            <h2>What people see on Atmosphere</h2>
            <p class="text-body">
              Edit the friendly name, description, signup state, and public
              profile link used on host cards and the host detail page.
            </p>
          </div>
        </div>
        <form
          method="POST"
          encType="multipart/form-data"
          class="host-manage-form"
        >
          <div class="profile-form-row host-register-profile-row">
            <div class="profile-form-avatar">
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
              <p class="profile-form-hint host-register-avatar-hint">
                Optional. Uploaded host avatars are stored as blobs in the
                signed-in host account's PDS.
              </p>
            </div>
            <div class="profile-form-fields">
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
                <span class="profile-form-label">Website or signup URL</span>
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
                  Optional. Where account data is primarily hosted, if the host
                  publishes that information.
                </span>
              </label>
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
          </div>
          <div class="host-manage-actions">
            <button
              class="directory-register-button host-manage-save"
              type="submit"
              name="action"
              value="save_profile"
            >
              <span>Save host profile</span>
            </button>
          </div>
        </form>
      </section>

      <section class="host-manage-current">
        <div class="host-detail-dashboard-head">
          <div>
            <p class="text-eyebrow">Host account page</p>
            <h2>PDS-owned account controls</h2>
            <p class="text-body">
              Save where users should go to manage passwords, sessions, OAuth
              grants, backups, recovery, and other host-owned controls.
            </p>
          </div>
        </div>
        <form method="POST" class="host-manage-form">
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
              Optional. Atmosphere uses `/account` on the PDS endpoint by
              default. Add an override only when this host uses another URL.
            </span>
          </label>
          <label class="profile-form-field">
            <span class="profile-form-label">Optional manifest URL</span>
            <input
              class="profile-form-input"
              type="url"
              name="manifest_url"
              value={values.manifestUrl}
              placeholder={`https://${host.host}/.well-known/atmosphere-host-dashboard.json`}
            />
            <span class="profile-form-hint">
              Optional compatibility manifest for hosts that want to declare
              deeper host-owned account-control capabilities.
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
              class="profile-form-button-secondary profile-form-button-secondary--lg"
              type="submit"
              name="action"
              value="validate"
            >
              Validate manifest
            </button>
            <button
              class="directory-register-button host-manage-save"
              type="submit"
              name="action"
              value="save"
            >
              <span>Save host account settings</span>
            </button>
          </div>
        </form>
      </section>

      {validation && <ValidationPanel validation={validation} />}

      {dashboard && (
        <section class="host-manage-current">
          <div class="host-detail-dashboard-head">
            <div>
              <p class="text-eyebrow">Current compatibility</p>
              <h2>Saved host account controls</h2>
              <p class="text-body">
                This is what users currently see on the host page and account
                router.
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
            : "Fix the errors below before Atmosphere saves compatibility."}
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
  did: string,
): ManageState {
  if (!claim) return "not-claimed";
  return claim.claimantDid === did ? "ready" : "not-owner";
}

function redirectToSignin(host: string, url: URL): Response {
  const next = `/hosts/${encodeURIComponent(host)}/manage`;
  const signin = new URL("/signin", url.origin);
  signin.searchParams.set("next", next);
  return new Response(null, {
    status: 303,
    headers: { location: `${signin.pathname}${signin.search}` },
  });
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
