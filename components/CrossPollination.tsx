import { useT } from "../i18n/mod.ts";
import ContentVisualIcon, {
  type ContentVisualIconName,
} from "./icons/ContentVisualIcon.tsx";

/** Icons paired by index with crossPollination.contentTypes (last = open-ended). */
const contentTypeIcons: ContentVisualIconName[] = [
  "blog",
  "photo",
  "music",
  "video",
  "calendar",
  "review",
  "post",
  "like",
  "comment",
  "list",
  "new",
];

/** Icons paired by index with crossPollination.destinations (last = open-ended). */
const destinationIcons: ContentVisualIconName[] = [
  "feed",
  "gallery",
  "profile",
  "player",
  "calendar",
  "reader",
  "people",
  "music",
  "feed",
  "app",
];

type Chip = { label: string; icon: ContentVisualIconName; open: boolean };

function buildChips(
  labels: readonly string[],
  icons: ContentVisualIconName[],
): Chip[] {
  return labels.map((label, i) => ({
    label,
    icon: icons[i] ?? "new",
    // The final example in each list is the open-ended "anything / not yet built" one.
    open: i === labels.length - 1,
  }));
}

/** A single scrolling rail. The chip list is rendered twice so the vertical
 *  marquee can loop seamlessly, and the viewport is masked top + bottom so the
 *  types dissolve into the sky — the stream reads as effectively infinite. */
function FlowRail(
  { chips, side, label }: {
    chips: Chip[];
    side: "left" | "right";
    label: string;
  },
) {
  const track = [...chips, ...chips];
  return (
    <div class={`flow-rail flow-rail-${side}`}>
      <div class="flow-rail-label font-mono">{label}</div>
      <div class="flow-rail-viewport">
        <div class="flow-rail-track">
          {track.map((chip, i) => (
            <div
              key={`${side}-${i}`}
              class={`flow-chip glass-subtle flow-chip-${side}${
                chip.open ? " flow-chip-open" : ""
              }`}
              // The duplicated half is a pure visual echo of the first.
              aria-hidden="true"
            >
              <span class="flow-chip-icon">
                <ContentVisualIcon
                  name={chip.icon}
                  class="flow-chip-icon-svg"
                />
              </span>
              <span class="flow-chip-label">{chip.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A conduit of light particles flowing left → right between a rail and the hub. */
function FlowConduit({ side }: { side: "left" | "right" }) {
  return (
    <div class={`flow-conduit flow-conduit-${side}`} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          class="flow-particle"
          style={{ animationDelay: `${i * 0.6}s` }}
        />
      ))}
    </div>
  );
}

export default function CrossPollination() {
  const t = useT();
  const createChips = buildChips(
    t.crossPollination.contentTypes,
    contentTypeIcons,
  );
  const appearChips = buildChips(
    t.crossPollination.destinations,
    destinationIcons,
  );

  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">{t.crossPollination.heading}</h2>
          <div class="divider" />
          <p
            class="text-body mt-2"
            style={{ maxWidth: "640px", margin: "1rem auto 0" }}
          >
            {t.crossPollination.intro}
          </p>
        </div>

        {
          /* Animated flow. Decorative — described for assistive tech by the
            visually-hidden summary that follows. */
        }
        <div
          class="flow-stage"
          role="img"
          aria-label={t.crossPollination.ariaLabel}
        >
          <FlowRail
            chips={createChips}
            side="left"
            label={t.crossPollination.youCreate}
          />

          <div class="flow-core" aria-hidden="true">
            <FlowConduit side="left" />
            <div class="flow-hub glass">
              <span class="flow-hub-glow" />
              <img
                src="/union.svg"
                alt=""
                width="36"
                height="36"
                class="flow-hub-logo"
              />
              <span class="flow-hub-label font-mono">
                {t.crossPollination.hubLabel}
              </span>
            </div>
            <FlowConduit side="right" />
          </div>

          <FlowRail
            chips={appearChips}
            side="right"
            label={t.crossPollination.itAppearsIn}
          />
        </div>

        <p
          class="text-body-sm text-center mt-3"
          style={{
            maxWidth: "520px",
            margin: "1.5rem auto 0",
            fontStyle: "italic",
          }}
        >
          {t.crossPollination.footnote}
        </p>
      </div>
    </section>
  );
}
