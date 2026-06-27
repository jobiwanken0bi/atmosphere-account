import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";

type Status = "checking" | "pass" | "fail" | "missing";

export default function LoginAppLogoReachability(
  { url }: { url: string | null },
) {
  const status = useSignal<Status>(url ? "checking" : "missing");

  useEffect(() => {
    if (!url) {
      status.value = "missing";
      return;
    }
    status.value = "checking";
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      status.value = "pass";
    };
    img.onerror = () => {
      status.value = "fail";
    };
    img.src = url;
  }, [url]);

  const copy = copyFor(status.value);
  return (
    <article class={`glass account-developer-check is-${copy.tone}`}>
      <span>{copy.badge}</span>
      <h3>Logo reachable</h3>
      <p>{copy.body}</p>
    </article>
  );
}

function copyFor(status: Status): {
  tone: "pass" | "warn" | "fail";
  badge: string;
  body: string;
} {
  if (status === "pass") {
    return {
      tone: "pass",
      badge: "Pass",
      body: "The logo loaded in the browser preview.",
    };
  }
  if (status === "fail") {
    return {
      tone: "fail",
      badge: "Fix",
      body: "The browser could not load the logo URL.",
    };
  }
  if (status === "missing") {
    return {
      tone: "warn",
      badge: "Check",
      body: "Add a logo URL so people can recognize the app in the picker.",
    };
  }
  return {
    tone: "warn",
    badge: "Check",
    body: "Checking whether the logo can load in the browser.",
  };
}
