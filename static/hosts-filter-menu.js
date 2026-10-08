const menus = [...document.querySelectorAll(".hosts-filter-menu")];

function closeMenus() {
  for (const menu of menus) menu.removeAttribute("open");
}

document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (menus.some((menu) => menu.contains(target))) return;
  closeMenus();
});

for (const menu of menus) {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !menu.open) return;
    if (
      [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
        .some((dialog) => dialog.getClientRects().length > 0)
    ) return;
    const restoreFocus = menu.contains(document.activeElement) ||
      document.activeElement === document.body;
    event.preventDefault();
    event.stopPropagation();
    menu.removeAttribute("open");
    if (restoreFocus) menu.querySelector("summary")?.focus();
  });
  menu.setAttribute("data-filter-keyboard-ready", "true");
}
