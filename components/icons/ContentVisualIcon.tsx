export type ContentVisualIconName =
  | "app"
  | "blog"
  | "bookmark"
  | "briefcase"
  | "calendar"
  | "checklist"
  | "code"
  | "comment"
  | "feed"
  | "follow"
  | "gallery"
  | "game"
  | "id-card"
  | "like"
  | "list"
  | "music"
  | "new"
  | "pen"
  | "people"
  | "photo"
  | "player"
  | "post"
  | "profile"
  | "reader"
  | "review"
  | "video"
  | "wave";

type ContentVisualIconProps = {
  name: ContentVisualIconName;
  class?: string;
};

export default function ContentVisualIcon(
  { name, class: className }: ContentVisualIconProps,
) {
  return (
    <svg
      class={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {renderIcon(name)}
    </svg>
  );
}

function renderIcon(name: ContentVisualIconName) {
  switch (name) {
    case "app":
      return (
        <>
          <rect x="4" y="4" width="7" height="7" rx="2" />
          <rect x="13" y="4" width="7" height="7" rx="2" />
          <rect x="4" y="13" width="7" height="7" rx="2" />
          <path d="M15 15h4M17 13v4" />
        </>
      );
    case "blog":
      return (
        <>
          <path d="M6 4h8l4 4v12H6z" />
          <path d="M14 4v5h5" />
          <path d="M9 13h6M9 16h4" />
        </>
      );
    case "bookmark":
      return (
        <>
          <path d="M7 4h10a2 2 0 0 1 2 2v15l-7-4-7 4V6a2 2 0 0 1 2-2z" />
          <path d="M9 8h6M9 11h4" />
        </>
      );
    case "briefcase":
      return (
        <>
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
          <path d="M4 12h16M10 12v2h4v-2" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="4" y="5" width="16" height="15" rx="3" />
          <path d="M8 3v4M16 3v4M4 10h16" />
          <path d="M8 14h3M13 14h3M8 17h2" />
        </>
      );
    case "checklist":
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="4" />
          <path d="M8 9l1.4 1.4L12 7.8" />
          <path d="M14 9h3" />
          <path d="M8 15l1.4 1.4L12 13.8" />
          <path d="M14 15h3" />
        </>
      );
    case "code":
      return (
        <>
          <path d="M9 7l-4 5 4 5" />
          <path d="M15 7l4 5-4 5" />
          <path d="M13 5l-2 14" />
        </>
      );
    case "comment":
      return (
        <>
          <path d="M5 6.5A4 4 0 0 1 9 3h6a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-4l-5 4v-4H9a4 4 0 0 1-4-4z" />
          <path d="M9 8h6M9 11h4" />
        </>
      );
    case "feed":
      return (
        <>
          <path d="M5 7h10M5 12h14M5 17h8" />
          <circle cx="18" cy="7" r="1.6" />
          <circle cx="16" cy="17" r="1.6" />
        </>
      );
    case "follow":
      return (
        <>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.8 19a5.3 5.3 0 0 1 10.4 0" />
          <path d="M17 8v6M14 11h6" />
        </>
      );
    case "gallery":
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <circle cx="9" cy="10" r="1.4" />
          <path d="M5 17l4.5-4 3 2.6 2.2-2 4.3 3.4" />
        </>
      );
    case "game":
      return (
        <>
          <path d="M7 9h10a4 4 0 0 1 3.8 5.3l-.7 2A2.6 2.6 0 0 1 15.5 17l-1.7-2h-3.6l-1.7 2a2.6 2.6 0 0 1-4.6-.7l-.7-2A4 4 0 0 1 7 9z" />
          <path d="M8 12v3M6.5 13.5h3" />
          <circle cx="16" cy="12.5" r="0.7" />
          <circle cx="18" cy="14.5" r="0.7" />
        </>
      );
    case "id-card":
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <circle cx="9" cy="11" r="2" />
          <path d="M6.5 16a3 3 0 0 1 5 0" />
          <path d="M14 10h3.5M14 14h3" />
        </>
      );
    case "like":
      return (
        <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
      );
    case "list":
      return (
        <>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M4 6h1M4 12h1M4 18h1" />
        </>
      );
    case "music":
      return (
        <>
          <path d="M9 18V6l10-2v12" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="16" r="2" />
        </>
      );
    case "new":
      return (
        <>
          <path d="M12 3l1.8 5.1L19 10l-5.2 1.9L12 17l-1.8-5.1L5 10l5.2-1.9z" />
          <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
        </>
      );
    case "pen":
      return (
        <>
          <path d="M14.5 5.5l4 4L9 19l-4.5 1 1-4.5z" />
          <path d="M13 7l4 4" />
          <path d="M5 20h14" />
        </>
      );
    case "people":
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M4 19a5 5 0 0 1 10 0" />
          <circle cx="16.5" cy="9" r="2.4" />
          <path d="M14.4 17.5a4.1 4.1 0 0 1 5.6 1.5" />
        </>
      );
    case "photo":
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <circle cx="9" cy="10" r="1.4" />
          <path d="M5 17l4.5-4 3 2.7 2.2-2 4.3 3.3" />
        </>
      );
    case "player":
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <path d="M10 9.5v5l5-2.5z" />
          <path d="M7 17h10" />
        </>
      );
    case "post":
      return (
        <>
          <path d="M5 6h14M5 11h12M5 16h8" />
          <path d="M17 15l2 2 2-5" />
        </>
      );
    case "profile":
      return (
        <>
          <circle cx="12" cy="8" r="3.3" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </>
      );
    case "reader":
      return (
        <>
          <path d="M5 5.5A3.5 3.5 0 0 1 8.5 4H20v15H8.5A3.5 3.5 0 0 0 5 20.5z" />
          <path d="M5 5.5v15M9 8h7M9 11h6M9 14h4" />
        </>
      );
    case "review":
      return (
        <>
          <path d="M12 4l1.9 3.9 4.3.6-3.1 3 0.7 4.3L12 13.8l-3.8 2 0.7-4.3-3.1-3 4.3-.6z" />
          <path d="M5 20h14" />
        </>
      );
    case "video":
      return (
        <>
          <rect x="4" y="6" width="12" height="12" rx="3" />
          <path d="M16 10l4-2v8l-4-2" />
        </>
      );
    case "wave":
      return (
        <>
          <path d="M4 12c1.6-4 3.4-4 5 0s3.4 4 5 0 3.4-4 6 0" />
          <path d="M4 16c1.2-2.4 2.8-2.4 4 0s2.8 2.4 4 0 2.8-2.4 4 0 2.4 2.4 4 0" />
        </>
      );
  }
}
