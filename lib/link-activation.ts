export interface LinkActivationModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * A `click` event already represents primary-pointer or keyboard activation.
 * Only modifier keys should bypass progressive enhancement so the browser can
 * keep its native new-tab/new-window behavior. Some keyboard and automation
 * environments do not expose a meaningful `button` value on `click`.
 */
export function isPlainLinkActivation(
  event: LinkActivationModifiers,
): boolean {
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
