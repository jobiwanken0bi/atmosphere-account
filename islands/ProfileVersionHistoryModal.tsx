import { useSignal } from "@preact/signals";
import type { ProfileUpdateRow } from "../lib/profile-updates.ts";
import TangledIcon from "../components/icons/TangledIcon.tsx";

interface Props {
  updates: ProfileUpdateRow[];
  copy: {
    versionHistory: string;
    viewCommit: string;
  };
}

function dateLabel(ms: number): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ms));
}

function UpdateMeta({ update }: { update: ProfileUpdateRow }) {
  return (
    <div class="profile-whats-new-meta">
      {update.version && <span>{update.version}</span>}
      <time dateTime={new Date(update.createdAt).toISOString()}>
        {dateLabel(update.createdAt)}
      </time>
    </div>
  );
}

export default function ProfileVersionHistoryModal({ updates, copy }: Props) {
  const open = useSignal(false);
  if (updates.length === 0) return null;

  return (
    <>
      <button
        type="button"
        class="profile-whats-new-history-button"
        aria-label={copy.versionHistory}
        title={copy.versionHistory}
        onClick={() => open.value = true}
      >
        <span aria-hidden="true">↺</span>
      </button>
      {open.value && (
        <div
          class="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-version-history-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) open.value = false;
          }}
        >
          <div class="modal-card profile-version-history-modal">
            <header class="modal-header">
              <h2 id="profile-version-history-title" class="modal-title">
                {copy.versionHistory}
              </h2>
            </header>
            <div class="profile-version-history-list">
              {updates.map((update) => (
                <article class="profile-version-history-item" key={update.uri}>
                  <UpdateMeta update={update} />
                  <h3>{update.title}</h3>
                  <p>{update.body}</p>
                  {update.tangledCommitUrl && (
                    <a
                      href={update.tangledCommitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="profile-version-history-commit"
                    >
                      <TangledIcon class="profile-whats-new-icon" />
                      <span aria-hidden="true">↗</span>
                      <span class="visually-hidden">{copy.viewCommit}</span>
                    </a>
                  )}
                </article>
              ))}
            </div>
            <footer class="modal-footer">
              <button
                type="button"
                class="profile-form-button-secondary"
                onClick={() => open.value = false}
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
