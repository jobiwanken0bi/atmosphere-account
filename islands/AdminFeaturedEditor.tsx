import { useComputed, useSignal } from "@preact/signals";

export interface FeaturedCandidate {
  did: string;
  handle: string;
  name: string;
}

export interface FeaturedEntryDraft {
  did: string;
  badges: string[];
}

interface Props {
  /** All registry profiles, used as the candidate pool. */
  candidates: FeaturedCandidate[];
  /** Currently-featured entries, ordered by position. */
  initial: FeaturedEntryDraft[];
  copy: {
    saveAndPublish: string;
    saving: string;
    saved: string;
    filterPlaceholder: string;
    featuredHeading: string;
    candidatesHeading: string;
    empty: string;
    moveUp: string;
    moveDown: string;
    remove: string;
    add: string;
    badgesLabel: string;
    badgeVerified: string;
    badgeOfficial: string;
    error: string;
  };
}

const BADGE_KEYS = ["verified", "official"] as const;
type Badge = typeof BADGE_KEYS[number];

/**
 * Two-pane editor: featured entries on the left (ordered, with badge
 * toggles + reorder buttons), full project pool on the right with a
 * filter. "Save & publish" POSTs the resulting list to /api/admin/
 * featured which writes the canonical record on the curator's PDS.
 */
export default function AdminFeaturedEditor(
  { candidates, initial, copy }: Props,
) {
  const entries = useSignal<FeaturedEntryDraft[]>(initial);
  const filter = useSignal("");
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; text: string }
  >({ kind: "idle" });

  const candidateMap = useComputed(() => {
    const m = new Map<string, FeaturedCandidate>();
    for (const c of candidates) m.set(c.did, c);
    return m;
  });

  const featuredDids = useComputed(() =>
    new Set(entries.value.map((e) => e.did))
  );

  const filteredCandidates = useComputed(() => {
    const q = filter.value.trim().toLowerCase();
    return candidates
      .filter((c) => !featuredDids.value.has(c.did))
      .filter((c) => {
        if (!q) return true;
        return (
          c.handle.toLowerCase().includes(q) ||
          c.did.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q)
        );
      })
      .slice(0, 100);
  });

  const add = (did: string) => {
    if (entries.value.find((e) => e.did === did)) return;
    entries.value = [...entries.value, { did, badges: [] }];
  };
  const remove = (did: string) => {
    entries.value = entries.value.filter((e) => e.did !== did);
  };
  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= entries.value.length) return;
    const next = [...entries.value];
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item);
    entries.value = next;
  };
  const toggleBadge = (i: number, badge: Badge) => {
    const next = [...entries.value];
    const cur = new Set(next[i].badges);
    if (cur.has(badge)) cur.delete(badge);
    else cur.add(badge);
    next[i] = { ...next[i], badges: Array.from(cur) };
    entries.value = next;
  };

  const save = async () => {
    status.value = { kind: "saving" };
    try {
      const r = await fetch("/api/admin/featured", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entries: entries.value.map((e, i) => ({
            did: e.did,
            badges: e.badges,
            position: i,
          })),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      status.value = { kind: "saved" };
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const badgeLabel = (b: Badge) =>
    b === "verified" ? copy.badgeVerified : copy.badgeOfficial;

  return (
    <div>
      <div class="admin-featured-layout">
        <div class="admin-featured-column">
          <h2>{copy.featuredHeading}</h2>
          {entries.value.length === 0
            ? <p class="admin-empty">{copy.empty}</p>
            : (
              <ul class="admin-featured-list">
                {entries.value.map((e, i) => {
                  const c = candidateMap.value.get(e.did);
                  return (
                    <li class="admin-featured-row" key={e.did}>
                      <div>
                        <strong>{c?.name ?? e.did}</strong>
                        {c && (
                          <span class="admin-featured-handle">@{c.handle}</span>
                        )}
                        <div
                          class="admin-featured-badges"
                          style={{ marginTop: "0.4rem" }}
                        >
                          <span
                            style={{
                              fontSize: "0.7rem",
                              color: "rgba(18,26,47,0.55)",
                              alignSelf: "center",
                              marginRight: "0.25rem",
                            }}
                          >
                            {copy.badgesLabel}:
                          </span>
                          {BADGE_KEYS.map((b) => (
                            <button
                              type="button"
                              key={b}
                              class={`admin-featured-badge-toggle${
                                e.badges.includes(b)
                                  ? " admin-featured-badge-toggle--on"
                                  : ""
                              }`}
                              onClick={() => toggleBadge(i, b)}
                            >
                              {badgeLabel(b)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div class="admin-featured-actions">
                        <button
                          type="button"
                          class="admin-featured-icon-button"
                          aria-label={copy.moveUp}
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          class="admin-featured-icon-button"
                          aria-label={copy.moveDown}
                          onClick={() => move(i, 1)}
                          disabled={i === entries.value.length - 1}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          class="profile-form-button-link"
                          onClick={() => remove(e.did)}
                        >
                          {copy.remove}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
        </div>

        <div class="admin-featured-column">
          <h2>{copy.candidatesHeading}</h2>
          <input
            type="text"
            class="admin-featured-filter"
            placeholder={copy.filterPlaceholder}
            value={filter.value}
            onInput={(e) =>
              filter.value = (e.currentTarget as HTMLInputElement).value}
          />
          {filteredCandidates.value.length === 0
            ? <p class="admin-empty">{copy.empty}</p>
            : (
              <ul class="admin-featured-list">
                {filteredCandidates.value.map((c) => (
                  <li class="admin-featured-row" key={c.did}>
                    <div>
                      <strong>{c.name}</strong>
                      <span class="admin-featured-handle">@{c.handle}</span>
                    </div>
                    <div class="admin-featured-actions">
                      <button
                        type="button"
                        class="profile-form-button-secondary"
                        onClick={() =>
                          add(c.did)}
                      >
                        {copy.add}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>

      <div class="admin-featured-toolbar">
        <button
          type="button"
          class="profile-form-button-primary"
          onClick={save}
          disabled={status.value.kind === "saving"}
        >
          {status.value.kind === "saving" ? copy.saving : copy.saveAndPublish}
        </button>
        {status.value.kind === "saved" && (
          <span class="admin-featured-status admin-featured-status--ok">
            {copy.saved}
          </span>
        )}
        {status.value.kind === "error" && (
          <span class="admin-featured-status admin-featured-status--error">
            {copy.error}: {status.value.text}
          </span>
        )}
      </div>
    </div>
  );
}
