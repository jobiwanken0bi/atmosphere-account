import type { ProfileRow } from "../../lib/registry.ts";

interface Props {
  profile: ProfileRow;
}

export default function ProfileScreenshots({ profile }: Props) {
  if (profile.screenshots.length === 0) return null;
  const hasMultipleScreenshots = profile.screenshots.length > 1;

  return (
    <section class="profile-screenshots" aria-label="Screenshots">
      <div class="profile-screenshots-shell" data-screenshot-carousel>
        {hasMultipleScreenshots && (
          <button
            type="button"
            class="profile-screenshots-arrow profile-screenshots-arrow--prev"
            aria-label="Previous screenshot"
            data-screenshot-direction="-1"
          >
            ←
          </button>
        )}
        <div class="profile-screenshots-carousel">
          {profile.screenshots.map((_, i) => (
            <a
              class="profile-screenshot-card"
              href={`/api/registry/screenshot/${
                encodeURIComponent(profile.did)
              }/${i}`}
              target="_blank"
              rel="noopener noreferrer"
              key={i}
            >
              <img
                src={`/api/registry/screenshot/${
                  encodeURIComponent(profile.did)
                }/${i}`}
                alt={`${profile.name} screenshot ${i + 1}`}
                loading="lazy"
                decoding="async"
                class="profile-screenshot-img"
              />
            </a>
          ))}
        </div>
        {hasMultipleScreenshots && (
          <button
            type="button"
            class="profile-screenshots-arrow profile-screenshots-arrow--next"
            aria-label="Next screenshot"
            data-screenshot-direction="1"
          >
            →
          </button>
        )}
      </div>
      {hasMultipleScreenshots && (
        <script type="module" src="/profile-screenshot-carousel.js" />
      )}
    </section>
  );
}
