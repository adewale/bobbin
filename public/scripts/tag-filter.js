// Tag search: filters visible tags AND queries API for matches not on page
(function () {
  const form = document.querySelector(".search-form");
  if (!form || !document.querySelector(".tag-cloud")) return;

  const input = form.querySelector('input[name="q"]');
  if (!input) return;

  // Create results container
  const resultsDiv = document.createElement("div");
  resultsDiv.className = "tag-search-results";
  form.parentNode.insertBefore(resultsDiv, form.nextSibling);

  let debounce;

  form.addEventListener("submit", (e) => {
    if (window.location.pathname === "/tags") e.preventDefault();
  });

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    const query = input.value.toLowerCase().trim();

    // Filter visible tags
    document.querySelectorAll(".tag").forEach((tag) => {
      const name = tag.textContent.toLowerCase();
      tag.style.display = !query || name.includes(query) ? "" : "none";
    });

    if (query.length < 2) {
      resultsDiv.innerHTML = "";
      return;
    }

    // Query API for tags not visible on page
    debounce = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tags?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        // Filter out tags already visible on page
        const visibleSlugs = new Set(
          [...document.querySelectorAll(".tag")].map((t) =>
            t.getAttribute("href")?.replace("/tags/", "")
          )
        );
        const extra = data.tags.filter((t) => !visibleSlugs.has(t.slug));

        if (extra.length > 0) {
          resultsDiv.innerHTML = extra
            .map(
              (t) =>
                `<a href="/tags/${t.slug}" class="tag" style="font-size:0.8rem">${esc(t.name)}</a>`
            )
            .join(" ");
        } else {
          resultsDiv.innerHTML = "";
        }
      } catch {
        // Ignore API errors
      }
    }, 200);
  });

  input.setAttribute("placeholder", "Filter tags...");

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();
