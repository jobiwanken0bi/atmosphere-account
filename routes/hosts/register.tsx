import type { JSX } from "preact";
import { define, type State } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import AtmosphereHandle from "../../components/AtmosphereHandle.tsx";
import HostRegisterForm from "../../islands/HostRegisterForm.tsx";
import { bskyCdnAvatarUrl } from "../../lib/avatar.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  type AccountHostRegistrationResult,
  type HostSignupStatus,
  registerAccountHost,
} from "../../lib/account-hosts.ts";
import { inferHostNetworkLocation } from "../../lib/host-location-inference.ts";
import type { BlobRef } from "../../lib/lexicons.ts";
import { publishHostRecords } from "../../lib/host-records.ts";
import { loadSession } from "../../lib/oauth.ts";
import { getBskyProfile, uploadBlob } from "../../lib/pds.ts";
import { rejectLargeRequest } from "../../lib/security.ts";

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
    if (!ctx.state.user) return redirectToSignin(ctx.url);
    const prefill = await buildRegisterPrefill(ctx.state.user, ctx.url);
    return ctx.render(
      <RegisterHostPage
        account={buildAccountMenuProps(ctx.state)}
        values={prefill.values}
        hasOAuthSession={prefill.hasOAuthSession}
        error={null}
      />,
    );
  },

  async POST(ctx) {
    if (!ctx.state.user) return redirectToSignin(ctx.url);
    const large = rejectLargeRequest(ctx.req, MAX_HOST_REGISTER_FORM_BYTES);
    if (large) return large;
    const form = await ctx.req.formData().catch(() => null);
    const values = valuesFromForm(form);
    if (textValue(form?.get("action")) === "infer_location") {
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
      return await renderRegisterError(ctx, values, "", { status: 200 });
    }
    await refreshSubmittedInference(values);
    const profilePublication = await publishHostProfileFromForm(
      ctx.state.user,
      values,
      form,
    );
    if (!profilePublication.ok) {
      return await renderRegisterError(ctx, values, profilePublication.message);
    }
    const result = await registerAccountHost(
      {
        host: values.host,
        displayName: values.displayName,
        description: values.description,
        dataLocation: values.dataLocation,
        inferredLocation: values.inferredLocation,
        inferredLocationSource: values.inferredLocationSource,
        inferredLocationCheckedAt: values.inferredLocationCheckedAt,
        inferredLocationEvidenceJson: values.inferredLocationEvidenceJson,
        homepageUrl: values.homepageUrl,
        serviceEndpoint: values.serviceEndpoint,
        accountManagementUrl: values.accountManagementUrl,
        supportUrl: values.supportUrl,
        avatarUrl: profilePublication.avatarUrl,
        signupStatus: values.signupStatus,
        profileHandle: ctx.state.user.handle,
        bskyProfileVisible: values.bskyProfileVisible,
        serviceRecordUri: profilePublication.serviceRecordUri,
        serviceRecordCid: profilePublication.serviceRecordCid,
      },
      ctx.state.user,
    );
    if (result.ok) {
      return new Response(null, {
        status: 303,
        headers: {
          location: `/hosts/${encodeURIComponent(result.host.host)}/manage`,
        },
      });
    }
    return await renderRegisterResultError(ctx, values, result);
  },
});

function redirectToSignin(url: URL): Response {
  const signin = new URL("/signin", url.origin);
  signin.searchParams.set("next", "/hosts/register");
  return new Response(null, {
    status: 303,
    headers: { location: `${signin.pathname}${signin.search}` },
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
    serviceEndpoint: textValue(form?.get("serviceEndpoint")),
    accountManagementUrl: textValue(form?.get("accountManagementUrl")),
    supportUrl: textValue(form?.get("supportUrl")),
    signupStatus: readSignupStatus(form?.get("signupStatus")),
    avatarUrl: null,
    bskyProfileVisible: formHasValue(form, "bskyProfileVisible", "1"),
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
): Promise<{ values: RegisterValues; hasOAuthSession: boolean }> {
  const values = valuesFromUrl(url);
  const session = await loadSession(user.did).catch(() => null);
  const bsky = session
    ? await getBskyProfile(session.pdsUrl, user.did).catch(() => null)
    : null;
  if (!values.host) values.host = user.handle;
  if (!values.displayName) values.displayName = bsky?.displayName ?? "";
  if (!values.description) values.description = bsky?.description ?? "";
  if (!values.serviceEndpoint && session?.pdsUrl) {
    values.serviceEndpoint = session.pdsUrl;
  }
  if (!values.serviceEndpoint && values.homepageUrl) {
    values.serviceEndpoint = originFromUrl(values.homepageUrl);
  }
  if (!values.avatarUrl && bsky?.avatar?.ref?.$link) {
    values.avatarUrl = bskyCdnAvatarUrl(user.did, bsky.avatar.ref.$link);
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

function originFromUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

async function renderRegisterResultError(
  ctx: RegisterRenderContext,
  values: RegisterValues,
  result: Extract<AccountHostRegistrationResult, { ok: false }>,
): Promise<Response> {
  return await renderRegisterError(ctx, values, result.message, {
    status: result.reason === "already_claimed" ? 409 : 422,
  });
}

async function renderRegisterError(
  ctx: RegisterRenderContext,
  values: RegisterValues,
  error: string,
  options: { status?: number } = {},
): Promise<Response> {
  const session = ctx.state.user
    ? await loadSession(ctx.state.user.did).catch(() => null)
    : null;
  return ctx.render(
    <RegisterHostPage
      account={buildAccountMenuProps(ctx.state)}
      values={values}
      hasOAuthSession={!!session}
      error={error}
    />,
    { status: options.status ?? 422 },
  );
}

async function publishHostProfileFromForm(
  user: { did: string; handle: string },
  values: RegisterValues,
  form: FormData | null,
): Promise<
  | {
    ok: true;
    avatarUrl: string | null;
    serviceRecordUri: string | null;
    serviceRecordCid: string | null;
  }
  | { ok: false; message: string }
> {
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
      return { ok: false, message: `Host avatar upload failed: ${message}` };
    }
  }

  try {
    const serviceEndpoint = values.serviceEndpoint || session.pdsUrl;
    const records = await publishHostRecords(user, session.pdsUrl, {
      host: values.host,
      displayName: values.displayName,
      description: values.description,
      dataLocation: values.dataLocation,
      homepageUrl: values.homepageUrl,
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
    };
  }
}

function fileFromForm(
  value: FormDataEntryValue | null | undefined,
): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}

function RegisterHostPage(
  { account, values, hasOAuthSession, error }: RegisterPageProps,
) {
  const user = account.user;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <section class="signin-page-section host-register-section">
          <div class="container signin-page-container">
            <a href="/hosts" class="text-link-button">
              Back to hosts
            </a>
            <div class="glass signin-page-card host-register-card">
              <p class="text-eyebrow">Register account host</p>
              <h1 class="host-claim-title">List your account host</h1>
              <p class="text-body host-claim-copy">
                Register with the ATProto account that represents the host. This
                creates a claimed listing you can manage without emailing
                Atmosphere.
              </p>
              {user && (
                <div class="host-claim-panel host-claim-panel-ok">
                  <p class="host-claim-panel-title">
                    Registering as <AtmosphereHandle handle={user.handle} />
                  </p>
                  <p class="text-body">
                    This account will be shown as the host owner and can manage
                    the listing after registration.
                  </p>
                </div>
              )}
              {error && (
                <p class="profile-form-status profile-form-status--error">
                  {error}
                </p>
              )}
              <HostRegisterForm
                values={values}
                hasOAuthSession={hasOAuthSession}
              />
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
