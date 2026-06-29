import type { AccountHost } from "../../lib/account-hosts.ts";
import BskyIcon from "../icons/BskyIcon.tsx";

export default function HostMark({ host }: { host: AccountHost }) {
  const visualKey = hostVisualKey(host);
  const isBluesky = visualKey === "bluesky";
  return (
    <span
      class={`host-card-mark host-card-mark-${visualKey}`}
      aria-hidden="true"
    >
      {host.avatarUrl
        ? (
          <img
            src={host.avatarUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={56}
            height={56}
            class="host-card-mark-image"
          />
        )
        : isBluesky
        ? <BskyIcon class="host-card-mark-icon" />
        : <span>{host.displayName.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

function hostVisualKey(host: AccountHost): string {
  const name = host.displayName.toLowerCase();
  const address = host.host.toLowerCase();
  if (
    address === "bsky.network" ||
    address === "bsky.social" ||
    host.matchPatterns.includes("*.bsky.network")
  ) return "bluesky";
  if (address.includes("blacksky") || name.includes("blacksky")) {
    return "blacksky";
  }
  if (address.includes("selfhosted") || name.includes("selfhosted")) {
    return "selfhosted";
  }
  if (address.includes("eurosky") || name.includes("eurosky")) {
    return "eurosky";
  }
  if (address.includes("sprk") || name.includes("spark")) return "spark";
  if (address.includes("tangled") || name.includes("tangled")) {
    return "tangled";
  }
  if (address.includes("pckt") || name.includes("pckt")) return "pckt";
  if (address.includes("margin") || name.includes("margin")) return "margin";
  if (address.includes("npmx") || name.includes("npmx")) return "npmx";
  return "generic";
}
