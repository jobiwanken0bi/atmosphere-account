import type { ComponentChildren } from "preact";

/** Native disclosure remains usable before hydration and without JavaScript. */
export default function AccountEntryDisclosure(
  { children, open = false }: { children: ComponentChildren; open?: boolean },
) {
  return (
    <details
      class="signin-account-entry"
      data-signin-disclosure="true"
      open={open}
    >
      <summary class="profile-form-button-secondary login-picker-secondary">
        <span class="signin-account-entry-symbol" aria-hidden="true">+</span>
        Add another account
      </summary>
      <div class="signin-account-entry-body" data-signin-disclosure-body="true">
        <div class="signin-account-entry-content">{children}</div>
      </div>
    </details>
  );
}
