import type { ProfileUpdateRow } from "../../lib/profile-updates.ts";

interface Props {
  updates: ProfileUpdateRow[];
  copy: {
    heading: string;
    empty: string;
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

export default function ProfileWhatsNew({ updates, copy }: Props) {
  const [latest, ...history] = updates;
  if (!latest) {
    return (
      <section class="profile-whats-new glass">
        <h2>{copy.heading}</h2>
        <p class="profile-whats-new-empty">{copy.empty}</p>
      </section>
    );
  }

  return (
    <section class="profile-whats-new glass">
      <div class="profile-whats-new-main">
        <div>
          <p class="text-eyebrow">{copy.heading}</p>
          <UpdateMeta update={latest} />
          <h2>{latest.title}</h2>
          <p>{latest.body}</p>
        </div>
        {latest.tangledCommitUrl && (
          <a
            href={latest.tangledCommitUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="profile-form-button-secondary profile-whats-new-commit"
          >
            {copy.viewCommit}
          </a>
        )}
      </div>

      {history.length > 0 && (
        <div class="profile-version-history">
          <h3>{copy.versionHistory}</h3>
          {history.slice(0, 5).map((update) => (
            <article class="profile-version-history-item" key={update.uri}>
              <UpdateMeta update={update} />
              <h4>{update.title}</h4>
              <p>{update.body}</p>
              {update.tangledCommitUrl && (
                <a
                  href={update.tangledCommitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-link-button"
                >
                  {copy.viewCommit}
                </a>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
