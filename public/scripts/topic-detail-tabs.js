(function () {
  const tabList = document.querySelector('[data-topic-tab-list]');
  if (!tabList) return;

  const tabs = Array.from(tabList.querySelectorAll('[data-topic-tab]'));
  const panelMap = new Map(
    Array.from(document.querySelectorAll('[data-topic-tab-panel]')).map((panel) => [panel.getAttribute('data-topic-tab-panel'), panel]),
  );
  const orderedIds = tabs.map((tab) => tab.getAttribute('data-topic-tab')).filter((id) => panelMap.has(id));
  if (orderedIds.length === 0) return;
  const observationPanel = panelMap.get('observations');

  async function refreshObservations(href, focusSelector) {
    if (!observationPanel) {
      window.location.assign(href);
      return;
    }

    observationPanel.style.minHeight = `${observationPanel.offsetHeight}px`;
    observationPanel.classList.add('is-loading');
    observationPanel.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(href, { headers: { 'X-Requested-With': 'topic-observations' } });
      if (!response.ok) throw new Error(`Failed to fetch ${href}`);

      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const nextPanel = doc.querySelector('[data-topic-tab-panel="observations"]');
      if (!nextPanel) throw new Error('Missing observations panel');

      observationPanel.innerHTML = nextPanel.innerHTML;
      history.replaceState(null, '', href);
      applyTab(resolveTabFromHash(location.hash));

      if (focusSelector) {
        const nextFocus = observationPanel.querySelector(focusSelector);
        if (nextFocus) {
          nextFocus.focus();
          return;
        }
      }

      const heading = observationPanel.querySelector('h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
    } catch (_error) {
      window.location.assign(href);
    } finally {
      observationPanel.classList.remove('is-loading');
      observationPanel.removeAttribute('aria-busy');
      observationPanel.style.minHeight = '';
    }
  }

  function resolveTabFromHash(hash) {
    const id = (hash || '').replace(/^#/, '');
    return panelMap.has(id) ? id : orderedIds[0];
  }

  function syncPaginationLinks(id) {
    document.querySelectorAll('.pagination a').forEach((link) => {
      const href = link.getAttribute('href');
      if (!href) return;
      const base = href.split('#')[0];
      link.setAttribute('href', `${base}#${id}`);
    });
  }

  function applyTab(id) {
    tabs.forEach((tab) => {
      const active = tab.getAttribute('data-topic-tab') === id;
      tab.classList.toggle('is-active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.setAttribute('tabindex', active ? '0' : '-1');
    });

    panelMap.forEach((panel, panelId) => {
      const active = panelId === id;
      panel.hidden = !active;
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });

    syncPaginationLinks(id);
  }

  tabList.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    const currentIndex = tabs.findIndex((tab) => tab.getAttribute('data-topic-tab') === resolveTabFromHash(location.hash));
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    const id = nextTab && nextTab.getAttribute('data-topic-tab');
    if (!id) return;
    history.replaceState(null, '', `#${id}`);
    applyTab(id);
    nextTab.focus();
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      const id = tab.getAttribute('data-topic-tab');
      if (!id) return;
      history.replaceState(null, '', `#${id}`);
      applyTab(id);
    });
  });

  if (observationPanel) {
    document.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('[data-topic-observation-nav="sort"], [data-topic-tab-panel="observations"] .pagination a');
      if (!link) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const href = link.getAttribute('href');
      if (!href) return;

      event.preventDefault();

      const sortKey = link.getAttribute('data-topic-observation-sort');
      const rel = link.getAttribute('rel');
      const focusSelector = sortKey
        ? `[data-topic-observation-sort="${sortKey}"]`
        : rel
          ? `.pagination a[rel="${rel}"]`
          : '.pagination a';

      await refreshObservations(href, focusSelector);
    });
  }

  window.addEventListener('hashchange', () => {
    applyTab(resolveTabFromHash(location.hash));
  });

  applyTab(resolveTabFromHash(location.hash));
})();
