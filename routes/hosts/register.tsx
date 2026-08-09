import type { JSX } from "preact";
import { define, type State } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import AtmosphereHandle from "../../components/AtmosphereHandle.tsx";
import HostRegisterForm from "../../islands/HostRegisterForm.tsx";
import { bskyCdnAvatarUrl } from "../../lib/avatar.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";
import {
  type AccountHostRegistrationInput,
  type AccountHostRegistrationResult,
  type HostSignupStatus,
  registerAccountHost,
  type ValidAccountHostRegistrationInput,
  validateAccountHostRegistrationInput,
} from "../../lib/account-hosts.ts";
import { inferHostNetworkLocation } from "../../lib/host-location-inference.ts";
import type { BlobRef } from "../../lib/lexicons.ts";
import { publishHostRecords } from "../../lib/host-records.ts";
import {
  getSessionForCapabilities,
  type SessionData,
} from "../../lib/oauth.ts";
import {
  HOST_MANAGEMENT_CAPABILITIES,
  oauthReauthorizationUrl,
  oauthSigninUrl,
} from "../../lib/oauth-action.ts";
import {
  getBskyProfile,
  isPdsScopeMissingError,
  PdsBlobUploadError,
  uploadBlob,
} from "../../lib/pds.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { rejectLargeRequest } from "../../lib/security.ts";
import { enforceDurableRateLimit } from "../../lib/rate-limit.ts";
import {
  hostSelfServiceClaimPolicy,
  isLocalDevHostClaim,
} from "../../lib/host-claim-proof.ts";
import { type AppListing } from "../../lib/app-directory.ts";
import {
  establishDirectoryEntityLinkFromIntent,
} from "../../lib/directory-entity-links.ts";
import {
  appHostLinkIntentErrorMessage,
  bindAppHostLinkIntent,
  type BoundAppHostLinkIntent,
  resolveAppHostLinkSelectorIntent,
  resolveBoundAppHostLinkIntent,
  type ResolvedAppHostLinkIntent,
} from "../../lib/app-host-link-intent.ts";

interface RegisterValues {
  host: string;
  displayName: string;
  description: string;
  dataLocation: string;
  inferredLocation: string;
  inferredLocationSource: string;
  inferredLocationCheckedAt: number | null;
  inferredLocationEvidenceJson: string;
  inferenceMessage: string;
  inferenceState: "idle" | "ok" | "error";
  homepageUrl: string;
  signupUrl: string;
  serviceEndpoint: string;
  accountManagementUrl: string;
  supportUrl: string;
  signupStatus: HostSignupStatus;
  avatarUrl: string | null;
  bskyProfileVisible: boolean;
}

interface RegisterPageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  values: RegisterValues;
  hasOAuthSession: boolean;
  error: string | null;
  linkContext: HostRegistrationLinkContext | null;
}

interface HostRegistrationLinkContext {
  app: AppListing;
  relationship: "same_product" | "same_operator";
  appOwnerDid: string;
  intentToken: string;
  intent: BoundAppHostLinkIntent;
}

interface RegisterRenderContext {
  state: State;
  render(
    page: JSX.Element,
    options?: { status?: number },
  ): Response | Promise<Response>;
}

const HOST_AVATAR_MAX_BYTES = 1_000_000;
const MAX_HOST_REGISTER_FORM_BYTES = HOST_AVATAR_MAX_BYTES + 64_000;
const HOST_AVATAR_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("host registration page", err),
    );
    if (proxied) return proxied;

    const hostHint = textValue(ctx.url.searchParams.get("host"));
    if (hostSelfServiceClaimPolicy(hostHint) !== "local-dev") {
      return await redirectLegacyRegistrationToDetectedClaim(
        ctx.url.searchParams.get("link_intent"),
        hostHint,
        ctx.state.user?.did ?? null,
      );
    }
    if (!ctx.state.user) {
      return redirectToSignin(ctx.url, hostHint || "an account host");
    }
    const linkContext = await loadLinkContext(
      ctx.url.searchParams.get("link_intent"),
      hostHint,
      ctx.state.user.did,
    );
    if (linkContext instanceof Response) return linkContext;
    if (
      !isLocalDevHostClaim(hostHint) &&
      !await getSessionForCapabilities(
        ctx.state.user.did,
        HOST_MANAGEMENT_CAPABILITIES,
        { quiet: true },
      )
    ) {
      return redirectToAuthorization(
        ctx.url,
        HOST_MANAGEMENT_CAPABILITIES,
        hostHint || linkContext?.app.name || "an account host",
      );
    }
    const prefill = await buildRegisterPrefill(
      ctx.state.user,
      ctx.url,
      linkContext?.relationship === "same_product" ? linkContext.app : null,
    );
    return ctx.render(
      <RegisterHostPage
        account={buildAccountMenuProps(ctx.state)}
        values={prefill.values}
        hasOAuthSession={prefill.hasOAuthSession}
        error={null}
        linkContext={linkContext}
      />,
    );
  },

  async POST(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("host registration update", err),
    );
    if (proxied) return proxied;

    if (!ctx.state.user) {
      return redirectToSignin(
        ctx.url,
        textValue(ctx.url.searchParams.get("host")) || "an account host",
      );
    }
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "host-registration",
      capacity: 12,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_HOST_REGISTER_FORM_BYTES);
    if (large) return large;
    const form = await ctx.req.formData().catch(() => null);
    const values = valuesFromForm(form);
    const requestedLinkIntent = textValue(form?.get("linkIntent"));
    if (hostSelfServiceClaimPolicy(values.host) !== "local-dev") {
      return await redirectLegacyRegistrationToDetectedClaim(
        requestedLinkIntent || null,
        values.host,
        ctx.state.user.did,
      );
    }
    const linkContext = await loadLinkContext(
      requestedLinkIntent || null,
      values.host,
      ctx.state.user.did,
    );
    if (linkContext instanceof Response) return linkContext;
    const action = textValue(form?.get("action"));
    const requiredCapabilities = HOST_MANAGEMENT_CAPABILITIES;
    const session = await getSessionForCapabilities(
      ctx.state.user.did,
      requiredCapabilities,
      { quiet: true },
    );
    const localDevFixture = isLocalDevHostClaim(values.host);
    if (!session && !localDevFixture) {
      return redirectToAuthorization(
        ctx.url,
        requiredCapabilities,
        values.displayName || values.host || "an account host",
      );
    }
    if (!session && fileFromForm(form?.get("avatarUpload"))) {
      return await renderRegisterError(
        ctx,
        values,
        "Local .test fixtures need a real OAuth-backed account before they can upload an avatar.",
        {},
        linkContext,
      );
    }
    if (action === "infer_location") {
      const inferred = await inferHostNetworkLocation({
        host: values.host,
        serviceEndpoint: values.serviceEndpoint,
      });
      if (inferred.ok) {
        applyInferenceResult(values, inferred);
      } else {
        clearInferenceValues(values);
        values.inferenceState = "error";
        values.inferenceMessage = inferred.message;
      }
      return await renderRegisterError(
        ctx,
        values,
        "",
        { status: 200 },
        linkContext,
      );
    }
    await refreshSubmittedInference(values);
    const registrationInput = registrationInputFromValues(
      values,
      ctx.state.user.handle,
    );
    const validation = validateAccountHostRegistrationInput(
      registrationInput,
      ctx.state.user,
    );
    if (!validation.ok) {
      return await renderRegisterError(
        ctx,
        values,
        validation.message,
        {},
        linkContext,
      );
    }
    const profilePublication = await publishHostProfileFromForm(
      ctx.state.user,
      session,
      validation.input,
      form,
    );
    if (!profilePublication.ok) {
      if (profilePublication.reauthorization) {
        return redirectToAuthorization(
          ctx.url,
          requiredCapabilities,
          values.displayName || values.host,
          true,
        );
      }
      return await renderRegisterError(
        ctx,
        values,
        profilePublication.message,
        {},
        linkContext,
      );
    }
    const result = await registerAccountHost(
      {
        ...validation.input,
        avatarUrl: profilePublication.avatarUrl,
        serviceRecordUri: profilePublication.serviceRecordUri,
        serviceRecordCid: profilePublication.serviceRecordCid,
      },
      ctx.state.user,
    );
    if (result.ok) {
      if (linkContext) {
        const linked = await establishDirectoryEntityLinkFromIntent({
          intent: linkContext.intent,
          currentHostDid: ctx.state.user.did,
        }).catch(() => ({ ok: false as const }));
        if (!linked.ok) {
          const retry = new URLSearchParams({
            link_intent: linkContext.intentToken,
            linkError: "1",
          });
          return new Response(null, {
            status: 303,
            headers: {
              location: `/hosts/${
                encodeURIComponent(result.host.host)
              }/claim?${retry}`,
            },
          });
        }
        return new Response(null, {
          status: 303,
          headers: {
            location: `/hosts/${
              encodeURIComponent(result.host.host)
            }/manage?linked=1`,
          },
        });
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: `/hosts/${encodeURIComponent(result.host.host)}/manage`,
        },
      });
    }
    return await renderRegisterResultError(ctx, values, result, linkContext);
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Host registration is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function redirectToSignin(url: URL, name: string): Response {
  return redirectToAuthorization(url, HOST_MANAGEMENT_CAPABILITIES, name);
}

function redirectToAuthorization(
  url: URL,
  capabilities: readonly ("host" | "media")[],
  name: string,
  force = false,
): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: hostRegistrationAuthorizationHref(
        url,
        capabilities,
        name,
        force,
      ),
    },
  });
}

export function hostRegistrationAuthorizationHref(
  url: URL,
  capabilities: readonly ("host" | "media")[],
  name: string,
  force = false,
): string {
  const buildUrl = force ? oauthReauthorizationUrl : oauthSigninUrl;
  return buildUrl({
    next: `${url.pathname}${url.search}`,
    action: "host_manage",
    capabilities,
    name,
  });
}

async function redirectLegacyRegistrationToDetectedClaim(
  token: string | null,
  host: string,
  currentDid: string | null,
): Promise<Response> {
  const search = new URLSearchParams();
  if (host.trim()) search.set("domain", host.trim());
  if (token?.trim()) {
    if (!currentDid) {
      return new Response(
        "Return to the app owner account and start the host connection again.",
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const selector = await resolveAppHostLinkSelectorIntent(token, currentDid);
    if (!selector.ok) {
      return new Response(appHostLinkIntentErrorMessage(selector.reason), {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    search.set("link_intent", selector.value.token);
  }
  return new Response(null, {
    status: 303,
    headers: { location: `/hosts/claim${search.size ? `?${search}` : ""}` },
  });
}

function emptyValues(): RegisterValues {
  return {
    host: "",
    displayName: "",
    description: "",
    dataLocation: "",
    inferredLocation: "",
    inferredLocationSource: "",
    inferredLocationCheckedAt: null,
    inferredLocationEvidenceJson: "",
    inferenceMessage: "",
    inferenceState: "idle",
    homepageUrl: "",
    signupUrl: "",
    serviceEndpoint: "",
    accountManagementUrl: "",
    supportUrl: "",
    signupStatus: "unknown",
    avatarUrl: null,
    bskyProfileVisible: true,
  };
}

function valuesFromUrl(url: URL): RegisterValues {
  const values = emptyValues();
  values.host = textValue(url.searchParams.get("host"));
  values.displayName = textValue(url.searchParams.get("displayName"));
  values.description = textValue(url.searchParams.get("description"));
  values.dataLocation = textValue(url.searchParams.get("dataLocation"));
  values.inferredLocation = textValue(
    url.searchParams.get("inferredLocation"),
  );
  values.inferredLocationSource = textValue(
    url.searchParams.get("inferredLocationSource"),
  );
  values.inferredLocationCheckedAt = numberValue(
    url.searchParams.get("inferredLocationCheckedAt"),
  );
  values.inferredLocationEvidenceJson = textValue(
    url.searchParams.get("inferredLocationEvidenceJson"),
  );
  values.inferenceMessage = textValue(url.searchParams.get("inferenceMessage"));
  values.inferenceState = readInferenceState(
    url.searchParams.get("inferenceState"),
  );
  values.homepageUrl = textValue(url.searchParams.get("homepageUrl"));
  values.signupUrl = textValue(url.searchParams.get("signupUrl"));
  values.serviceEndpoint = textValue(url.searchParams.get("serviceEndpoint"));
  values.accountManagementUrl = textValue(
    url.searchParams.get("accountManagementUrl"),
  );
  values.supportUrl = textValue(url.searchParams.get("supportUrl"));
  values.signupStatus = readSignupStatus(url.searchParams.get("signupStatus"));
  values.avatarUrl = textValue(url.searchParams.get("avatarUrl")) || null;
  values.bskyProfileVisible =
    url.searchParams.get("bskyProfileVisible") !== "0";
  return values;
}

function valuesFromForm(form: FormData | null): RegisterValues {
  return {
    host: textValue(form?.get("host")),
    displayName: textValue(form?.get("displayName")),
    description: textValue(form?.get("description")),
    dataLocation: textValue(form?.get("dataLocation")),
    inferredLocation: textValue(form?.get("inferredLocation")),
    inferredLocationSource: textValue(form?.get("inferredLocationSource")),
    inferredLocationCheckedAt: numberValue(
      form?.get("inferredLocationCheckedAt"),
    ),
    inferredLocationEvidenceJson: textValue(
      form?.get("inferredLocationEvidenceJson"),
    ),
    inferenceMessage: "",
    inferenceState: "idle",
    homepageUrl: textValue(form?.get("homepageUrl")),
    signupUrl: textValue(form?.get("signupUrl")),
    serviceEndpoint: textValue(form?.get("serviceEndpoint")),
    accountManagementUrl: textValue(form?.get("accountManagementUrl")),
    supportUrl: textValue(form?.get("supportUrl")),
    signupStatus: readSignupStatus(form?.get("signupStatus")),
    avatarUrl: null,
    bskyProfileVisible: formHasValue(form, "bskyProfileVisible", "1"),
  };
}

function registrationInputFromValues(
  values: RegisterValues,
  profileHandle: string,
): AccountHostRegistrationInput {
  return {
    host: values.host,
    displayName: values.displayName,
    description: values.description,
    dataLocation: values.dataLocation,
    inferredLocation: values.inferredLocation,
    inferredLocationSource: values.inferredLocationSource,
    inferredLocationCheckedAt: values.inferredLocationCheckedAt,
    inferredLocationEvidenceJson: values.inferredLocationEvidenceJson,
    homepageUrl: values.homepageUrl,
    signupUrl: values.signupUrl,
    serviceEndpoint: values.serviceEndpoint,
    accountManagementUrl: values.accountManagementUrl,
    supportUrl: values.supportUrl,
    signupStatus: values.signupStatus,
    profileHandle,
    bskyProfileVisible: values.bskyProfileVisible,
  };
}

function textValue(value: FormDataEntryValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(
  value: FormDataEntryValue | null | undefined,
): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readSignupStatus(
  value: FormDataEntryValue | null | undefined,
): HostSignupStatus {
  return value === "open" || value === "invite_required" ||
      value === "closed" || value === "unknown"
    ? value
    : "unknown";
}

function readInferenceState(
  value: FormDataEntryValue | null | undefined,
): RegisterValues["inferenceState"] {
  return value === "ok" || value === "error" ? value : "idle";
}

function formHasValue(
  form: FormData | null,
  name: string,
  value: string,
): boolean {
  return form?.getAll(name).some((entry) => entry === value) ?? false;
}

async function buildRegisterPrefill(
  user: { did: string; handle: string },
  url: URL,
  linkedApp: AppListing | null = null,
): Promise<{ values: RegisterValues; hasOAuthSession: boolean }> {
  const values = valuesFromUrl(url);
  const session = await getSessionForCapabilities(
    user.did,
    HOST_MANAGEMENT_CAPABILITIES,
    { quiet: true },
  ).catch(() => null);
  const bsky = session
    ? await getBskyProfile(session.pdsUrl, user.did).catch(() => null)
    : null;
  /**
   * An app that already has an ATStore/registry profile can "also" register
   * as a host — reuse that profile's name, description, homepage, and avatar
   * so they only fill in the host-specific fields. The app's own profile
   * takes precedence over the Bluesky profile.
   */
  const appProfile = await getProfileByDid(user.did).catch(() => null);

  if (!values.displayName) {
    values.displayName = linkedApp?.name || appProfile?.name ||
      bsky?.displayName || "";
  }
  if (!values.description) {
    values.description = linkedApp?.description || appProfile?.description ||
      bsky?.description || "";
  }
  if (!values.homepageUrl && (linkedApp?.primaryUrl || appProfile?.mainLink)) {
    values.homepageUrl = linkedApp?.primaryUrl || appProfile?.mainLink || "";
  }
  if (!values.avatarUrl) {
    if (linkedApp?.iconUrl) {
      values.avatarUrl = linkedApp.iconUrl;
    } else if (appProfile?.avatarCid) {
      values.avatarUrl = `/api/registry/avatar/${encodeURIComponent(user.did)}`;
    } else if (bsky?.avatar?.ref?.$link) {
      values.avatarUrl = bskyCdnAvatarUrl(user.did, bsky.avatar.ref.$link);
    }
  }
  return { values, hasOAuthSession: !!session };
}

async function refreshSubmittedInference(
  values: RegisterValues,
): Promise<void> {
  if (!values.inferredLocation) return;
  const inferred = await inferHostNetworkLocation({
    host: values.host,
    serviceEndpoint: values.serviceEndpoint,
  }).catch(() => null);
  if (inferred?.ok) {
    applyInferenceResult(values, inferred);
  } else {
    clearInferenceValues(values);
  }
}

function applyInferenceResult(
  values: RegisterValues,
  inferred: Awaited<ReturnType<typeof inferHostNetworkLocation>> & { ok: true },
): void {
  values.inferredLocation = inferred.label;
  values.inferredLocationSource = inferred.source;
  values.inferredLocationCheckedAt = inferred.checkedAt;
  values.inferredLocationEvidenceJson = JSON.stringify(inferred.evidence);
  values.inferenceState = "ok";
  values.inferenceMessage = inferred.detail;
}

function clearInferenceValues(values: RegisterValues): void {
  values.inferredLocation = "";
  values.inferredLocationSource = "";
  values.inferredLocationCheckedAt = null;
  values.inferredLocationEvidenceJson = "";
}

async function renderRegisterResultError(
  ctx: RegisterRenderContext,
  values: RegisterValues,
  result: Extract<AccountHostRegistrationResult, { ok: false }>,
  linkContext: HostRegistrationLinkContext | null,
): Promise<Response> {
  return await renderRegisterError(ctx, values, result.message, {
    status: result.reason === "already_claimed" ? 409 : 422,
  }, linkContext);
}

async function renderRegisterError(
  ctx: RegisterRenderContext,
  values: RegisterValues,
  error: string,
  options: { status?: number } = {},
  linkContext: HostRegistrationLinkContext | null = null,
): Promise<Response> {
  const session = ctx.state.user
    ? await getSessionForCapabilities(
      ctx.state.user.did,
      HOST_MANAGEMENT_CAPABILITIES,
      { quiet: true },
    ).catch(() => null)
    : null;
  return ctx.render(
    <RegisterHostPage
      account={buildAccountMenuProps(ctx.state)}
      values={values}
      hasOAuthSession={!!session}
      error={error}
      linkContext={linkContext}
    />,
    { status: options.status ?? 422 },
  );
}

async function publishHostProfileFromForm(
  user: { did: string; handle: string },
  session: SessionData | null,
  values: ValidAccountHostRegistrationInput,
  form: FormData | null,
): Promise<
  | {
    ok: true;
    avatarUrl: string | null;
    serviceRecordUri: string | null;
    serviceRecordCid: string | null;
  }
  | { ok: false; message: string; reauthorization?: boolean }
> {
  const avatarFile = fileFromForm(form?.get("avatarUpload"));
  if (!session) {
    return {
      ok: true,
      avatarUrl: values.avatarUrl,
      serviceRecordUri: null,
      serviceRecordCid: null,
    };
  }
  const bsky = await getBskyProfile(session.pdsUrl, user.did).catch(() => null);
  let avatar: BlobRef | undefined = bsky?.avatar ?? undefined;
  let avatarUrl = avatar?.ref?.$link
    ? bskyCdnAvatarUrl(user.did, avatar.ref.$link)
    : null;

  if (avatarFile) {
    if (!HOST_AVATAR_MIME_TYPES.has(avatarFile.type)) {
      return { ok: false, message: "Host avatar must be PNG, JPEG, or WebP." };
    }
    if (avatarFile.size > HOST_AVATAR_MAX_BYTES) {
      return { ok: false, message: "Host avatar must be under 1 MB." };
    }
    try {
      const bytes = new Uint8Array(await avatarFile.arrayBuffer());
      avatar = await uploadBlob(
        user.did,
        session.pdsUrl,
        bytes,
        avatarFile.type,
      );
      avatarUrl = `/api/atproto/blob?did=${encodeURIComponent(user.did)}&cid=${
        encodeURIComponent(avatar.ref.$link)
      }`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Host avatar upload failed: ${message}`,
        reauthorization: isHostAuthorizationError(err),
      };
    }
  }

  try {
    if (!values.serviceEndpoint) {
      return {
        ok: false,
        message: "Enter the PDS service endpoint operated by this host.",
      };
    }
    const serviceEndpoint = values.serviceEndpoint;
    const records = await publishHostRecords(user, session.pdsUrl, {
      host: values.host,
      displayName: values.displayName,
      description: values.description,
      dataLocation: values.dataLocation,
      homepageUrl: values.homepageUrl,
      signupUrl: values.signupUrl,
      serviceEndpoint,
      accountManagementUrl: values.accountManagementUrl || null,
      supportUrl: values.supportUrl,
      signupStatus: values.signupStatus,
      avatar,
      createdAt: new Date().toISOString(),
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

function RegisterHostPage(
  { account, values, hasOAuthSession, error, linkContext }: RegisterPageProps,
) {
  const user = account.user;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <main
          id="main-content"
          class="signin-page-section host-register-section"
        >
          <div class="container signin-page-container">
            <a
              href={linkContext
                ? `/apps/manage/host?app=${
                  encodeURIComponent(linkContext.app.id)
                }`
                : "/hosts"}
              class="text-link-button"
            >
              {linkContext ? "Back to app hosting" : "Back to hosts"}
            </a>
            <div class="glass signin-page-card host-register-card">
              <p class="text-eyebrow">Local development fixture</p>
              <h1 class="host-claim-title">
                {linkContext
                  ? `Register a .test host for ${linkContext.app.name}`
                  : "Register a .test account host"}
              </h1>
              <p class="text-body host-claim-copy">
                This form is only available for local <code>.test</code>{" "}
                fixtures while development mode is enabled. Production hosts
                must be detected from relay activity and verified with a
                temporary DNS record.
              </p>
              <div class="host-claim-panel">
                <p class="host-claim-panel-title">Running a production PDS?</p>
                <p class="text-body">
                  Find the exact PDS domain in the detected-host flow, then add
                  the temporary TXT record shown there with your DNS provider.
                </p>
                <a class="text-link-button" href="/hosts/claim">
                  Find and claim a detected PDS
                </a>
              </div>
              {user && (
                <div class="host-claim-panel host-claim-panel-ok">
                  <p class="host-claim-panel-title">
                    Registering as <AtmosphereHandle handle={user.handle} />
                  </p>
                  <p class="text-body">
                    This account will be shown as the host owner and can manage
                    the listing after registration once the host proof checks
                    pass.
                  </p>
                </div>
              )}
              {linkContext && (
                <a
                  class="text-link-button"
                  href={`/oauth/add-account?next=${
                    encodeURIComponent(
                      `/hosts/register?link_intent=${
                        encodeURIComponent(linkContext.intentToken)
                      }&host=${encodeURIComponent(values.host)}`,
                    )
                  }`}
                >
                  Use another account to register this host
                </a>
              )}
              {error && (
                <p class="profile-form-status profile-form-status--error">
                  {error}
                </p>
              )}
              <HostRegisterForm
                values={values}
                hasOAuthSession={hasOAuthSession}
                linkingApp={linkContext
                  ? {
                    id: linkContext.app.id,
                    name: linkContext.app.name,
                    relationship: linkContext.relationship,
                    intentToken: linkContext.intentToken,
                  }
                  : null}
              />
            </div>
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

async function loadLinkContext(
  token: string | null,
  expectedHost: string,
  currentDid: string,
): Promise<HostRegistrationLinkContext | null | Response> {
  if (!token?.trim()) return null;
  let resolved = await resolveBoundAppHostLinkIntent(token, expectedHost);
  if (!resolved.ok && resolved.reason === "wrong_stage") {
    resolved = await bindAppHostLinkIntent(
      token,
      expectedHost,
      currentDid,
    );
  }
  if (!resolved.ok) {
    return new Response(appHostLinkIntentErrorMessage(resolved.reason), {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
  return contextFromResolvedIntent(resolved.value);
}

function contextFromResolvedIntent(
  value: ResolvedAppHostLinkIntent<BoundAppHostLinkIntent>,
): HostRegistrationLinkContext {
  return {
    app: value.app,
    relationship: value.intent.relationship,
    appOwnerDid: value.intent.appOwnerDid,
    intentToken: value.token,
    intent: value.intent,
  };
}
