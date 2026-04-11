// Filter tags on the tags page as user types in the search box
(function () {
  const form = document.querySelector(".search-form");
  if (!form || !document.querySelector(".tag-cloud")) return;

  const input = form.querySelector('input[name="q"]');
  if (!input) return;

  // Prevent form submission — filter inline instead
  form.addEventListener("submit", (e) => {
    if (window.location.pathname === "/tags") {
      e.preventDefault();
    }
  });

  input.addEventListener("input", () => {
    const query = input.value.toLowerCase().trim();
    document.querySelectorAll(".tag").forEach((tag) => {
      const name = tag.textContent.toLowerCase();
      tag.style.display = !query || name.includes(query) ? "" : "none";
    });
  });

  input.setAttribute("placeholder", "Filter tags...");
})();
