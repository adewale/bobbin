// Bostock-inspired reactive word stats: interactive date filtering and live updates.
// Brush-select a time range on the timeline to filter the word stats table to that period.
(function () {
  const table = document.querySelector(".word-stats-table");
  if (!table) return;

  // State
  let fromDate = null;
  let toDate = null;

  // Build the interactive timeline brush
  async function init() {
    const res = await fetch("/api/timeline");
    const data = await res.json();
    if (!data.months || !data.months.length) return;

    const container = document.createElement("div");
    container.className = "reactive-timeline";
    container.innerHTML = `
      <h2>Filter by time range</h2>
      <p class="filter-status">Showing all time</p>
      <div class="brush-area">
        <div class="brush-bars"></div>
        <div class="brush-selection" hidden></div>
      </div>
      <div class="brush-controls">
        <button class="brush-reset" hidden>Clear filter</button>
      </div>
    `;
    table.parentNode.insertBefore(container, table);

    const barsEl = container.querySelector(".brush-bars");
    const statusEl = container.querySelector(".filter-status");
    const resetBtn = container.querySelector(".brush-reset");
    const selectionEl = container.querySelector(".brush-selection");

    const maxCount = Math.max(...data.months.map((m) => m.count));

    // Render bars
    data.months.forEach((m, i) => {
      const bar = document.createElement("div");
      bar.className = "brush-bar";
      bar.style.height = Math.round((m.count / maxCount) * 100) + "%";
      bar.dataset.year = m.year;
      bar.dataset.month = String(m.month).padStart(2, "0");
      bar.title = `${m.year}-${String(m.month).padStart(2, "0")}: ${m.count} episodes, ${m.total_chunks} chunks`;

      // Show label every 3rd bar or on first/last
      if (i % 3 === 0 || i === data.months.length - 1) {
        const label = document.createElement("span");
        label.className = "brush-label";
        label.textContent = `${m.year}-${String(m.month).padStart(2, "0")}`;
        bar.appendChild(label);
      }

      barsEl.appendChild(bar);
    });

    // Brush interaction: click a bar to set start, click another to set end
    let brushStart = null;
    barsEl.addEventListener("click", (e) => {
      const bar = e.target.closest(".brush-bar");
      if (!bar) return;

      const year = bar.dataset.year;
      const month = bar.dataset.month;
      const date = `${year}-${month}-01`;

      if (!brushStart) {
        brushStart = date;
        bar.classList.add("brush-active");
        statusEl.textContent = `From ${year}-${month}...`;
      } else {
        const endDate = `${year}-${month}-31`;
        fromDate = brushStart < date ? brushStart : date;
        toDate = brushStart < date ? endDate : `${brushStart.slice(0, 7)}-31`;
        brushStart = null;

        // Highlight range
        barsEl.querySelectorAll(".brush-bar").forEach((b) => {
          const bDate = `${b.dataset.year}-${b.dataset.month}-01`;
          b.classList.toggle(
            "brush-selected",
            bDate >= fromDate && bDate <= toDate
          );
          b.classList.remove("brush-active");
        });

        statusEl.textContent = `Showing ${fromDate.slice(0, 7)} to ${toDate.slice(0, 7)}`;
        resetBtn.hidden = false;
        updateWordStats();
      }
    });

    resetBtn.addEventListener("click", () => {
      fromDate = null;
      toDate = null;
      brushStart = null;
      barsEl
        .querySelectorAll(".brush-bar")
        .forEach((b) => b.classList.remove("brush-selected", "brush-active"));
      statusEl.textContent = "Showing all time";
      resetBtn.hidden = true;
      updateWordStats();
    });
  }

  async function updateWordStats() {
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = '<tr><td colspan="4" class="loading">Loading...</td></tr>';

    let url = "/api/word-stats?limit=200";
    if (fromDate) url += `&from=${fromDate}`;
    if (toDate) url += `&to=${toDate}`;

    const res = await fetch(url);
    const data = await res.json();

    const tbody = table.querySelector("tbody");
    tbody.innerHTML = data.words
      .map(
        (w) => `<tr>
          <td><a href="/word-stats/${encodeURIComponent(w.word)}">${esc(w.word)}</a></td>
          <td>${w.total_count}</td>
          <td>${w.doc_count} chunk${w.doc_count !== 1 ? "s" : ""}</td>
        </tr>`
      )
      .join("");
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  init();
})();
