/** Normalize an optional UI hint consistently across sign-in and the picker. */
export function normalizeSignInHandleHint(
  raw: string | null,
): string | undefined {
  const handle = raw?.trim().replace(/^@/, "").toLowerCase();
  return handle && handle.length <= 253 &&
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
        handle,
      )
    ? handle
    : undefined;
}
