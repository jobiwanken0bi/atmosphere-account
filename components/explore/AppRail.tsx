import type { AppListing } from "../../lib/app-directory.ts";
import AppCard from "./AppCard.tsx";

interface Props {
  title: string;
  apps: AppListing[];
  variant?: "featured" | "compact";
}

export default function AppRail({ title, apps, variant = "compact" }: Props) {
  if (apps.length === 0) return null;
  return (
    <section class={`app-directory-section app-directory-section--${variant}`}>
      <div class="container">
        <div class="app-directory-section-heading">
          <h2 class="text-subsection featured-rail-heading">{title}</h2>
        </div>
        <div class="featured-rail-track app-rail-track">
          {apps.map((app) => (
            <div key={app.id} class="featured-rail-item app-rail-item">
              <AppCard app={app} compact={variant !== "featured"} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
