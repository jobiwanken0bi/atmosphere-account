import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface Props {
  text: string;
  label?: string;
  copiedLabel?: string;
  failedLabel?: string;
  className?: string;
}

export default function CopyTextButton(
  {
    text,
    label = "Copy",
    copiedLabel = "Copied",
    failedLabel = "Copy failed",
    className = "directory-register-button",
  }: Props,
) {
  const status = useSignal<"idle" | "copied" | "failed">("idle");
  const ready = useSignal(false);

  useEffect(() => {
    ready.value = true;
  }, []);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.value = "copied";
      setTimeout(() => {
        status.value = "idle";
      }, 1600);
    } catch {
      status.value = "failed";
      setTimeout(() => {
        status.value = "idle";
      }, 2000);
    }
  };

  return (
    <button
      type="button"
      class={className}
      onClick={onClick}
      aria-live="polite"
      hidden={!ready.value}
    >
      {status.value === "copied"
        ? copiedLabel
        : status.value === "failed"
        ? failedLabel
        : label}
    </button>
  );
}
