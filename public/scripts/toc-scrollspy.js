(function () {
  const toc = document.querySelector(".page-toc");
  if (!toc) return;

  const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
  const sections = links
    .map((a) => document.getElementById(a.getAttribute("href").slice(1)))
    .filter(Boolean);
  if (!sections.length) return;

  function openIfDetails(id) {
    const el = document.getElementById(id);
    if (el && el.tagName === "DETAILS" && !el.open) el.open = true;
  }

  links.forEach((a) => {
    a.addEventListener("click", () => openIfDetails(a.getAttribute("href").slice(1)));
  });

  if (location.hash) openIfDetails(location.hash.slice(1));
  window.addEventListener("hashchange", () => openIfDetails(location.hash.slice(1)));

  const linkFor = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  let active = null;
  const visible = new Set();

  function refresh() {
    let best = null;
    let bestTop = Infinity;
    for (const id of visible) {
      const el = document.getElementById(id);
      if (!el) continue;
      const top = el.getBoundingClientRect().top;
      if (top < bestTop) {
        bestTop = top;
        best = id;
      }
    }
    if (best && best !== active) {
      if (active) linkFor.get(active)?.removeAttribute("aria-current");
      linkFor.get(best)?.setAttribute("aria-current", "true");
      active = best;
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      refresh();
    },
    { rootMargin: "-20% 0% -60% 0%", threshold: 0 },
  );

  sections.forEach((section) => observer.observe(section));
})();
