import type { AppListing } from "../../lib/app-directory.ts";
import AppCard from "./AppCard.tsx";
import EmptyState from "./EmptyState.tsx";

interface Props {
  apps: AppListing[];
  /** Active search/collection filters, so an empty result can explain itself. */
  filtered?: boolean;
  resetHref?: string;
}

export default function AppGrid({ apps, filtered, resetHref }: Props) {
  if (apps.length === 0) {
    return <EmptyState filtered={filtered} resetHref={resetHref} />;
  }
  return (
    <div class="profile-grid app-grid">
      {apps.map((app) => <AppCard key={app.id} app={app} />)}
    </div>
  );
}
