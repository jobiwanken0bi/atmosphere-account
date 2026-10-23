import { createPortal } from "preact/compat";
import { useId } from "preact/hooks";
import { useT } from "../../i18n/mod.ts";
import type { CreateAccountHostOption } from "../../lib/create-account-hosts.ts";
import { isPlainLinkActivation } from "../../lib/link-activation.ts";
import { useDialog } from "../../lib/use-dialog.ts";

export function AccountHostMark({ host }: { host: CreateAccountHostOption }) {
  return (
    <span class="signin-host-mark" aria-hidden="true">
      {host.name.slice(0, 1)}
      {host.avatarUrl && (
        <img
          src={host.avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          onError={(event) => event.currentTarget.remove()}
        />
      )}
    </span>
  );
}

export function AccountHostMetadata(
  { host }: { host: CreateAccountHostOption },
) {
  const t = useT().hostsDirectory;
  return (
    <span class="signin-host-meta">
      <span
        class={`signin-host-signup-status signin-host-signup-status--${host.signupStatus}`}
      >
        {host.signupStatus === "invite_required"
          ? t.signupInvite
          : t.signupOpen}
      </span>
      {host.location && (
        <span class="signin-host-location">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          <span>{host.location}</span>
        </span>
      )}
      {host.recommendationLabel && (
        <span class="signin-host-recommendation">
          {host.recommendationLabel}
        </span>
      )}
    </span>
  );
}

export default function AccountHostDetailsDialog(
  { host, href, onClose, onAuthorizationStart }: {
    host: CreateAccountHostOption;
    href: string;
    onClose: () => void;
    onAuthorizationStart?: () => void;
  },
) {
  const t = useT().accountHostChooser;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const titleId = `host-details-title-${id}`;
  const descriptionId = `host-details-description-${id}`;
  const dialogRef = useDialog<HTMLDivElement>(true, onClose);

  return createPortal(
    <div
      class="modal-backdrop signin-host-details-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        class="modal-card signin-host-details-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={host.description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div class="signin-host-details-header">
          <AccountHostMark host={host} />
          <div class="signin-host-identity">
            <h2 id={titleId}>{host.name}</h2>
            <span class="signin-host-domain">{host.host}</span>
          </div>
          <button
            type="button"
            class="modal-close-button signin-host-details-close"
            aria-label={t.closeDetails}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <AccountHostMetadata host={host} />
        {host.description && (
          <p id={descriptionId} class="signin-host-details-description">
            {host.description}
          </p>
        )}
        <a
          class="signin-host-details-continue"
          href={href}
          target={host.oauthAccountCreation ? undefined : "_blank"}
          rel={host.oauthAccountCreation ? "nofollow" : "noopener noreferrer"}
          onClick={(event) => {
            if (host.oauthAccountCreation && isPlainLinkActivation(event)) {
              onAuthorizationStart?.();
            }
          }}
        >
          <span>{t.continueLabel}</span>
          <svg
            class="signin-host-action-arrow"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </a>
      </div>
    </div>,
    document.body,
  );
}
