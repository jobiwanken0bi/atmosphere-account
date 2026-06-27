import type { AppListing } from "../../lib/app-directory.ts";
import AppCard from "./AppCard.tsx";
import EmptyState from "./EmptyState.tsx";

interface Props {
  apps: AppListing[];
}

export default function AppGrid({ apps }: Props) {
  if (apps.length === 0) return <EmptyState />;
  return (
    <div class="profile-grid app-grid">
      {apps.map((app) => <AppCard key={app.id} app={app} />)}
    </div>
  );
}
