// Topic search: filters visible topics AND queries API for matches not on page
(function () {
  const form = document.querySelector(".search-form");
  if (!form || !document.querySelector(".topic-cloud")) return;

  const input = form.querySelector('input[name="q"]');
  if (!input) return;

  // Create results container
  const resultsDiv = document.createElement("div");
  resultsDiv.className = "topic-search-results";
  form.parentNode.insertBefore(resultsDiv, form.nextSibling);

  let debounce;

  form.addEventListener("submit", (e) => {
    if (window.location.pathname === "/topics") e.preventDefault();
  });

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    const query = input.value.toLowerCase().trim();

    // Filter visible topics
    document.querySelectorAll(".topic").forEach((topic) => {
      const name = topic.textContent.toLowerCase();
      topic.style.display = !query || name.includes(query) ? "" : "none";
    });

    if (query.length < 2) {
      resultsDiv.innerHTML = "";
      return;
    }

    // Query API for topics not visible on page
    debounce = setTimeout(async () => {
      try {
        const res = await fetch(`/api/topics?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        // Filter out topics already visible on page
        const visibleSlugs = new Set(
          [...document.querySelectorAll(".topic")].map((t) =>
            t.getAttribute("href")?.replace("/topics/", "")
          )
        );
        const extra = data.topics.filter((t) => !visibleSlugs.has(t.slug));

        if (extra.length > 0) {
          resultsDiv.innerHTML = extra
            .map(
              (t) =>
                `<a href="/topics/${t.slug}" class="topic" style="font-size:0.8rem">${esc(t.name)}</a>`
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

  input.setAttribute("placeholder", "Filter topics...");

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();
