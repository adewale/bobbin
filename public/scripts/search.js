// Progressive enhancement: live search via API
(function () {
  const form = document.querySelector(".search-form");
  if (!form) return;

  const input = form.querySelector('input[name="q"]');
  const resultsContainer = document.querySelector(".search-results");
  if (!input || !resultsContainer) return;

  let debounceTimer;

  input.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const query = input.value.trim();
      if (query.length < 2) return;

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        resultsContainer.innerHTML = `
          <p>${data.count} result${data.count !== 1 ? "s" : ""} for &ldquo;${escapeHtml(query)}&rdquo;</p>
          ${data.results
            .map(
              (r) => `
            <article class="chunk-card">
              <h3><a href="/chunks/${r.slug}">${escapeHtml(r.title)}</a></h3>
              <span class="episode-link">from <a href="/episodes/${r.episode_slug}">${escapeHtml(r.episode_title)}</a></span>
              ${r.summary ? `<p class="summary">${escapeHtml(r.summary)}</p>` : ""}
            </article>
          `
            )
            .join("")}
        `;
      } catch {
        // Fall back to form submission
      }
    }, 300);
  });

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
