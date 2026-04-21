import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  APP_SUBCATEGORIES,
  CATEGORIES,
  type Category,
  type LinkEntry,
} from "../lib/lexicons.ts";
import {
  type AtmosphereService,
  getAtmosphereService,
  visibleAtmosphereServices,
} from "../lib/atmosphere-links.ts";
import { BSKY_CLIENTS, getBskyClient } from "../lib/bsky-clients.ts";
import { useT } from "../i18n/mod.ts";
import BskyClientPickerModal from "./BskyClientPickerModal.tsx";
import LinkUrlOverrideModal from "./LinkUrlOverrideModal.tsx";

interface ExistingProfile {
  name: string;
  description: string;
  /** All categories that apply to the project (always non-empty). The
   *  first item is the primary, used for sort/grouping in lists. */
  categories: string[];
  subcategories: string[];
  links: LinkEntry[];
  avatar: { ref: string; mime: string } | null;
}

interface Props {
  did: string;
  handle: string;
  initial: ExistingProfile | null;
  /** Direct image URL to show in the avatar slot before any registry record
   *  exists (e.g. the user's PDS-hosted Bluesky avatar). */
  initialAvatarUrl?: string | null;
  /** Whether the registry currently has a published record for this user.
   *  Drives the live/inactive status pill at the top of the form. */
  initialPublished: boolean;
  /** Handle stored on the registry row (may differ from the live PDS
   *  handle if the user has changed it but not republished). Used to
   *  link to the public profile from the action row. */
  publicProfileHandle?: string | null;
}

interface BlobRefShape {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

interface CustomLinkRow {
  label: string;
  url: string;
}

/** Collapse the saved `LinkEntry[]` into the form's working state. */
function splitInitialLinks(links: LinkEntry[]): {
  bskyClientIds: string[];
  tangledOverride: string;
  tangledOn: boolean;
  supperOverride: string;
  supperOn: boolean;
  website: string;
  custom: CustomLinkRow[];
} {
  const bskyClientIds: string[] = [];
  let tangledOverride = "";
  let tangledOn = false;
  let supperOverride = "";
  let supperOn = false;
  let website = "";
  const custom: CustomLinkRow[] = [];

  for (const e of links) {
    switch (e.kind) {
      case "bsky":
        if (e.clientId) bskyClientIds.push(e.clientId);
        break;
      case "tangled":
        tangledOn = true;
        if (e.url) tangledOverride = e.url;
        break;
      case "supper":
        supperOn = true;
        if (e.url) supperOverride = e.url;
        break;
      case "website":
        if (e.url) website = e.url;
        break;
      case "other":
        if (e.url) custom.push({ label: e.label ?? "", url: e.url });
        break;
    }
  }
  return {
    bskyClientIds,
    tangledOverride,
    tangledOn,
    supperOverride,
    supperOn,
    website,
    custom,
  };
}

export default function CreateProfileForm(
  {
    did,
    handle,
    initial,
    initialAvatarUrl,
    initialPublished,
    publicProfileHandle,
  }: Props,
) {
  const t = useT();
  const tForm = t.forms.profile;
  const tAtmos = tForm.atmosphereLinks;
  const tCustom = tForm.customLinks;
  const tWebsite = tForm.website;
  const tManage = t.explore.manage;
  /** Live registry status. Flips on save (-> true) and delete (-> false). */
  const published = useSignal<boolean>(initialPublished);

  const initialSplit = splitInitialLinks(initial?.links ?? []);

  const name = useSignal(initial?.name ?? "");
  const description = useSignal(initial?.description ?? "");
  const categories = useSignal<string[]>(
    initial?.categories?.length ? initial.categories : ["app"],
  );
  const subcategories = useSignal<string[]>(initial?.subcategories ?? []);

  /* ---------------- Atmosphere link signals ----------------------------- */
  /**
   * Bluesky toggle is "on" iff there's at least one selected client. The
   * gear opens the modal where users add/remove clients; the row's icon
   * stack mirrors the selection.
   */
  const bskyClientIds = useSignal<string[]>(initialSplit.bskyClientIds);
  const bskyPickerOpen = useSignal<boolean>(false);

  const tangledOn = useSignal<boolean>(initialSplit.tangledOn);
  const tangledUrl = useSignal<string>(initialSplit.tangledOverride);

  const supperOn = useSignal<boolean>(initialSplit.supperOn);
  const supperUrl = useSignal<string>(initialSplit.supperOverride);

  /** Which simple-atmosphere row currently has its URL-override modal
   *  open, if any. `null` = no modal open. */
  const urlOverrideOpen = useSignal<"tangled" | "supper" | null>(null);

  const website = useSignal<string>(initialSplit.website);
  const customLinks = useSignal<CustomLinkRow[]>(initialSplit.custom);

  const avatarKeep = useSignal<BlobRefShape | null>(null);
  /**
   * Preview URL precedence:
   *   1. Locally-picked file (set in `onAvatarChange`).
   *   2. An explicit `initialAvatarUrl` from the server — used by the
   *      Bluesky-prefill path to point at the public bsky CDN; we
   *      check this first because in the prefill case `initial.avatar`
   *      is also set (so it can carry through the BlobRef on Save) but
   *      the registry-side proxy doesn't have anything to serve yet.
   *   3. Existing registry record → cached server proxy.
   *   4. Empty placeholder.
   */
  const avatarPreview = useSignal<string | null>(
    initialAvatarUrl ??
      (initial?.avatar
        ? `/api/registry/avatar/${encodeURIComponent(did)}`
        : null),
  );
  const avatarFile = useSignal<File | null>(null);
  const avatarRemoved = useSignal(false);

  const submitting = useSignal(false);
  const deleting = useSignal(false);
  const message = useSignal<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (!initial?.avatar) return;
    avatarKeep.value = {
      $type: "blob",
      ref: { $link: initial.avatar.ref },
      mimeType: initial.avatar.mime,
      size: 0,
    };
  }, []);

  const toggleSub = (key: string) => {
    const current = subcategories.value;
    if (current.includes(key)) {
      subcategories.value = current.filter((k) => k !== key);
    } else {
      if (current.length >= 5) return;
      subcategories.value = [...current, key];
    }
  };

  const toggleCategory = (key: string) => {
    const current = categories.value;
    if (current.includes(key)) {
      if (current.length <= 1) return;
      categories.value = current.filter((k) => k !== key);
    } else {
      if (current.length >= 4) return;
      categories.value = [...current, key];
    }
  };

  const showSubcategories = categories.value.includes("app");

  /* ---------------- Custom link helpers --------------------------------- */
  const addCustomLink = () => {
    if (customLinks.value.length >= 8) return;
    customLinks.value = [...customLinks.value, { label: "", url: "" }];
  };
  const removeCustomLink = (i: number) => {
    customLinks.value = customLinks.value.filter((_, idx) => idx !== i);
  };
  const updateCustomLink = (i: number, patch: Partial<CustomLinkRow>) => {
    customLinks.value = customLinks.value.map((row, idx) =>
      idx === i ? { ...row, ...patch } : row
    );
  };

  /* ---------------- Atmosphere helpers ---------------------------------- */
  const onBskyConfirm = (ids: string[]) => {
    bskyClientIds.value = ids;
    bskyPickerOpen.value = false;
  };

  const onAvatarChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      message.value = { kind: "error", text: tForm.avatarTooLarge };
      input.value = "";
      return;
    }
    avatarFile.value = file;
    avatarRemoved.value = false;
    avatarPreview.value = URL.createObjectURL(file);
  };

  const removeAvatar = () => {
    avatarFile.value = null;
    avatarKeep.value = null;
    avatarRemoved.value = true;
    avatarPreview.value = null;
  };

  /**
   * Reduce the form's working state into the lexicon-shaped LinkEntry[]
   * we send to the API. Order matters — we put atmosphere links first
   * (in service order, with the user's chosen primary bsky client at the
   * head), then website, then custom links in display order.
   */
  const buildLinksPayload = (): LinkEntry[] => {
    const out: LinkEntry[] = [];

    for (const id of bskyClientIds.value) {
      out.push({ kind: "bsky", clientId: id });
    }
    if (tangledOn.value) {
      const entry: LinkEntry = { kind: "tangled" };
      const u = tangledUrl.value.trim();
      if (u) entry.url = u;
      out.push(entry);
    }
    if (supperOn.value) {
      const entry: LinkEntry = { kind: "supper" };
      const u = supperUrl.value.trim();
      if (u) entry.url = u;
      out.push(entry);
    }
    const w = website.value.trim();
    if (w) out.push({ kind: "website", url: w });
    for (const row of customLinks.value) {
      const url = row.url.trim();
      const label = row.label.trim();
      if (!url || !label) continue;
      out.push({ kind: "other", url, label });
    }
    return out;
  };

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    if (submitting.value) return;
    if (categories.value.length === 0) {
      message.value = { kind: "error", text: tForm.categoryRequired };
      return;
    }
    submitting.value = true;
    message.value = null;

    try {
      const cleanedLinks = buildLinksPayload();

      const payload: Record<string, unknown> = {
        name: name.value.trim(),
        description: description.value.trim(),
        categories: categories.value,
        subcategories: showSubcategories ? subcategories.value : [],
        links: cleanedLinks,
      };
      if (avatarFile.value) {
        payload.avatarUpload = {
          dataBase64: await readFileAsBase64(avatarFile.value),
          mimeType: avatarFile.value.type,
        };
      } else if (!avatarRemoved.value && avatarKeep.value) {
        payload.avatar = avatarKeep.value;
      } else {
        payload.avatar = null;
      }

      const res = await fetch("/api/registry/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      published.value = true;
      message.value = { kind: "ok", text: tManage.savedToast };
    } catch (err) {
      message.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    } finally {
      submitting.value = false;
    }
  };

  const onDelete = async () => {
    if (!confirm(tForm.confirmDelete)) return;
    deleting.value = true;
    message.value = null;
    try {
      const res = await fetch("/api/registry/profile", { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      published.value = false;
      message.value = { kind: "ok", text: tManage.deletedToast };
    } catch (err) {
      message.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    } finally {
      deleting.value = false;
    }
  };

  return (
    <form class="profile-form glass" onSubmit={onSubmit}>
      <div
        class={`profile-status profile-status--${
          published.value ? "live" : "inactive"
        }`}
        role="status"
        aria-live="polite"
      >
        <span class="profile-status-dot" aria-hidden="true" />
        <span class="profile-status-text">
          <span class="profile-status-title">
            {published.value
              ? tManage.statusLiveTitle
              : tManage.statusInactiveTitle}
          </span>
          <span class="profile-status-sub">
            {published.value
              ? tManage.statusLiveSub
              : tManage.statusInactiveSub}
          </span>
        </span>
      </div>

      <div class="profile-form-row">
        <div class="profile-form-avatar">
          {avatarPreview.value
            ? (
              <img
                src={avatarPreview.value}
                alt=""
                class="profile-form-avatar-img"
                onError={() => {
                  // If the source URL fails (e.g. PDS slow / CDN miss),
                  // collapse to the empty-slot placeholder rather than
                  // leaving the browser's broken-image glyph.
                  avatarPreview.value = null;
                }}
              />
            )
            : (
              <div class="profile-form-avatar-placeholder" aria-hidden="true">
                +
              </div>
            )}
          <label class="profile-form-button-secondary">
            {avatarPreview.value ? tForm.avatarReplace : tForm.avatarLabel}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={onAvatarChange}
            />
          </label>
          {avatarPreview.value && (
            <button
              type="button"
              class="profile-form-button-link"
              onClick={removeAvatar}
            >
              {tForm.avatarRemove}
            </button>
          )}
          <p class="profile-form-hint">{tForm.avatarHint}</p>
        </div>

        <div class="profile-form-fields">
          <div class="profile-form-handle-row">
            <span class="profile-form-label">{tForm.handleLabel}</span>
            <span class="profile-form-handle-value">@{handle}</span>
          </div>

          <label class="profile-form-field">
            <span class="profile-form-label">
              {tForm.nameLabel} <em class="profile-form-required">*</em>
            </span>
            <input
              type="text"
              required
              maxLength={60}
              placeholder={tForm.namePlaceholder}
              value={name.value}
              onInput={(e) =>
                name.value = (e.currentTarget as HTMLInputElement).value}
              class="profile-form-input"
            />
          </label>

          <label class="profile-form-field">
            <span class="profile-form-label">
              {tForm.descriptionLabel} <em class="profile-form-required">*</em>
            </span>
            <textarea
              required
              maxLength={500}
              rows={3}
              placeholder={tForm.descriptionPlaceholder}
              value={description.value}
              onInput={(e) =>
                description.value =
                  (e.currentTarget as HTMLTextAreaElement).value}
              class="profile-form-input"
            />
          </label>

          <fieldset class="profile-form-field">
            <legend class="profile-form-label">{tForm.categoryLabel}</legend>
            <div class="profile-form-chips" role="group">
              {CATEGORIES.map((c: Category) => {
                const selected = categories.value.includes(c);
                return (
                  <label
                    key={c}
                    class={`profile-form-chip ${
                      selected ? "is-selected" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="categories"
                      value={c}
                      checked={selected}
                      onChange={() => toggleCategory(c)}
                    />
                    <span>{t.categories[c]}</span>
                  </label>
                );
              })}
            </div>
            <p class="profile-form-hint">{tForm.categoryHint}</p>
          </fieldset>

          {showSubcategories && (
            <fieldset class="profile-form-field">
              <legend class="profile-form-label">
                {tForm.subcategoriesLabel}
              </legend>
              <div class="profile-form-chips">
                {APP_SUBCATEGORIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    class={`profile-form-chip ${
                      subcategories.value.includes(s) ? "is-selected" : ""
                    }`}
                    onClick={() => toggleSub(s)}
                  >
                    {t.subcategories[s]}
                  </button>
                ))}
              </div>
              <p class="profile-form-hint">{tForm.subcategoriesHint}</p>
            </fieldset>
          )}

          {/* ---------------- Atmosphere links ----------------------- */}
          <fieldset class="profile-form-field">
            <legend class="profile-form-label">{tAtmos.sectionLabel}</legend>
            <p class="profile-form-hint">{tAtmos.sectionHint(handle)}</p>

            <div class="atmosphere-toggles">
              {visibleAtmosphereServices().map((svc) =>
                renderAtmosphereRow(svc, {
                  bskyClientIds,
                  bskyPickerOpen,
                  tangledOn,
                  tangledUrl,
                  supperOn,
                  supperUrl,
                  urlOverrideOpen,
                  tAtmos,
                  handle,
                })
              )}
            </div>
          </fieldset>

          {/* ---------------- Website ------------------------------- */}
          <label class="profile-form-field">
            <span class="profile-form-label">{tWebsite.sectionLabel}</span>
            <input
              type="url"
              class="profile-form-input"
              placeholder={tWebsite.placeholder}
              value={website.value}
              onInput={(e) =>
                website.value = (e.currentTarget as HTMLInputElement).value}
            />
          </label>

          {/* ---------------- Custom links -------------------------- */}
          <fieldset class="profile-form-field">
            <legend class="profile-form-label">{tCustom.sectionLabel}</legend>
            <div class="custom-link-list">
              {customLinks.value.map((row, i) => (
                <div class="custom-link-row" key={i}>
                  <input
                    type="text"
                    class="profile-form-input custom-link-label"
                    placeholder={tCustom.labelPlaceholder}
                    value={row.label}
                    maxLength={64}
                    onInput={(e) =>
                      updateCustomLink(i, {
                        label: (e.currentTarget as HTMLInputElement).value,
                      })}
                  />
                  <input
                    type="url"
                    class="profile-form-input custom-link-url"
                    placeholder={tCustom.urlPlaceholder}
                    value={row.url}
                    onInput={(e) =>
                      updateCustomLink(i, {
                        url: (e.currentTarget as HTMLInputElement).value,
                      })}
                  />
                  <button
                    type="button"
                    class="custom-link-remove"
                    aria-label={tCustom.removeAriaLabel}
                    onClick={() => removeCustomLink(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              class="profile-form-button-secondary custom-link-add"
              onClick={addCustomLink}
              disabled={customLinks.value.length >= 8}
            >
              + {tCustom.addButton}
            </button>
          </fieldset>
        </div>
      </div>

      <div class="profile-form-actions">
        <button
          type="submit"
          disabled={submitting.value}
          class="profile-form-button-primary"
        >
          {submitting.value
            ? tManage.savingButton
            : published.value
            ? tManage.updateButton
            : tManage.publishButton}
        </button>
        {/*
          "View public profile" sits between Update and Remove so it
          reads as the natural read-only complement to the destructive
          actions. We only render it when the user has actually
          published (live in registry) AND we know their public handle —
          otherwise the link would 404. We use `published.value` so the
          link appears immediately after a first-time publish without a
          page reload.
         */}
        {published.value && publicProfileHandle && (
          <a
            href={`/explore/${encodeURIComponent(publicProfileHandle)}`}
            class="profile-form-button-secondary profile-form-button-secondary--lg"
          >
            {tManage.viewPublicProfile}
          </a>
        )}
        {published.value && (
          <button
            type="button"
            disabled={deleting.value}
            onClick={onDelete}
            class="profile-form-button-danger"
          >
            {deleting.value ? tManage.deletingButton : tManage.deleteButton}
          </button>
        )}
        {message.value && (
          <span
            class={`profile-form-status profile-form-status--${message.value.kind}`}
            role="status"
          >
            {message.value.text}
          </span>
        )}
      </div>

      <BskyClientPickerModal
        open={bskyPickerOpen.value}
        selected={bskyClientIds.value}
        onConfirm={onBskyConfirm}
        onClose={() => (bskyPickerOpen.value = false)}
      />

      {/* URL-override modal, shared by Tangled and Supper. Only one is
          open at a time so we render a single instance and switch its
          props on `urlOverrideOpen`. */}
      {(() => {
        const which = urlOverrideOpen.value;
        const svc = which ? getAtmosphereService(which) : null;
        if (!which || !svc) return null;
        const sig = which === "tangled" ? tangledUrl : supperUrl;
        return (
          <LinkUrlOverrideModal
            open
            serviceName={svc.name}
            defaultUrl={svc.defaultUrl(handle)}
            value={sig.value}
            onConfirm={(next) => {
              sig.value = next;
              urlOverrideOpen.value = null;
            }}
            onClose={() => (urlOverrideOpen.value = null)}
            labels={t.forms.profile.linkOverride}
          />
        );
      })()}
    </form>
  );
}

/* ----------------------- Atmosphere row renderer ------------------------ */

interface AtmosphereRowCtx {
  bskyClientIds: { value: string[] };
  bskyPickerOpen: { value: boolean };
  tangledOn: { value: boolean };
  tangledUrl: { value: string };
  supperOn: { value: boolean };
  supperUrl: { value: string };
  urlOverrideOpen: { value: "tangled" | "supper" | null };
  tAtmos: ReturnType<typeof useT>["forms"]["profile"]["atmosphereLinks"];
  handle: string;
}

function renderAtmosphereRow(svc: AtmosphereService, ctx: AtmosphereRowCtx) {
  if (svc.id === "bsky") return <BskyAtmosphereRow ctx={ctx} svc={svc} />;
  if (svc.id === "tangled") {
    return (
      <SimpleAtmosphereRow
        ctx={ctx}
        svc={svc}
        on={ctx.tangledOn}
        url={ctx.tangledUrl}
        modalKey="tangled"
      />
    );
  }
  if (svc.id === "supper") {
    return (
      <SimpleAtmosphereRow
        ctx={ctx}
        svc={svc}
        on={ctx.supperOn}
        url={ctx.supperUrl}
        modalKey="supper"
      />
    );
  }
  return null;
}

interface BskyRowProps {
  ctx: AtmosphereRowCtx;
  svc: AtmosphereService;
}

function BskyAtmosphereRow({ ctx, svc }: BskyRowProps) {
  const ids = ctx.bskyClientIds.value;
  const isOn = ids.length > 0;
  const primaryClient = isOn ? getBskyClient(ids[0]) : null;
  const stack = ids.slice(0, 4);

  return (
    <div class={`atmosphere-row ${isOn ? "is-on" : ""}`}>
      <label class="atmosphere-row-toggle">
        <input
          type="checkbox"
          checked={isOn}
          onChange={(e) => {
            const next = (e.currentTarget as HTMLInputElement).checked;
            if (next) {
              if (ctx.bskyClientIds.value.length === 0) {
                ctx.bskyPickerOpen.value = true;
              }
            } else {
              ctx.bskyClientIds.value = [];
            }
          }}
        />
        <span class="atmosphere-toggle-track" aria-hidden="true">
          <span class="atmosphere-toggle-thumb" />
        </span>
      </label>
      <div class="atmosphere-row-body">
        <div class="atmosphere-row-icon">
          {ids.length > 1
            ? (
              <span class="atmosphere-icon-stack">
                {stack.map((id, i) => {
                  const c = getBskyClient(id);
                  return (
                    <img
                      key={id}
                      src={c.iconUrl}
                      alt=""
                      class="atmosphere-icon-stack-item"
                      style={{
                        zIndex: stack.length - i,
                        marginLeft: i === 0 ? 0 : "-10px",
                      }}
                      loading="lazy"
                      decoding="async"
                    />
                  );
                })}
              </span>
            )
            : (
              <img
                src={primaryClient?.iconUrl ?? svc.iconUrl ?? ""}
                alt=""
                class="atmosphere-icon"
                loading="lazy"
                decoding="async"
              />
            )}
        </div>
        <div class="atmosphere-row-meta">
          <span class="atmosphere-row-name">
            {primaryClient?.name ?? svc.name}
          </span>
          {/* Only render the secondary line when there's something
              meaningful to show (i.e. extra clients selected). The
              service description ("Decentralised social network") is
              redundant next to the brand name and was just noise. */}
          {ids.length > 1 && (
            <span class="atmosphere-row-desc">
              {`${
                BSKY_CLIENTS.find((c) => c.id === ids[0])?.name ?? svc.name
              } + ${ids.length - 1} more`}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        class="atmosphere-row-gear"
        onClick={() => (ctx.bskyPickerOpen.value = true)}
        aria-label={ctx.tAtmos.configureBskyLabel}
      >
        ⚙
      </button>
    </div>
  );
}

interface SimpleRowProps {
  ctx: AtmosphereRowCtx;
  svc: AtmosphereService;
  on: { value: boolean };
  url: { value: string };
  /** Identifier for the URL-override modal so the row can open it. */
  modalKey: "tangled" | "supper";
}

function SimpleAtmosphereRow(
  { svc, on, url, ctx, modalKey }: SimpleRowProps,
) {
  /**
   * The row is "using a custom URL" iff there's an override and it
   * differs from the handle-derived default. We compare against the
   * default to avoid showing the badge when the user typed in the
   * exact default URL by hand.
   */
  const usingOverride = !!url.value && url.value !== svc.defaultUrl(ctx.handle);

  return (
    <div class={`atmosphere-row ${on.value ? "is-on" : ""}`}>
      <label class="atmosphere-row-toggle">
        <input
          type="checkbox"
          checked={on.value}
          onChange={(e) =>
            (on.value = (e.currentTarget as HTMLInputElement).checked)}
        />
        <span class="atmosphere-toggle-track" aria-hidden="true">
          <span class="atmosphere-toggle-thumb" />
        </span>
      </label>
      <div class="atmosphere-row-body">
        <div class="atmosphere-row-icon">
          {svc.iconUrl
            ? (
              <img
                src={svc.iconUrl}
                alt=""
                class="atmosphere-icon"
                loading="lazy"
                decoding="async"
              />
            )
            : <span class="atmosphere-icon-glyph">{svc.name.slice(0, 1)}</span>}
        </div>
        <div class="atmosphere-row-meta">
          <span class="atmosphere-row-name">{svc.name}</span>
          <span class="atmosphere-row-desc">
            {usingOverride ? ctx.tAtmos.usingOverride : svc.description}
          </span>
        </div>
      </div>
      {svc.allowUrlOverride && (
        <button
          type="button"
          class="atmosphere-row-gear"
          onClick={() => (ctx.urlOverrideOpen.value = modalKey)}
          aria-label={ctx.tAtmos.configureUrlLabel}
        >
          ⚙
        </button>
      )}
    </div>
  );
}
