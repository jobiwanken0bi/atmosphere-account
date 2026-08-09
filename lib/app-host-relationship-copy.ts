export type AppHostRelationship =
  | "same_product"
  | "same_operator"
  | "host_only";

export function appHostRelationshipLabel(
  relationship: AppHostRelationship,
): string {
  if (relationship === "same_product") return "App service";
  if (relationship === "same_operator") return "Shared operator";
  return "Host-only override";
}

export function appHostRelationshipDescription(
  relationship: Exclude<AppHostRelationship, "host_only">,
): string {
  return relationship === "same_product"
    ? "This host provides account services for the app."
    : "The app and host are run by the same operator.";
}

export function appHostRelationshipOption(
  relationship: Exclude<AppHostRelationship, "host_only">,
): string {
  return `${appHostRelationshipLabel(relationship)} — ${
    appHostRelationshipDescription(relationship)
  }`;
}
