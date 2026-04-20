import type { ProfileRow } from "../../lib/registry.ts";
import ProfileCard from "./ProfileCard.tsx";
import EmptyState from "./EmptyState.tsx";

interface Props {
  profiles: ProfileRow[];
}

export default function ProfileGrid({ profiles }: Props) {
  if (profiles.length === 0) return <EmptyState />;
  return (
    <div class="profile-grid">
      {profiles.map((p) => <ProfileCard key={p.did} profile={p} />)}
    </div>
  );
}
