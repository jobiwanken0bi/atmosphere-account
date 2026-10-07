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
      <summary class="signin-account-entry-toggle">
        <span class="signin-account-entry-symbol" aria-hidden="true">+</span>
        <span>Add another account</span>
        <svg
          class="signin-account-entry-chevron"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div class="signin-account-entry-body" data-signin-disclosure-body="true">
        <div class="signin-account-entry-content">{children}</div>
      </div>
    </details>
  );
}
