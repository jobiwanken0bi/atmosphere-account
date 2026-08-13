export function normalizeExpectedReleaseSha(
  value: string | null,
  label: string,
): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a full 40-character git SHA`);
  }
  return normalized;
}

export function normalizeAllowedReleaseShas(
  value: string | null,
  label: string,
): string[] {
  const raw = value?.trim() ?? "";
  if (!raw) return [];
  const result = new Set<string>();
  for (const token of raw.split(",")) {
    if (!token.trim()) {
      throw new Error(`${label} must not contain an empty SHA`);
    }
    const normalized = normalizeExpectedReleaseSha(token, label);
    if (normalized) result.add(normalized);
  }
  return [...result];
}

export function assertExclusiveReleaseExpectation(
  exactSha: string | null,
  allowedShas: readonly string[],
  exactLabel: string,
  allowedLabel: string,
): void {
  if (exactSha !== null && allowedShas.length > 0) {
    throw new Error(`${exactLabel} and ${allowedLabel} are mutually exclusive`);
  }
}

export function assertAllowedReleaseSha(
  actualSha: string | null,
  allowedShas: readonly string[],
  label: string,
): void {
  if (allowedShas.length === 0) return;
  if (!actualSha) {
    throw new Error(`${label} missing gitSha for allowed releases`);
  }
  if (!allowedShas.includes(actualSha)) {
    throw new Error(
      `${label} gitSha ${actualSha} is not an allowed release`,
    );
  }
}
