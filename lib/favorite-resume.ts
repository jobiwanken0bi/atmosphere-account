export type FavoriteResumeIntent = "save" | "remove";
export type FavoriteMutationIntent = FavoriteResumeIntent | "toggle";

export function favoriteResumeIntent(
  value: string | null | undefined,
): FavoriteResumeIntent | null {
  return value === "save" || value === "remove" ? value : null;
}

export function favoriteResumeReturnPath(
  identifier: string,
  intent: FavoriteResumeIntent,
): string {
  return `/apps/${encodeURIComponent(identifier)}?favorite=${intent}`;
}

export function favoriteTargetLiked(
  currentlyLiked: boolean,
  intent: FavoriteMutationIntent,
): boolean {
  if (intent === "save") return true;
  if (intent === "remove") return false;
  return !currentlyLiked;
}

export function favoriteRequestMethod(
  currentlyLiked: boolean,
  intent: FavoriteMutationIntent,
): "POST" | "DELETE" | null {
  const targetLiked = favoriteTargetLiked(currentlyLiked, intent);
  if (targetLiked === currentlyLiked) return null;
  return targetLiked ? "POST" : "DELETE";
}
