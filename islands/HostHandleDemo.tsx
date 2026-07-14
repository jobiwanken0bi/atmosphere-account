import type { JSX } from "preact";

interface HostHandleExample {
  label: string;
  prefix: string;
  suffix: string;
}

interface HostHandleDemoProps {
  examples: readonly HostHandleExample[];
  demoAriaLabel: string;
  demoButton: string;
}

type HostHandleFrameStyle = JSX.CSSProperties & {
  "--host-handle-cycle": string;
  "--host-handle-delay": string;
  "--host-handle-suffix-width": string;
  "--host-handle-suffix-steps": number;
};

function labelPrefix(label: string) {
  return label.replace(/\s+handle$/i, "");
}

const FRAME_MS = 3200;
const FRAME_COUNT = 6;

const FALLBACK_EXAMPLE: HostHandleExample = {
  label: "Bluesky handle",
  prefix: "you.",
  suffix: "bsky.social",
};

export function hostHandleDemoFrames(
  examples: readonly HostHandleExample[],
): readonly HostHandleExample[] {
  const source = examples.length > 0
    ? examples.slice(0, FRAME_COUNT)
    : [FALLBACK_EXAMPLE];

  return Array.from(
    { length: FRAME_COUNT },
    (_, index) => source[index % source.length],
  );
}

export default function HostHandleDemo(
  { examples, demoAriaLabel, demoButton }: HostHandleDemoProps,
) {
  const frames = hostHandleDemoFrames(examples);
  const cycleMs = frames.length * FRAME_MS;

  return (
    <div class="host-handle-demo" aria-label={demoAriaLabel}>
      <div class="host-handle-demo-stage" aria-hidden="true">
        {frames.map((example, index) => {
          const suffixLength = Math.max(1, example.suffix.length);
          const style: HostHandleFrameStyle = {
            "--host-handle-cycle": `${cycleMs}ms`,
            "--host-handle-delay": `${index * FRAME_MS}ms`,
            "--host-handle-suffix-width": `${suffixLength}ch`,
            "--host-handle-suffix-steps": suffixLength,
          };

          return (
            <div
              key={`${index}:${example.label}:${example.suffix}`}
              class="host-handle-demo-frame"
              style={style}
            >
              <div class="host-handle-demo-label-window">
                <span class="host-handle-label-phrase">
                  <span class="host-handle-label-word">
                    {labelPrefix(example.label)}
                  </span>
                  <span class="host-handle-label-kind">handle</span>
                </span>
              </div>
              <div class="host-handle-demo-input">
                <span class="host-handle-at">
                  <img src="/union.svg" alt="" />
                </span>
                <span class="host-handle-value-text">
                  <span class="host-handle-value-prefix">
                    {example.prefix}
                  </span>
                  <span class="host-handle-demo-window">
                    <span class="host-handle-suffix">
                      <span class="host-handle-suffix-text">
                        {example.suffix}
                      </span>
                    </span>
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div class="host-handle-demo-button" aria-hidden="true">
        <img src="/union.svg" alt="" class="host-handle-demo-button-icon" />
        {demoButton}
      </div>
    </div>
  );
}
