export type AppStorePlatform = "ios" | "android";

/**
 * Store URLs are stronger evidence than editable labels or role metadata.
 * This also lets us recover gracefully from records whose iOS and Android
 * fields were accidentally crossed before publication.
 */
export function appStorePlatformForUrl(
  value: string | null | undefined,
): AppStorePlatform | null {
  if (!value) return null;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    if (host === "apps.apple.com" || host === "itunes.apple.com") return "ios";
    if (host === "play.google.com") return "android";
  } catch {
    // URL validation belongs to the caller; an invalid URL has no store signal.
  }
  return null;
}

/**
 * Correct crossed official store URLs while preserving non-store destinations
 * in the field the owner selected.
 */
export function normalizeAppStoreLinks(input: {
  iosLink: string | null | undefined;
  androidLink: string | null | undefined;
}): { iosLink: string | null; androidLink: string | null } {
  const candidates = [
    { intended: "ios" as const, value: input.iosLink },
    { intended: "android" as const, value: input.androidLink },
  ].filter((candidate): candidate is {
    intended: AppStorePlatform;
    value: string;
  } => !!candidate.value);
  const used = new Set<number>();
  const output: Record<AppStorePlatform, string | null> = {
    ios: null,
    android: null,
  };

  for (const platform of ["ios", "android"] as const) {
    let index = candidates.findIndex((candidate, candidateIndex) =>
      !used.has(candidateIndex) && candidate.intended === platform &&
      appStorePlatformForUrl(candidate.value) === platform
    );
    if (index < 0) {
      index = candidates.findIndex((candidate, candidateIndex) =>
        !used.has(candidateIndex) &&
        appStorePlatformForUrl(candidate.value) === platform
      );
    }
    if (index >= 0) {
      output[platform] = candidates[index].value;
      used.add(index);
    }
  }

  candidates.forEach((candidate, index) => {
    if (used.has(index)) return;
    if (
      !appStorePlatformForUrl(candidate.value) &&
      !output[candidate.intended]
    ) {
      output[candidate.intended] = candidate.value;
    }
  });

  return { iosLink: output.ios, androidLink: output.android };
}
