import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  type AccountIndicator,
  APP_SUBCATEGORIES,
  type LexiconInterop,
  type LinkEntry,
} from "../lib/lexicons.ts";
import {
  type AtmosphereService,
  getAtmosphereService,
  visibleAtmosphereServices,
} from "../lib/atmosphere-links.ts";
import { bskyCdnAvatarUrl } from "../lib/avatar.ts";
import { BSKY_CLIENTS, getBskyClient } from "../lib/bsky-clients.ts";
import { useT } from "../i18n/mod.ts";
import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import BskyClientPickerModal from "./BskyClientPickerModal.tsx";
import LinkUrlOverrideModal from "./LinkUrlOverrideModal.tsx";
import {
  collectionFallbackLabel,
  isCollectionNsid,
} from "../lib/collection-nsid.ts";
import type { CollectionSuggestion } from "../lib/collection-catalog.ts";

interface ExistingProfile {
  name: string;
  description: string;
  /** Primary destination URL for the profile. May be null on legacy
   *  records that pre-date the field; in that case the form auto-promotes
   *  any existing `kind: website` link into this slot on first load
   *  (the chosen migration path was "treat existing website as Main
   *  Link"). */
  mainLink: string | null;
  /** Optional App Store / Android links rendered as platform buttons. */
  iosLink: string | null;
  androidLink: string | null;
  /** All categories that apply to the project (always non-empty). The
   *  first item is the primary, used for sort/grouping in lists. */
  categories: string[];
  subcategories: string[];
  links: LinkEntry[];
  lexicons?: LexiconInterop;
  accountIndicators?: AccountIndicator[];
  screenshots: Array<{
    ref: string;
    mime: string;
    size: number;
    previewUrl?: string;
  }>;
  avatar: { ref: string; mime: string; size?: number } | null;
  /** Optional project banner image. Rendered at the top of the project
   *  page and used as the OG / share preview when the page is posted. */
  banner: { ref: string; mime: string; size?: number } | null;
  /** Legacy developer-facing SVG icon. Kept invisibly on unrelated saves. */
  icon:
    | {
      ref: string;
      mime: string;
    }
    | null;
  /** Legacy black-and-white companion to `icon`. */
  iconBw:
    | {
      ref: string;
      mime: string;
    }
    | null;
  /** Only granted legacy icons are preserved; revoked icons stay removed. */
  iconAccessStatus: "requested" | "granted" | "denied" | null;
  iconAccessEmail: string | null;
  iconAccessDeniedReason: string | null;
}

interface Props {
  did: string;
  handle: string;
  initial: ExistingProfile | null;
  /** Direct image URL to show in the avatar slot before any registry record
   *  exists (e.g. the user's PDS-hosted Bluesky avatar). */
  initialAvatarUrl?: string | null;
  /** Direct image URL to show for non-registry banner blobs. */
  initialBannerUrl?: string | null;
  /** Whether the registry currently has a published record for this user.
   *  Drives the live/inactive status pill at the top of the form. */
  initialPublished: boolean;
  /** Searchable collections detected or declared across the directory. */
  collectionSuggestions?: CollectionSuggestion[];
  /** Handle stored on the registry row (may differ from the live PDS
   *  handle if the user has changed it but not republished). Used to
   *  link to the public profile from the action row. */
  publicProfileHandle?: string | null;
  /** Directory identifier used to continue into verified host connection. */
  managedAppIdentifier?: string | null;
  /** Publish a new ATStore record even when this DID already owns an app. */
  createNewListing?: boolean;
  /** Exact shared record managed by this form, used for targeted removal. */
  atstoreListingUri?: string | null;
}

interface BlobRefShape {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

interface ScreenshotDraft {
  id: string;
  previewUrl: string;
  blob: BlobRefShape | null;
  file: File | null;
  mimeType: string | null;
}

const SCREENSHOT_MAX_COUNT = 4;
const SCREENSHOT_MAX_BYTES = 5_000_000;
const SCREENSHOT_ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const COLLECTION_MAX_COUNT = 64;
const COLLECTION_VISIBLE_STEP = 20;

type PublishedSearchStatus = "idle" | "loading" | "ready" | "unavailable";

function canSearchPublishedCollections(value: string): boolean {
  return value.length >= 2 && value.length <= 256 &&
    /^[A-Za-z0-9.-]+$/.test(value);
}

function updateCollectionSelection(
  current: string[],
  id: string,
  selected: boolean,
): string[] {
  if (!selected) return current.filter((value) => value !== id);
  if (!isCollectionNsid(id)) return current;
  if (current.includes(id) || current.length >= COLLECTION_MAX_COUNT) {
    return current;
  }
  return [...current, id];
}

interface CollectionMatrixProps {
  suggestions: CollectionSuggestion[];
  writes: string[];
  reads: string[];
  onWritesChange: (next: string[]) => void;
  onReadsChange: (next: string[]) => void;
}

function CollectionMatrix(props: CollectionMatrixProps) {
  const query = useSignal("");
  const remoteQuery = useSignal("");
  const remoteSuggestions = useSignal<CollectionSuggestion[]>([]);
  const rememberedPublished = useSignal<CollectionSuggestion[]>([]);
  const remoteStatus = useSignal<PublishedSearchStatus>("idle");
  const visibleLimit = useSignal(COLLECTION_VISIBLE_STEP);

  useEffect(() => {
    const value = query.value.trim();
    visibleLimit.value = COLLECTION_VISIBLE_STEP;
    remoteSuggestions.value = [];
    if (!canSearchPublishedCollections(value)) {
      remoteQuery.value = value;
      remoteStatus.value = "idle";
      return;
    }

    const controller = new AbortController();
    const timer = globalThis.setTimeout(async () => {
      remoteQuery.value = value;
      remoteStatus.value = "loading";
      try {
        const response = await fetch(
          `/api/apps/collection-search?q=${encodeURIComponent(value)}`,
          {
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as {
          suggestions?: unknown;
          unavailable?: unknown;
        };
        if (controller.signal.aborted) return;

        const suggestions: CollectionSuggestion[] = [];
        if (Array.isArray(body.suggestions)) {
          for (const value of body.suggestions) {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
              continue;
            }
            const row = value as Record<string, unknown>;
            if (typeof row.id !== "string" || !isCollectionNsid(row.id)) {
              continue;
            }
            suggestions.push({
              id: row.id,
              label: typeof row.label === "string" && row.label.trim()
                ? row.label
                : collectionFallbackLabel(row.id),
              description: typeof row.description === "string"
                ? row.description
                : null,
              common: false,
              detected: false,
              writesCount: 0,
              readsCount: 0,
              published: true,
              ...(typeof row.catalogUrl === "string"
                ? { catalogUrl: row.catalogUrl }
                : {}),
            });
          }
        }
        remoteSuggestions.value = suggestions;
        const remembered = new Map(
          rememberedPublished.value.map((item) => [item.id, item]),
        );
        for (const item of suggestions) {
          remembered.delete(item.id);
          remembered.set(item.id, item);
        }
        const selected = new Set([...props.writes, ...props.reads]);
        const rememberedRows = [...remembered.values()];
        const selectedRows = rememberedRows.filter((item) =>
          selected.has(item.id)
        );
        const unselectedCapacity = Math.max(0, 200 - selectedRows.length);
        rememberedPublished.value = [
          ...selectedRows,
          ...rememberedRows.filter((item) => !selected.has(item.id)).slice(
            -unselectedCapacity,
          ),
        ];
        remoteStatus.value = body.unavailable === true
          ? "unavailable"
          : "ready";
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("Published collection search failed:", error);
        remoteSuggestions.value = [];
        remoteStatus.value = "unavailable";
      }
    }, 275);

    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [query.value]);

  const rawQuery = query.value.trim();
  const currentRemoteSuggestions = remoteQuery.value === rawQuery
    ? remoteSuggestions.value
    : [];
  const selectedIds = new Set([...props.writes, ...props.reads]);
  const rows = new Map(props.suggestions.map((item) => [item.id, item]));
  for (const item of rememberedPublished.value) {
    if (!selectedIds.has(item.id)) continue;
    const existing = rows.get(item.id);
    rows.set(
      item.id,
      existing
        ? {
          ...item,
          ...existing,
          published: true,
          catalogUrl: item.catalogUrl ?? existing.catalogUrl,
        }
        : item,
    );
  }
  for (const item of currentRemoteSuggestions) {
    const existing = rows.get(item.id);
    rows.set(
      item.id,
      existing
        ? {
          ...item,
          ...existing,
          published: true,
          catalogUrl: item.catalogUrl ?? existing.catalogUrl,
        }
        : item,
    );
  }
  for (const id of [...props.writes, ...props.reads]) {
    if (rows.has(id)) continue;
    rows.set(id, {
      id,
      label: collectionFallbackLabel(id),
      description: null,
      common: false,
      detected: false,
      writesCount: 0,
      readsCount: 0,
    });
  }

  const normalizedQuery = rawQuery.toLowerCase();
  const matched = [...rows.values()].filter((item) =>
    !normalizedQuery || item.id.toLowerCase().includes(normalizedQuery) ||
    item.label.toLowerCase().includes(normalizedQuery) ||
    item.description?.toLowerCase().includes(normalizedQuery)
  );
  matched.sort((a, b) =>
    Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id)) ||
    Number(b.detected) - Number(a.detected) ||
    (b.writesCount + b.readsCount) - (a.writesCount + a.readsCount) ||
    Number(b.common) - Number(a.common) ||
    a.id.localeCompare(b.id)
  );
  const customSuggestion: CollectionSuggestion | null =
    isCollectionNsid(rawQuery) && !rows.has(rawQuery)
      ? {
        id: rawQuery,
        label: "Custom collection",
        description: "Use this exact collection NSID in your declaration.",
        common: false,
        detected: false,
        writesCount: 0,
        readsCount: 0,
      }
      : null;
  const allVisibleRows = [
    ...(customSuggestion ? [customSuggestion] : []),
    ...matched,
  ];
  const visibleRows = allVisibleRows.slice(0, visibleLimit.value);
  const remainingRows = Math.max(0, allVisibleRows.length - visibleRows.length);
  const publishedSearchPending = canSearchPublishedCollections(rawQuery) &&
    (remoteQuery.value !== rawQuery || remoteStatus.value === "loading");
  const publishedSearchUnavailable = remoteQuery.value === rawQuery &&
    remoteStatus.value === "unavailable";
  const publishedSearchNeedsHelp = rawQuery.length >= 2 &&
    !canSearchPublishedCollections(rawQuery);

  const toggle = (role: "writes" | "reads", id: string) => {
    const values = role === "writes" ? props.writes : props.reads;
    const next = updateCollectionSelection(values, id, !values.includes(id));
    if (role === "writes") props.onWritesChange(next);
    else props.onReadsChange(next);
  };

  const selectAllShown = (role: "writes" | "reads") => {
    let next = role === "writes" ? props.writes : props.reads;
    for (const row of visibleRows) {
      next = updateCollectionSelection(next, row.id, true);
    }
    if (role === "writes") props.onWritesChange(next);
    else props.onReadsChange(next);
  };

  return (
    <div class="collection-picker">
      <div class="collection-picker-search-wrap">
        <span class="collection-picker-search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          class="profile-form-input collection-picker-search"
          placeholder="Search one keyword or paste a collection NSID…"
          value={query.value}
          onInput={(event) =>
            query.value = (event.currentTarget as HTMLInputElement).value}
          aria-label="Search record collections"
        />
        {(props.writes.length > 0 || props.reads.length > 0) && (
          <span class="collection-picker-counts">
            {props.writes.length} writes · {props.reads.length} reads
          </span>
        )}
      </div>

      {(publishedSearchPending || publishedSearchUnavailable ||
        publishedSearchNeedsHelp) && (
        <div
          class={`collection-picker-search-state ${
            publishedSearchUnavailable ? "is-unavailable" : ""
          } ${publishedSearchNeedsHelp ? "is-help" : ""}`}
          role="status"
        >
          {publishedSearchNeedsHelp
            ? "Search with one keyword or an NSID fragment, without spaces."
            : publishedSearchUnavailable
            ? "Published catalog search is unavailable. Local suggestions and direct NSID entry still work."
            : "Searching published record collections…"}
        </div>
      )}

      {(props.writes.length >= COLLECTION_MAX_COUNT ||
        props.reads.length >= COLLECTION_MAX_COUNT) && (
        <div class="collection-picker-search-state is-help" role="status">
          {props.writes.length >= COLLECTION_MAX_COUNT
            ? `Writes has reached the ${COLLECTION_MAX_COUNT}-collection limit.`
            : ""}
          {props.writes.length >= COLLECTION_MAX_COUNT &&
              props.reads.length >= COLLECTION_MAX_COUNT
            ? " "
            : ""}
          {props.reads.length >= COLLECTION_MAX_COUNT
            ? `Reads has reached the ${COLLECTION_MAX_COUNT}-collection limit.`
            : ""}
        </div>
      )}

      <div class="collection-picker-table" role="group">
        <div class="collection-picker-head" aria-hidden="true">
          <span>Collection</span>
          <span>Writes</span>
          <span>Reads</span>
        </div>
        <div class="collection-picker-results">
          {visibleRows.map((item) => {
            const writes = props.writes.includes(item.id);
            const reads = props.reads.includes(item.id);
            const writesAtLimit = !writes &&
              props.writes.length >= COLLECTION_MAX_COUNT;
            const readsAtLimit = !reads &&
              props.reads.length >= COLLECTION_MAX_COUNT;
            const source = item.detected
              ? "Detected on this account"
              : item.writesCount + item.readsCount > 0
              ? `${item.writesCount + item.readsCount} read/write declaration${
                item.writesCount + item.readsCount === 1 ? "" : "s"
              }`
              : item.common
              ? "Common collection"
              : item.published
              ? "Published record schema"
              : "Custom collection";
            return (
              <div class="collection-picker-row" key={item.id}>
                <div class="collection-picker-identity">
                  <span class="collection-picker-name">{item.label}</span>
                  <code>{item.id}</code>
                  <span class="collection-picker-meta">
                    {source}
                    {item.description ? ` · ${item.description}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  class={`collection-role-toggle ${
                    writes ? "is-selected" : ""
                  }`}
                  aria-pressed={writes}
                  disabled={writesAtLimit}
                  aria-label={`${writes ? "Remove" : "Add"} ${item.id} ${
                    writes ? "from" : "to"
                  } writes`}
                  onClick={() => toggle("writes", item.id)}
                >
                  <span aria-hidden="true">{writes ? "✓" : "+"}</span>
                </button>
                <button
                  type="button"
                  class={`collection-role-toggle ${reads ? "is-selected" : ""}`}
                  aria-pressed={reads}
                  disabled={readsAtLimit}
                  aria-label={`${reads ? "Remove" : "Add"} ${item.id} ${
                    reads ? "from" : "to"
                  } reads`}
                  onClick={() => toggle("reads", item.id)}
                >
                  <span aria-hidden="true">{reads ? "✓" : "+"}</span>
                </button>
              </div>
            );
          })}
          {visibleRows.length === 0 && !publishedSearchPending && (
            <div class="collection-picker-empty">
              {rawQuery
                ? "No match. Enter a full collection NSID such as com.example.records.item to add it."
                : "No collection suggestions are available yet."}
            </div>
          )}
          {visibleRows.length === 0 && publishedSearchPending && (
            <div class="collection-picker-empty">
              Searching the published schema catalog…
            </div>
          )}
        </div>
      </div>

      {remainingRows > 0 && (
        <button
          type="button"
          class="collection-picker-show-more"
          onClick={() => visibleLimit.value += COLLECTION_VISIBLE_STEP}
        >
          Show {Math.min(COLLECTION_VISIBLE_STEP, remainingRows)} more of{" "}
          {allVisibleRows.length}
        </button>
      )}

      {visibleRows.length > 1 && (
        <div class="collection-picker-bulk-actions">
          <button
            type="button"
            disabled={props.writes.length >= COLLECTION_MAX_COUNT}
            onClick={() => selectAllShown("writes")}
          >
            Select all shown as writes
          </button>
          <button
            type="button"
            disabled={props.reads.length >= COLLECTION_MAX_COUNT}
            onClick={() => selectAllShown("reads")}
          >
            Select all shown as reads
          </button>
        </div>
      )}
      <p class="profile-form-hint collection-picker-explainer">
        Search by one keyword or an NSID fragment. Results include published
        record schemas indexed by{" "}
        <a href="https://lexicon.garden/" target="_blank" rel="noreferrer">
          Lexicon Garden
        </a>, plus collections detected or declared in Atmosphere. These are
        suggestions: an app’s reads and writes cannot be inferred reliably, so
        you stay in control of the declaration.
      </p>
    </div>
  );
}

function screenshotMimeForFile(file: File): string | null {
  if (SCREENSHOT_ACCEPT.includes(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  return null;
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

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function responseErrorText(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await res.json().catch(() => null) as
      | { detail?: string; error?: string; issues?: string[] }
      | null;
    return body?.issues?.join(" ") || body?.detail || body?.error ||
      `HTTP ${res.status}`;
  }
  return await res.text().catch(() => "") || `HTTP ${res.status}`;
}

interface CustomLinkRow {
  label: string;
  url: string;
}

function linesFromAccountIndicators(
  values: AccountIndicator[] | undefined,
): string {
  return (values ?? []).map((value) =>
    value.rkey ? `${value.collection}/${value.rkey}` : value.collection
  ).join("\n");
}

function parseAccountIndicatorLines(value: string): AccountIndicator[] {
  const seen = new Set<string>();
  const out: AccountIndicator[] = [];
  for (const raw of value.split(/\r?\n/)) {
    const item = raw.trim();
    if (!item) continue;
    const slash = item.lastIndexOf("/");
    const collection = slash > 0 ? item.slice(0, slash).trim() : item;
    const rkey = slash > 0 ? item.slice(slash + 1).trim() : "";
    if (!collection) continue;
    const key = `${collection}/${rkey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ collection, ...(rkey ? { rkey } : {}) });
    if (out.length >= 64) break;
  }
  return out;
}

/**
 * Collapse the saved `LinkEntry[]` into the form's working state.
 *
 * `legacyWebsite` is the URL of any pre-mainLink `kind: website` entry.
 * Callers use it to auto-promote that URL into the new top-level
 * `mainLink` field when the existing record doesn't have one yet (the
 * "treat existing website as Main Link" migration). Current records no
 * longer emit website links because mainLink renders as the Web button.
 */
function splitInitialLinks(links: LinkEntry[]): {
  bskyClientIds: string[];
  tangledOverride: string;
  tangledOn: boolean;
  supperOverride: string;
  supperOn: boolean;
  iosLink: string;
  androidLink: string;
  legacyWebsite: string;
  custom: CustomLinkRow[];
} {
  const bskyClientIds: string[] = [];
  let tangledOverride = "";
  let tangledOn = false;
  let supperOverride = "";
  let supperOn = false;
  let iosLink = "";
  let androidLink = "";
  let legacyWebsite = "";
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
        if (e.url && !legacyWebsite) legacyWebsite = e.url;
        break;
      case "other":
        if (e.url) {
          const normalizedLabel = (e.label ?? "").trim().toLowerCase();
          if (
            !iosLink &&
            (normalizedLabel === "ios" || normalizedLabel === "iphone")
          ) {
            iosLink = e.url;
          } else if (
            !androidLink &&
            (normalizedLabel === "android" || normalizedLabel === "google play")
          ) {
            androidLink = e.url;
          } else {
            custom.push({ label: e.label ?? "", url: e.url });
          }
        }
        break;
    }
  }
  return {
    bskyClientIds,
    tangledOverride,
    tangledOn,
    supperOverride,
    supperOn,
    iosLink,
    androidLink,
    legacyWebsite,
    custom,
  };
}

export default function CreateProfileForm(
  {
    did,
    handle,
    initial,
    initialAvatarUrl,
    initialBannerUrl,
    initialPublished,
    publicProfileHandle,
    managedAppIdentifier,
    createNewListing = false,
    atstoreListingUri = null,
    collectionSuggestions = [],
  }: Props,
) {
  const t = useT();
  const tForm = t.forms.profile;
  const tAtmos = tForm.atmosphereLinks;
  const tCustom = tForm.customLinks;
  const tMainLink = tForm.mainLink;
  const tAppLinks = tForm.appLinks;
  const tScreenshots = tForm.screenshots;
  const tManage = t.explore.manage;
  /** Live registry status. Flips on save (-> true) and delete (-> false). */
  const published = useSignal<boolean>(initialPublished);

  const initialSplit = splitInitialLinks(initial?.links ?? []);

  const name = useSignal(initial?.name ?? "");
  const description = useSignal(initial?.description ?? "");
  /**
   * Auto-promote the legacy `website` URL into the new mainLink slot
   * for records that pre-date mainLink. Current saves no longer emit
   * `website` entries, so this is a one-way cleanup path.
   */
  const promoteLegacyWebsite = !initial?.mainLink &&
    !!initialSplit.legacyWebsite;
  const mainLink = useSignal<string>(
    initial?.mainLink ??
      (promoteLegacyWebsite ? initialSplit.legacyWebsite : ""),
  );
  const iosLink = useSignal<string>(initial?.iosLink ?? initialSplit.iosLink);
  const androidLink = useSignal<string>(
    initial?.androidLink ?? initialSplit.androidLink,
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

  const customLinks = useSignal<CustomLinkRow[]>(initialSplit.custom);
  const lexiconsProduced = useSignal<string[]>(
    initial?.lexicons?.produces ?? [],
  );
  const lexiconsConsumed = useSignal<string[]>(
    initial?.lexicons?.consumes ?? [],
  );
  const accountIndicators = useSignal<string>(
    linesFromAccountIndicators(initial?.accountIndicators),
  );
  const accountIndicatorsPlaceholder =
    "com.example.app.settings\ncom.example.app.profile/self";

  const initialAvatarBlob: BlobRefShape | null = initial?.avatar
    ? {
      $type: "blob",
      ref: { $link: initial.avatar.ref },
      mimeType: initial.avatar.mime,
      size: initial.avatar.size ?? 0,
    }
    : null;
  const avatarKeep = useSignal<BlobRefShape | null>(initialAvatarBlob);
  /**
   * Preview URL precedence:
   *   1. Locally-picked file (set in `onAvatarChange`).
   *   2. An explicit `initialAvatarUrl` from the server — used by the
   *      Bluesky-prefill path to point at the public bsky CDN; we
   *      check this first because in the prefill case `initial.avatar`
   *      is also set (so it can carry through the BlobRef on Save) but
   *      the registry-side proxy doesn't have anything to serve yet.
   *   3. Existing registry record → Bluesky CDN avatar by did/cid.
   *   4. Empty placeholder.
   */
  const avatarPreview = useSignal<string | null>(
    initialAvatarUrl ??
      (initial?.avatar ? bskyCdnAvatarUrl(did, initial.avatar.ref) : null),
  );
  const avatarFile = useSignal<File | null>(null);
  const avatarRemoved = useSignal(false);

  /**
   * Project banner. Mirrors the avatar contract — `bannerKeep` carries
   * the existing BlobRef so saves without a new file pass it through;
   * `bannerFile` holds a freshly-picked File before upload; `bannerPreview`
   * is the URL the form renders. Cleared via `removeBanner`.
   */
  const bannerKeep = useSignal<BlobRefShape | null>(null);
  const bannerPreview = useSignal<string | null>(
    initialBannerUrl ??
      (initial?.banner
        ? `/api/registry/banner/${encodeURIComponent(did)}?v=${
          encodeURIComponent(initial.banner.ref)
        }`
        : null),
  );
  const bannerFile = useSignal<File | null>(null);
  const bannerRemoved = useSignal(false);

  const screenshots = useSignal<ScreenshotDraft[]>(
    (initial?.screenshots ?? []).slice(0, SCREENSHOT_MAX_COUNT).map((s, i) => ({
      id: `existing-${s.ref}-${i}`,
      previewUrl: s.previewUrl ??
        `/api/registry/screenshot/${encodeURIComponent(did)}/${i}`,
      blob: {
        $type: "blob",
        ref: { $link: s.ref },
        mimeType: s.mime,
        size: s.size,
      },
      file: null,
      mimeType: s.mime,
    })),
  );
  const screenshotMessage = useSignal<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const screenshotDragActive = useSignal(false);

  /**
   * Developer SVG controls were retired from this dashboard. Preserve old
   * verified references invisibly so changing an unrelated field does not
   * silently delete an existing external developer asset.
   */
  const legacyIcon = initial?.iconAccessStatus === "granted" && initial.icon
    ? {
      $type: "blob" as const,
      ref: { $link: initial.icon.ref },
      mimeType: initial.icon.mime,
      size: 0,
    }
    : null;
  const legacyIconBw = initial?.iconAccessStatus === "granted" && initial.iconBw
    ? {
      $type: "blob" as const,
      ref: { $link: initial.iconBw.ref },
      mimeType: initial.iconBw.mime,
      size: 0,
    }
    : null;

  const submitting = useSignal(false);
  const deleting = useSignal(false);
  const hydrated = useSignal(false);
  const message = useSignal<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );
  const publicPath = useSignal<string | null>(
    publicProfileHandle
      ? `/apps/${encodeURIComponent(publicProfileHandle)}`
      : null,
  );
  const hostAppIdentifier = useSignal<string | null>(
    managedAppIdentifier ?? publicProfileHandle ?? null,
  );
  const currentAtstoreListingUri = useSignal<string | null>(
    atstoreListingUri,
  );
  const createNewListingPending = useSignal(createNewListing);

  useEffect(() => {
    hydrated.value = true;
  }, []);

  useEffect(() => {
    if (!initial?.banner) return;
    bannerKeep.value = {
      $type: "blob",
      ref: { $link: initial.banner.ref },
      mimeType: initial.banner.mime,
      size: initial.banner.size ?? 0,
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

  const onBannerChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (
      file.type !== "image/png" &&
      file.type !== "image/jpeg" &&
      file.type !== "image/webp"
    ) {
      message.value = { kind: "error", text: tForm.bannerInvalidType };
      input.value = "";
      return;
    }
    if (file.size > 3_000_000) {
      message.value = { kind: "error", text: tForm.bannerTooLarge };
      input.value = "";
      return;
    }
    bannerFile.value = file;
    bannerRemoved.value = false;
    bannerPreview.value = URL.createObjectURL(file);
  };

  const removeBanner = () => {
    bannerFile.value = null;
    bannerKeep.value = null;
    bannerRemoved.value = true;
    bannerPreview.value = null;
  };

  const addScreenshotFiles = (files: File[]) => {
    if (files.length === 0) return;
    const available = SCREENSHOT_MAX_COUNT - screenshots.value.length;
    if (available <= 0) {
      screenshotMessage.value = {
        kind: "error",
        text: tScreenshots.maxReached,
      };
      return;
    }
    const next: ScreenshotDraft[] = [];
    let skipped = 0;
    for (const file of files.slice(0, available)) {
      const mimeType = screenshotMimeForFile(file);
      if (!mimeType) {
        skipped++;
        continue;
      }
      if (file.size > SCREENSHOT_MAX_BYTES) {
        skipped++;
        continue;
      }
      next.push({
        id: `new-${crypto.randomUUID()}`,
        previewUrl: URL.createObjectURL(file),
        blob: null,
        file,
        mimeType,
      });
    }
    skipped += Math.max(0, files.length - available);
    if (next.length > 0) {
      screenshots.value = [...screenshots.value, ...next];
      screenshotMessage.value = {
        kind: skipped > 0 ? "error" : "ok",
        text: skipped > 0
          ? tScreenshots.partialAdded(next.length, skipped)
          : tScreenshots.added(next.length),
      };
    } else {
      screenshotMessage.value = {
        kind: "error",
        text: tScreenshots.noneAdded,
      };
    }
  };

  const onScreenshotsChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    addScreenshotFiles(Array.from(input.files ?? []));
    input.value = "";
  };

  const onScreenshotsDrop = (event: DragEvent) => {
    event.preventDefault();
    screenshotDragActive.value = false;
    addScreenshotFiles(Array.from(event.dataTransfer?.files ?? []));
  };

  const removeScreenshot = (id: string) => {
    screenshots.value = screenshots.value.filter((s) => s.id !== id);
    screenshotMessage.value = null;
  };

  /**
   * Reduce the form's working state into the lexicon-shaped LinkEntry[]
   * we send to the API. Order matters for the public profile button row
   * — atmosphere links first (in service order, with the user's chosen
   * primary bsky client at the head), then custom links in display order.
   *
   * The Main Link is NOT in this array — it lives at top level on the
   * record (and on the API payload) and drives the listing card target.
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
    const trimmedMainLink = mainLink.value.trim();
    const trimmedIosLink = iosLink.value.trim();
    const trimmedAndroidLink = androidLink.value.trim();
    const hasAppIcon = !!avatarFile.value || !!avatarKeep.value;
    if (!hasAppIcon) {
      message.value = { kind: "error", text: tForm.avatarRequiredForAtstore };
      return;
    }
    if (!trimmedMainLink && !trimmedIosLink && !trimmedAndroidLink) {
      message.value = { kind: "error", text: tMainLink.required };
      return;
    }
    /**
     * Cheap http(s) URL guard. The server validates again with proper
     * URL parsing — this is just so the user doesn't have to round-trip
     * to find out they typed "yourapp.com" without a protocol.
     */
    if (trimmedMainLink) {
      try {
        const u = new URL(trimmedMainLink);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          throw new Error("non-http");
        }
      } catch {
        message.value = { kind: "error", text: tMainLink.invalid };
        return;
      }
    }
    if (trimmedIosLink && !isHttpUrl(trimmedIosLink)) {
      message.value = { kind: "error", text: tAppLinks.iosInvalid };
      return;
    }
    if (trimmedAndroidLink && !isHttpUrl(trimmedAndroidLink)) {
      message.value = { kind: "error", text: tAppLinks.androidInvalid };
      return;
    }
    for (const row of customLinks.value) {
      const url = row.url.trim();
      if (url && !isHttpUrl(url)) {
        message.value = { kind: "error", text: tCustom.urlInvalid };
        return;
      }
    }
    submitting.value = true;
    message.value = null;

    try {
      const cleanedLinks = buildLinksPayload();
      const indicators = parseAccountIndicatorLines(accountIndicators.value);

      const payload: Record<string, unknown> = {
        name: name.value.trim(),
        description: description.value.trim(),
        mainLink: trimmedMainLink,
        iosLink: trimmedIosLink || null,
        androidLink: trimmedAndroidLink || null,
        categories: ["app"],
        subcategories: subcategories.value,
        links: cleanedLinks,
        lexicons: {
          produces: lexiconsProduced.value,
          consumes: lexiconsConsumed.value,
        },
        accountIndicators: indicators,
        createNewListing: createNewListingPending.value,
        atstoreListingUri: currentAtstoreListingUri.value,
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

      if (bannerFile.value) {
        payload.bannerUpload = {
          dataBase64: await readFileAsBase64(bannerFile.value),
          mimeType: bannerFile.value.type,
        };
      } else if (!bannerRemoved.value && bannerKeep.value) {
        payload.banner = bannerKeep.value;
      } else {
        payload.banner = null;
      }

      if (legacyIcon) payload.icon = legacyIcon;
      if (legacyIconBw) payload.iconBw = legacyIconBw;

      payload.screenshots = screenshots.value
        .filter((s) => s.blob)
        .map((s) => ({ image: s.blob }));
      payload.screenshotUploads = await Promise.all(
        screenshots.value
          .filter((s) => s.file)
          .map(async (s) => ({
            dataBase64: await readFileAsBase64(s.file as File),
            mimeType: s.mimeType ?? (s.file as File).type,
          })),
      );

      const res = await fetch("/api/registry/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await responseErrorText(res);
        throw new Error(text || `HTTP ${res.status}`);
      }
      const saved = await res.json() as {
        publicPath?: string | null;
        slug?: string | null;
        atstoreListingUri?: string | null;
        writeTarget?: "atstore_listing" | "legacy_profile";
      };
      published.value = true;
      publicPath.value = saved.publicPath ??
        (saved.slug ? `/apps/${encodeURIComponent(saved.slug)}` : null) ??
        publicPath.value;
      hostAppIdentifier.value = saved.atstoreListingUri ?? saved.slug ??
        hostAppIdentifier.value;
      currentAtstoreListingUri.value = saved.atstoreListingUri ??
        currentAtstoreListingUri.value;
      createNewListingPending.value = false;
      message.value = {
        kind: "ok",
        text: saved.writeTarget === "atstore_listing"
          ? tManage.savedAtstoreToast
          : tManage.savedToast,
      };
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
      const target = currentAtstoreListingUri.value
        ? `?listing=${encodeURIComponent(currentAtstoreListingUri.value)}`
        : "";
      const res = await fetch(`/api/registry/profile${target}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await responseErrorText(res));
      published.value = false;
      publicPath.value = null;
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

      <div class="profile-form-banner">
        {bannerPreview.value
          ? (
            /* Banner exists — compact thumbnail row */
            <div class="profile-form-banner-row">
              <label class="profile-form-banner-thumb-label">
                <img
                  src={bannerPreview.value}
                  alt="Project banner"
                  class="profile-form-banner-thumb"
                  onError={() => {
                    bannerPreview.value = null;
                  }}
                />
                <span
                  class="profile-form-banner-thumb-overlay"
                  aria-hidden="true"
                >
                  {tForm.bannerReplace}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={onBannerChange}
                />
              </label>
              <div class="profile-form-banner-thumb-actions">
                <label class="profile-form-button-secondary profile-form-banner-thumb-replace">
                  {tForm.bannerReplace}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={onBannerChange}
                  />
                </label>
                <button
                  type="button"
                  class="profile-form-button-link"
                  onClick={removeBanner}
                >
                  {tForm.bannerRemove}
                </button>
              </div>
            </div>
          )
          : (
            /* No banner — just a small add button + hint */
            <div class="profile-form-banner-empty">
              <label class="profile-form-button-secondary">
                + {tForm.bannerLabel}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={onBannerChange}
                />
              </label>
              <p class="profile-form-hint">{tForm.bannerHint}</p>
            </div>
          )}
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
          <p class="profile-form-hint">
            {tForm.avatarAtstoreHint}
          </p>
        </div>

        <div class="profile-form-fields">
          {
            /*
            Handle/sign-out lockup. The sign-out submit button uses
            formAction/formMethod to override the parent profile form's
            target — keeps the sign-out a real POST without nesting
            forms (which HTML forbids).
          */
          }
          <div class="profile-form-handle-row">
            <div class="profile-form-handle-info">
              <span class="profile-form-label">{tForm.handleLabel}</span>
              <span class="profile-form-handle-value">
                <AtmosphereHandle handle={handle} />
              </span>
            </div>
            <button
              type="submit"
              formAction="/oauth/logout"
              formMethod="POST"
              formNoValidate
              class="profile-form-handle-signout"
            >
              {tManage.signOut}
            </button>
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
              {tForm.descriptionLabel}
            </span>
            <textarea
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
        </div>
      </div>

      {
        /*
        Everything below name/description spans the full card width on
        desktop instead of staying constrained to the avatar+fields
        right column. Keeps long lists (Atmosphere services, custom
        links, chips) from wrapping into narrow columns.
      */
      }
      <div class="profile-form-stack">
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

        {/* ---------------- Main Link ----------------------------- */}
        {
          /*
            Primary destinations render as buttons inside the public
            profile card. A project needs at least one Web / iOS /
            Android destination, but each individual field is optional.
          */
        }
        <label class="profile-form-field">
          <span class="profile-form-label">{tMainLink.sectionLabel}</span>
          <input
            type="url"
            class="profile-form-input"
            placeholder={tMainLink.placeholder}
            value={mainLink.value}
            onInput={(e) =>
              mainLink.value = (e.currentTarget as HTMLInputElement).value}
          />
          <p class="profile-form-hint">{tMainLink.groupHint}</p>
        </label>

        {/* ---------------- Mobile app links (optional) ---------- */}
        <div class="profile-form-mobile-links">
          <label class="profile-form-field">
            <span class="profile-form-label">{tAppLinks.iosLabel}</span>
            <input
              type="url"
              class="profile-form-input"
              placeholder={tAppLinks.iosPlaceholder}
              value={iosLink.value}
              onInput={(e) =>
                iosLink.value = (e.currentTarget as HTMLInputElement).value}
            />
            <p class="profile-form-hint">{tAppLinks.iosHint}</p>
          </label>
          <label class="profile-form-field">
            <span class="profile-form-label">{tAppLinks.androidLabel}</span>
            <input
              type="url"
              class="profile-form-input"
              placeholder={tAppLinks.androidPlaceholder}
              value={androidLink.value}
              onInput={(e) =>
                androidLink.value = (e.currentTarget as HTMLInputElement).value}
            />
            <p class="profile-form-hint">{tAppLinks.androidHint}</p>
          </label>
        </div>

        {/* ---------------- Screenshots --------------------------- */}
        <div
          id="app-screenshots"
          class={`profile-form-field profile-screenshots-field ${
            screenshotDragActive.value ? "is-dragging" : ""
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            screenshotDragActive.value = true;
          }}
          onDragOver={(event) => {
            event.preventDefault();
            screenshotDragActive.value = true;
          }}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
              screenshotDragActive.value = false;
            }
          }}
          onDrop={onScreenshotsDrop}
        >
          <div class="profile-form-section-heading">
            <div>
              <span class="profile-form-label">
                {tScreenshots.sectionLabel}
              </span>
              <p class="profile-form-hint">{tScreenshots.hint}</p>
            </div>
            <span class="profile-form-count">
              {screenshots.value.length}/{SCREENSHOT_MAX_COUNT}
            </span>
          </div>
          {screenshotMessage.value && (
            <p
              class={`profile-screenshot-status profile-form-status profile-form-status--${screenshotMessage.value.kind}`}
              role="status"
            >
              {screenshotMessage.value.text}
            </p>
          )}

          {screenshots.value.length > 0
            ? (
              <div class="profile-screenshot-grid">
                {screenshots.value.map((shot, i) => (
                  <div class="profile-screenshot-edit" key={shot.id}>
                    <img
                      src={shot.previewUrl}
                      alt=""
                      class="profile-screenshot-edit-img"
                    />
                    <span class="profile-screenshot-number">
                      Screenshot {i + 1}
                    </span>
                    <button
                      type="button"
                      class="profile-screenshot-remove"
                      aria-label={tScreenshots.removeAriaLabel(i + 1)}
                      onClick={() =>
                        removeScreenshot(shot.id)}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                ))}
                {screenshots.value.length < SCREENSHOT_MAX_COUNT && (
                  <label class="profile-screenshot-add-tile">
                    <span
                      class="profile-screenshot-add-icon"
                      aria-hidden="true"
                    >
                      +
                    </span>
                    <strong>{tScreenshots.addMore}</strong>
                    <span>
                      {SCREENSHOT_MAX_COUNT - screenshots.value.length}{" "}
                      slot{SCREENSHOT_MAX_COUNT - screenshots.value.length === 1
                        ? ""
                        : "s"} left
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                      multiple
                      hidden
                      onChange={onScreenshotsChange}
                    />
                  </label>
                )}
              </div>
            )
            : (
              <label class="profile-screenshot-dropzone">
                <span
                  class="profile-screenshot-dropzone-icon"
                  aria-hidden="true"
                >
                  ⊞
                </span>
                <strong>{tScreenshots.upload}</strong>
                <span>Choose images or drag and drop</span>
                <small>PNG, JPEG, or WebP · 5MB each · up to 4</small>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                  multiple
                  hidden
                  onChange={onScreenshotsChange}
                />
              </label>
            )}
        </div>

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

        {/* ---------------- Custom links -------------------------- */}
        <div class="profile-form-field">
          <span class="profile-form-label">{tCustom.sectionLabel}</span>
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
        </div>

        {/* ---------------- Interoperability metadata ---------------- */}
        <fieldset
          id="app-interoperability"
          class="profile-form-field profile-form-interop"
        >
          <legend class="profile-form-label">Interoperability</legend>
          <p class="profile-form-hint">
            Optional AT Protocol metadata for app directories and compatible
            clients. Search the catalog, then mark each collection as read,
            written, or both.
          </p>
          <CollectionMatrix
            suggestions={collectionSuggestions}
            writes={lexiconsProduced.value}
            reads={lexiconsConsumed.value}
            onWritesChange={(next) => (lexiconsProduced.value = next)}
            onReadsChange={(next) => (lexiconsConsumed.value = next)}
          />
          <label class="profile-form-field">
            <span class="profile-form-label">
              Account indicators (advanced)
            </span>
            <textarea
              class="profile-form-input profile-form-interop-textarea"
              rows={3}
              spellcheck={false}
              placeholder={accountIndicatorsPlaceholder}
              value={accountIndicators.value}
              onInput={(e) =>
                accountIndicators.value =
                  (e.currentTarget as HTMLTextAreaElement).value}
            >
            </textarea>
            <span class="profile-form-hint">
              These are records whose presence can suggest someone uses this
              app. Add just a collection, or collection/rkey for a known record.
            </span>
          </label>
        </fieldset>
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
        {
          /*
          "View public profile" sits between Update and Remove so it
          reads as the natural read-only complement to the destructive
          actions. We only render it when the user has actually
          published (live in registry) AND we know their public handle —
          otherwise the link would 404. We use `published.value` so the
          link appears immediately after a first-time publish without a
          page reload.
         */
        }
        {published.value && publicPath.value && (
          <a
            href={publicPath.value}
            class="profile-form-button-secondary profile-form-button-secondary--lg"
          >
            {tManage.viewPublicProfile}
          </a>
        )}
        {published.value && hostAppIdentifier.value && (
          <a
            href={`/apps/manage/host?app=${
              encodeURIComponent(hostAppIdentifier.value)
            }`}
            class="profile-form-button-secondary profile-form-button-secondary--lg"
          >
            Add account hosting
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
      {!hydrated.value && (
        <p class="profile-form-hydration-note">
          Loading editor controls…
        </p>
      )}

      <BskyClientPickerModal
        open={bskyPickerOpen.value}
        selected={bskyClientIds.value}
        onConfirm={onBskyConfirm}
        onClose={() => (bskyPickerOpen.value = false)}
      />

      {
        /* URL-override modal, shared by Tangled and Supper. Only one is
          open at a time so we render a single instance and switch its
          props on `urlOverrideOpen`. */
      }
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
          {
            /* Only render the secondary line when there's something
              meaningful to show (i.e. extra clients selected). The
              service description ("Decentralised social network") is
              redundant next to the brand name and was just noise. */
          }
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
          onChange={(
            e,
          ) => (on.value = (e.currentTarget as HTMLInputElement).checked)}
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
