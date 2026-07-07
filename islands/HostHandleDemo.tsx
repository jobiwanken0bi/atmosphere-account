import { useEffect, useMemo, useState } from "preact/hooks";

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

function labelPrefix(label: string) {
  return label.replace(/\s+handle$/i, "");
}

const TYPE_MS = 82;
const DELETE_MS = 42;
const HOLD_MS = 1100;
const SWITCH_MS = 180;

export default function HostHandleDemo(
  { examples, demoAriaLabel, demoButton }: HostHandleDemoProps,
) {
  const safeExamples = useMemo(
    () =>
      examples.length > 0
        ? examples.slice(0, 6)
        : [{ label: "Bluesky handle", prefix: "you.", suffix: "bsky.social" }],
    [examples],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [typedSuffix, setTypedSuffix] = useState("");
  const [mode, setMode] = useState<"typing" | "holding" | "deleting">(
    "typing",
  );
  const activeExample = safeExamples[activeIndex] ?? safeExamples[0];
  const prefix = activeExample?.prefix ?? "you.";
  const suffix = activeExample?.suffix ?? "bsky.social";
  const labelWord = labelPrefix(activeExample?.label ?? "Bluesky handle");

  useEffect(() => {
    if (safeExamples.length <= 0) return;

    let delay = TYPE_MS;
    const next = () => {
      if (mode === "typing") {
        if (typedSuffix.length < suffix.length) {
          setTypedSuffix(suffix.slice(0, typedSuffix.length + 1));
          return;
        }
        setMode("holding");
        return;
      }

      if (mode === "holding") {
        setMode("deleting");
        return;
      }

      if (typedSuffix.length > 0) {
        setTypedSuffix(suffix.slice(0, typedSuffix.length - 1));
        return;
      }

      setActiveIndex((index) => (index + 1) % safeExamples.length);
      setMode("typing");
    };

    if (mode === "holding") delay = HOLD_MS;
    if (mode === "deleting") {
      delay = typedSuffix.length > 0 ? DELETE_MS : SWITCH_MS;
    }

    const timeout = setTimeout(next, delay);
    return () => clearTimeout(timeout);
  }, [mode, safeExamples, suffix, typedSuffix]);

  return (
    <div class="host-handle-demo" aria-label={demoAriaLabel}>
      <div class="host-handle-demo-label-window" aria-hidden="true">
        <span class="host-handle-label-phrase">
          <span
            key={activeExample?.label ?? activeIndex}
            class="host-handle-label-word"
          >
            {labelWord}
          </span>
          <span class="host-handle-label-kind">handle</span>
        </span>
      </div>
      <div class="host-handle-demo-input" aria-hidden="true">
        <span class="host-handle-at">
          <img src="/union.svg" alt="" />
        </span>
        <span class="host-handle-value-text">
          <span class="host-handle-value-prefix">{prefix}</span>
          <span class="host-handle-demo-window">
            <span class="host-handle-suffix">
              <span class="host-handle-suffix-text">{typedSuffix}</span>
            </span>
          </span>
        </span>
      </div>
      <div class="host-handle-demo-button" aria-hidden="true">
        <img src="/union.svg" alt="" class="host-handle-demo-button-icon" />
        {demoButton}
      </div>
    </div>
  );
}
