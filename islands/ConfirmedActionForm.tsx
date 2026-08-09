interface Props {
  action: string;
  fields: Record<string, string>;
  label: string;
  confirmation: string;
  formClass?: string;
  buttonClass?: string;
  ariaLabel?: string;
  pendingLabel?: string;
}

/** A progressively enhanced real POST form for destructive account actions. */
export default function ConfirmedActionForm(
  {
    action,
    fields,
    label,
    confirmation,
    formClass,
    buttonClass = "account-dashboard-mini-button",
    ariaLabel,
    pendingLabel,
  }: Props,
) {
  return (
    <form
      method="post"
      action={action}
      class={formClass}
      data-submit-once="true"
      onSubmit={(event) => {
        if (!globalThis.confirm(confirmation)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        class={buttonClass}
        aria-label={ariaLabel}
        data-pending-label={pendingLabel ??
          (label.startsWith("Delete") ? "Deleting…" : "Removing…")}
      >
        <span data-submit-once-label>{label}</span>
      </button>
    </form>
  );
}

export function forgetAccountConfirmation(
  handle: string,
  isCurrent: boolean,
): string {
  const account = `@${handle.replace(/^@/, "")}`;
  return isCurrent
    ? `Remove ${account} from saved accounts? This will also sign you out.`
    : `Remove ${account} from saved accounts? You’ll need to use Login with Atmosphere again to switch back.`;
}

export function disconnectAppConfirmation(appName: string): string {
  return `Remove ${appName} from connected apps? You can connect it again later.`;
}
