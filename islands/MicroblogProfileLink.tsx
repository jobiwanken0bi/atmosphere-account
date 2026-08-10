import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { getProfileMicroblogViewer } from "../lib/bsky-clients.ts";
import {
  MICROBLOG_VIEWER_CHANGED_EVENT,
  type MicroblogViewerChangedDetail,
} from "../lib/microblog-viewer-events.ts";

interface Props {
  selectedClientId: string | null;
  handle: string;
}

export default function MicroblogProfileLink(
  { selectedClientId, handle }: Props,
) {
  const selected = useSignal(getProfileMicroblogViewer(selectedClientId).id);
  const active = getProfileMicroblogViewer(selected.value);

  useEffect(() => {
    const onViewerChanged = (event: Event) => {
      const detail = (event as CustomEvent<MicroblogViewerChangedDetail>)
        .detail;
      if (typeof detail?.clientId !== "string") return;
      selected.value = getProfileMicroblogViewer(detail.clientId).id;
    };
    globalThis.addEventListener(
      MICROBLOG_VIEWER_CHANGED_EVENT,
      onViewerChanged,
    );
    return () =>
      globalThis.removeEventListener(
        MICROBLOG_VIEWER_CHANGED_EVENT,
        onViewerChanged,
      );
  }, []);

  return (
    <a
      href={active.profileUrl(handle)}
      target="_blank"
      rel="noopener noreferrer"
      class="account-dashboard-button account-dashboard-button--secondary account-dashboard-profile-button"
    >
      <span>Manage profile</span>
      <img
        src={active.iconUrl}
        alt=""
        width={20}
        height={20}
        class="account-dashboard-profile-button-icon"
      />
      <span class="sr-only">in {active.name}</span>
      <span aria-hidden="true">↗</span>
      <span class="sr-only">(opens in a new tab)</span>
    </a>
  );
}
