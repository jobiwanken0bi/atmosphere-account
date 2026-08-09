export function loginEnvironmentLabel(clientId: string): string {
  try {
    const url = new URL(clientId);
    const hostname = url.hostname.replace(/^www\./, "");
    if (
      hostname === "localhost" || hostname === "127.0.0.1" ||
      hostname === "[::1]"
    ) {
      return "Local development";
    }
    return hostname || "Login environment";
  } catch {
    return "Login environment";
  }
}

export function loginEnvironmentStatusLabel(
  status: "trusted" | "unverified" | "development" | "blocked",
): string {
  switch (status) {
    case "trusted":
      return "Trusted";
    case "development":
      return "Development";
    case "blocked":
      return "Blocked";
    default:
      return "Unverified";
  }
}
