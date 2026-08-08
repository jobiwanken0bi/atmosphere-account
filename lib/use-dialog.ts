import { useEffect, useRef } from "preact/hooks";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

let openDialogCount = 0;
let previousBodyOverflow = "";
const dialogStack: HTMLElement[] = [];

interface BackgroundMaskState {
  count: number;
  inert: boolean;
  inertAttribute: boolean;
  ariaHidden: string | null;
}

const backgroundMaskStates = new WeakMap<HTMLElement, BackgroundMaskState>();
const NON_RENDERED_ELEMENTS = new Set(["LINK", "META", "SCRIPT", "STYLE"]);

function maskBackground(element: HTMLElement) {
  const existing = backgroundMaskStates.get(element);
  if (existing) {
    existing.count += 1;
  } else {
    backgroundMaskStates.set(element, {
      count: 1,
      inert: Boolean(element.inert),
      inertAttribute: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    });
  }
  element.inert = true;
  element.setAttribute("inert", "");
  element.setAttribute("aria-hidden", "true");
}

function unmaskBackground(element: HTMLElement) {
  const state = backgroundMaskStates.get(element);
  if (!state) return;
  state.count -= 1;
  if (state.count > 0) return;

  element.inert = state.inert;
  if (state.inertAttribute) {
    element.setAttribute("inert", "");
  } else {
    element.removeAttribute("inert");
  }
  if (state.ariaHidden === null) {
    element.removeAttribute("aria-hidden");
  } else {
    element.setAttribute("aria-hidden", state.ariaHidden);
  }
  backgroundMaskStates.delete(element);
}

function backgroundSiblings(card: HTMLElement): HTMLElement[] {
  const targets = new Set<HTMLElement>();
  let branch: HTMLElement | null =
    card.closest<HTMLElement>(".modal-backdrop") ?? card;

  while (branch && branch !== document.body) {
    const parent: HTMLElement | null = branch.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (
        sibling !== branch && sibling instanceof HTMLElement &&
        !NON_RENDERED_ELEMENTS.has(sibling.tagName)
      ) {
        targets.add(sibling);
      }
    }
    branch = parent;
  }

  return [...targets];
}

/**
 * Accessible modal-dialog behaviour for a card element. Attach the returned
 * ref to the dialog card (the element with `role="dialog"`). While `open`:
 *  - moves keyboard focus into the dialog (remembering the trigger),
 *  - closes on Escape,
 *  - traps Tab focus inside the dialog,
 *  - makes the page behind the active dialog inert,
 *  - restores focus to the trigger when it closes.
 *
 * `onClose` is read through a ref so the latest handler is always used without
 * re-running the effect (which would steal focus mid-interaction).
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const card = ref.current;
    if (!card) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (openDialogCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openDialogCount += 1;
    dialogStack.push(card);

    // `aria-modal` communicates modality, while `inert` also prevents the
    // background from being reached by pointer, keyboard, or virtual cursor.
    // Reference counts preserve prior state when dialogs are nested.
    const maskedBackground = backgroundSiblings(card);
    maskedBackground.forEach(maskBackground);

    const isRendered = (element: HTMLElement) => {
      const style = globalThis.getComputedStyle(element);
      return !element.hidden && style.display !== "none" &&
        style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const focusable = () =>
      Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(isRendered);

    // Prefer the action's account/input over a utility close control.
    const preferredFocus = () => {
      return Array.from(
        card.querySelectorAll<HTMLElement>(
          '[data-dialog-initial-focus="true"]',
        ),
      ).find(isRendered) ?? null;
    };
    const initiallyFocused = preferredFocus() ?? focusable()[0] ?? card;
    initiallyFocused.focus();

    // A contextual dialog can contain a nested Fresh island. Its preferred
    // account/input may be inserted just after this parent effect runs, so
    // watch briefly instead of leaving keyboard users on the utility close
    // button. Never steal focus after the person has moved elsewhere.
    const focusObserver = new MutationObserver(() => {
      const preferred = preferredFocus();
      const active = document.activeElement;
      if (!preferred) return;
      focusObserver.disconnect();
      if (
        active === initiallyFocused || active === card ||
        !card.contains(active)
      ) preferred.focus();
    });
    focusObserver.observe(card, { childList: true, subtree: true });
    const focusFrame = requestAnimationFrame(() => {
      const preferred = preferredFocus();
      if (!preferred) return;
      focusObserver.disconnect();
      if (
        document.activeElement === initiallyFocused ||
        document.activeElement === card
      ) preferred.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      // When dialogs are nested, only the topmost one owns Escape and Tab.
      if (dialogStack[dialogStack.length - 1] !== card) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        card.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !card.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !card.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      focusObserver.disconnect();
      document.removeEventListener("keydown", onKeyDown);
      const stackIndex = dialogStack.lastIndexOf(card);
      if (stackIndex >= 0) dialogStack.splice(stackIndex, 1);
      openDialogCount = Math.max(0, openDialogCount - 1);
      if (openDialogCount === 0) {
        document.body.style.overflow = previousBodyOverflow;
      }
      maskedBackground.forEach(unmaskBackground);
      // Restore focus to whatever opened the dialog.
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return ref;
}
