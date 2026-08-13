import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

export default function HostManageSavedStatus(
  { saved }: { saved: boolean },
) {
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const visible = useSignal(saved);

  useEffect(() => {
    if (!saved) return;
    const form = statusRef.current?.closest("form");
    if (!form) return;

    const clear = () => {
      visible.value = false;
    };
    form.addEventListener("input", clear);

    const url = new URL(globalThis.location.href);
    if (
      url.searchParams.has("saved") ||
      url.searchParams.get("listing") === "saved"
    ) {
      url.searchParams.delete("saved");
      url.searchParams.delete("listing");
      globalThis.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }

    return () => {
      form.removeEventListener("input", clear);
    };
  }, []);

  if (!visible.value) return null;
  return (
    <span ref={statusRef} class="host-manage-saved" role="status">
      <span aria-hidden="true">✓</span>
      Saved
    </span>
  );
}
