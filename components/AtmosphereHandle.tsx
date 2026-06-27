interface AtmosphereHandleProps {
  handle: string | null | undefined;
  class?: string;
}

export default function AtmosphereHandle(
  { handle, class: className = "" }: AtmosphereHandleProps,
) {
  const normalized = (handle ?? "").trim().replace(/^@+/, "");
  if (!normalized) return null;
  return (
    <span
      class={`atmosphere-handle${className ? ` ${className}` : ""}`}
      aria-label={`@${normalized}`}
    >
      <span class="atmosphere-handle-icon" aria-hidden="true" />
      <span class="atmosphere-handle-text">{normalized}</span>
    </span>
  );
}
