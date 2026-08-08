interface Props {
  action: string;
  fields: Record<string, string>;
  label: string;
  confirmation: string;
  formClass?: string;
  buttonClass?: string;
  ariaLabel?: string;
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
  }: Props,
) {
  return (
    <form
      method="post"
      action={action}
      class={formClass}
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
      >
        {label}
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
    : `Remove ${account} from saved accounts? You’ll need to sign in with its host to use it again.`;
}

export function disconnectAppConfirmation(appName: string): string {
  return `Remove ${appName} from connected apps? You can connect it again later.`;
}
