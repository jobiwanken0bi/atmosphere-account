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
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.hasAttribute("open")) return;
    event.preventDefault();
    event.stopPropagation();
    menu.removeAttribute("open");
    menu.querySelector("summary")?.focus();
  });
  menu.setAttribute("data-filter-keyboard-ready", "true");
}
