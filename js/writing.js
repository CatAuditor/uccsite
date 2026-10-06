// /writing filter buttons (templates/writing.html, docs/systems/writing.md).
// Without JavaScript every item shows and the buttons stay hidden. A link to
// /writing#reports (or #statements, #papers) opens with that type selected —
// the Writing menu uses this.
(function initWritingFilters() {
  const bar = document.querySelector('.writing-filters');
  if (!bar) return;
  const buttons = [...bar.querySelectorAll('.writing-filter')];
  const items = [...document.querySelectorAll('.writing-item')];

  function show(type) {
    buttons.forEach(b => {
      const on = b.dataset.type === type;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    items.forEach(it => { it.hidden = Boolean(type) && it.dataset.type !== type; });
  }

  buttons.forEach(b => b.addEventListener('click', () => {
    show(b.dataset.type);
    history.replaceState(null, '', b.dataset.type ? '#' + b.dataset.type + 's' : location.pathname);
  }));

  const fromHash = () => {
    const wanted = location.hash.replace(/^#/, '').replace(/s$/, '');
    show(buttons.some(b => b.dataset.type === wanted) ? wanted : '');
  };
  window.addEventListener('hashchange', fromHash);
  bar.hidden = false;
  fromHash();
}());
