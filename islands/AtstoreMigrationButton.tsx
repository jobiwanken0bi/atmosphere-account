import { useSignal } from "@preact/signals";

interface Props {
  disabled: boolean;
  initialUri: string | null;
  remoteUri?: string | null;
  issues: string[];
  preview: AtstoreMigrationPreview | null;
}

interface AtstoreMigrationPreview {
  name: string;
  slug: string;
  externalUrl: string;
  collections: string[];
  tags: string[];
  linkLabels: string[];
  screenshotCount: number;
  migratedFromAtUri: string | null;
}

type Message =
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string }
  | null;

export default function AtstoreMigrationButton(
  { disabled, initialUri, remoteUri = null, issues, preview }: Props,
) {
  const loading = useSignal(false);
  const uri = useSignal(initialUri);
  const remoteRecordUri = useSignal(remoteUri);
  const message = useSignal<Message>(
    initialUri
      ? { kind: "ok", text: "This app already has a shared ATStore listing." }
      : remoteUri
      ? {
        kind: "ok",
        text:
          "A remote ATStore listing already exists. Sync it to use the shared record here.",
      }
      : null,
  );
  const isDisabled = disabled || loading.value || !!uri.value;
  const state = uri.value
    ? migrationState("active")
    : remoteRecordUri.value
    ? migrationState("remote")
    : issues.length === 0
    ? migrationState("ready")
    : migrationStateForIssues(issues);

  const migrate = async () => {
    if (isDisabled) return;
    loading.value = true;
    message.value = null;
    try {
      const res = await fetch("/api/apps/migrate-atstore", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = await res.json().catch(() => ({})) as {
        uri?: string;
        communityProfileUri?: string;
        slug?: string;
        alreadyMigrated?: boolean;
        issues?: string[];
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        const detail = body.issues?.join(" ") || body.detail ||
          "Migration failed. Please try again.";
        message.value = { kind: "error", text: detail };
        return;
      }
      uri.value = body.uri ?? null;
      remoteRecordUri.value = null;
      message.value = {
        kind: "ok",
        text: body.alreadyMigrated
          ? "Shared app records synced and indexed."
          : "Shared app records published and indexed.",
      };
      const slug = typeof body.slug === "string" && body.slug.trim()
        ? body.slug.trim()
        : null;
      setTimeout(() => {
        if (slug) {
          globalThis.location.assign(`/apps/${encodeURIComponent(slug)}`);
        } else {
          globalThis.location.reload();
        }
      }, 650);
    } catch (err) {
      message.value = {
        kind: "error",
        text: err instanceof Error ? err.message : "Migration failed.",
      };
    } finally {
      loading.value = false;
    }
  };

  return (
    <div class="atstore-migration-actions">
      <div
        class={`atstore-migration-state atstore-migration-state--${state.tone}`}
      >
        <span>{state.label}</span>
        <p>{state.body}</p>
      </div>
      {preview && !uri.value && (
        <div class="atstore-migration-preview">
          <p class="text-eyebrow">Will publish</p>
          <dl>
            <div>
              <dt>Records</dt>
              <dd>Community app profile + ATStore listing</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{preview.name}</dd>
            </div>
            <div>
              <dt>Slug</dt>
              <dd>{preview.slug}</dd>
            </div>
            <div>
              <dt>Explore URL</dt>
              <dd>{preview.externalUrl}</dd>
            </div>
            <div>
              <dt>Collections</dt>
              <dd>
                {preview.collections.length > 0
                  ? preview.collections.join(", ")
                  : "None"}
              </dd>
            </div>
            <div>
              <dt>Tags</dt>
              <dd>
                {preview.tags.length > 0 ? preview.tags.join(", ") : "None"}
              </dd>
            </div>
            <div>
              <dt>Links/media</dt>
              <dd>
                {preview.linkLabels.length}{" "}
                link{preview.linkLabels.length === 1 ? "" : "s"},{" "}
                {preview.screenshotCount} screenshot{preview
                    .screenshotCount === 1
                  ? ""
                  : "s"}
              </dd>
            </div>
            {preview.migratedFromAtUri && (
              <div>
                <dt>Source</dt>
                <dd>{preview.migratedFromAtUri}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      <button
        type="button"
        class="profile-form-button-primary atstore-migration-button"
        disabled={isDisabled}
        onClick={migrate}
      >
        {loading.value
          ? "Migrating…"
          : uri.value
          ? "Shared listing active"
          : remoteRecordUri.value
          ? "Sync ATStore record"
          : "Migrate to shared records"}
      </button>
      {issues.length > 0 && (
        <ul class="atstore-migration-issues">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      {message.value && (
        <p
          class={`profile-form-status profile-form-status--${message.value.kind}`}
        >
          {message.value.text}
        </p>
      )}
      {uri.value && (
        <details class="atstore-migration-details">
          <summary>Technical details</summary>
          <code>{uri.value}</code>
        </details>
      )}
    </div>
  );
}

function migrationState(
  key:
    | "active"
    | "remote"
    | "ready"
    | "needs-icon"
    | "needs-website"
    | "needs-publish"
    | "blocked",
): { tone: "ok" | "attention" | "blocked"; label: string; body: string } {
  switch (key) {
    case "active":
      return {
        tone: "ok",
        label: "Shared records active",
        body: "This listing is using shared app records for discovery.",
      };
    case "remote":
      return {
        tone: "attention",
        label: "Remote shared record found",
        body:
          "Sync the existing record from this account's PDS, then publish the community app profile.",
      };
    case "ready":
      return {
        tone: "ok",
        label: "Ready to migrate",
        body:
          "This Atmosphere-only listing has the fields needed for shared records.",
      };
    case "needs-icon":
      return {
        tone: "attention",
        label: "Needs icon",
        body: "Add an app icon/avatar and publish the latest listing first.",
      };
    case "needs-website":
      return {
        tone: "attention",
        label: "Needs website or app-store link",
        body: "Add a Web, iOS, or Android destination before migrating.",
      };
    case "needs-publish":
      return {
        tone: "attention",
        label: "Needs latest publish",
        body: "Publish the latest Atmosphere app profile before migrating.",
      };
    case "blocked":
      return {
        tone: "blocked",
        label: "Migration blocked",
        body: "Fix the issues below before this app can move to ATStore.",
      };
  }
}

function migrationStateForIssues(
  issues: string[],
): ReturnType<typeof migrationState> {
  const text = issues.join(" ").toLowerCase();
  if (text.includes("icon") || text.includes("avatar")) {
    return migrationState("needs-icon");
  }
  if (
    text.includes("website") || text.includes("ios") ||
    text.includes("android") || text.includes("link")
  ) {
    return migrationState("needs-website");
  }
  if (text.includes("publish")) return migrationState("needs-publish");
  return migrationState("blocked");
}
