export type ManagementActionIconName = "edit" | "host";

export default function ManagementActionIcon(
  { name }: { name: ManagementActionIconName },
) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  } as const;

  if (name === "edit") {
    return (
      <svg {...common}>
        <path d="M12 20h8" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4.5 10.5 12 4l7.5 6.5" />
      <path d="M6.5 9.5V19h11V9.5" />
      <path d="M10 19v-5h4v5" />
    </svg>
  );
}
