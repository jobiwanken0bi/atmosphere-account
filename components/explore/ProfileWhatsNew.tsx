import type { ProfileUpdateRow } from "../../lib/profile-updates.ts";
import ProfileVersionHistoryModal from "../../islands/ProfileVersionHistoryModal.tsx";
import TangledIcon from "../icons/TangledIcon.tsx";

interface Props {
  updates: ProfileUpdateRow[];
  copy: {
    heading: string;
    empty: string;
    versionHistory: string;
    viewCommit: string;
    readFullUpdate: string;
  };
}

const BODY_PREVIEW_LENGTH = 240;

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

function isLongBody(body: string): boolean {
  return body.length > BODY_PREVIEW_LENGTH || body.split("\n").length > 3;
}

function previewBody(body: string): string {
  if (!isLongBody(body)) return body;
  return `${body.slice(0, BODY_PREVIEW_LENGTH).trimEnd()}...`;
}

function CommitLink(
  { href, label }: { href: string; label: string },
) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      class="profile-whats-new-icon-button"
      aria-label={label}
      title={label}
    >
      <TangledIcon class="profile-whats-new-icon" />
      <span class="profile-whats-new-icon-arrow" aria-hidden="true">↗</span>
    </a>
  );
}

export default function ProfileWhatsNew({ updates, copy }: Props) {
  const [latest, ...history] = updates;
  if (!latest) {
    return (
      <section class="profile-whats-new glass">
        <h2 class="profile-card-section-title">{copy.heading}</h2>
        <p class="profile-whats-new-empty">{copy.empty}</p>
      </section>
    );
  }

  return (
    <section class="profile-whats-new glass">
      <div class="profile-whats-new-main">
        <div class="profile-whats-new-copy">
          <div class="profile-whats-new-heading-row">
            <h2 class="profile-card-section-title">{copy.heading}</h2>
            <ProfileVersionHistoryModal
              updates={history}
              copy={{
                versionHistory: copy.versionHistory,
                viewCommit: copy.viewCommit,
              }}
            />
          </div>
          <UpdateMeta update={latest} />
          <h3 class="profile-whats-new-title">{latest.title}</h3>
          {isLongBody(latest.body)
            ? (
              <details class="profile-whats-new-expand">
                <p class="profile-whats-new-preview">
                  {previewBody(latest.body)}
                </p>
                <summary>{copy.readFullUpdate}</summary>
                <p class="profile-whats-new-full">{latest.body}</p>
              </details>
            )
            : <p class="profile-whats-new-body">{latest.body}</p>}
        </div>
        {latest.tangledCommitUrl && (
          <CommitLink href={latest.tangledCommitUrl} label={copy.viewCommit} />
        )}
      </div>
    </section>
  );
}
