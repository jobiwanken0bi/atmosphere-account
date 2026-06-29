import { useSignal } from "@preact/signals";

interface Props {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}

export default function CopyTextButton(
  {
    text,
    label = "Copy",
    copiedLabel = "Copied",
    className = "directory-register-button",
  }: Props,
) {
  const copied = useSignal(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 1600);
    } catch {
      copied.value = false;
    }
  };

  return (
    <button type="button" class={className} onClick={onClick}>
      {copied.value ? copiedLabel : label}
    </button>
  );
}
