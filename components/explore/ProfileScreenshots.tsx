import type { ProfileRow } from "../../lib/registry.ts";
import AppScreenshotGallery from "../../islands/AppScreenshotGallery.tsx";

interface Props {
  profile: ProfileRow;
}

export default function ProfileScreenshots({ profile }: Props) {
  return (
    <AppScreenshotGallery
      appName={profile.name}
      screenshots={profile.screenshots.map((_, index) => ({
        src: `/api/registry/screenshot/${
          encodeURIComponent(profile.did)
        }/${index}`,
        alt: `${profile.name} screenshot ${index + 1}`,
      }))}
    />
  );
}
