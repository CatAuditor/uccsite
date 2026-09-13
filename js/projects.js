// Projects page: client-side filter (status, region) and sort (featured
// order, name A–Z, newest first) over the server-rendered project blocks.
// Progressive enhancement: the controls are hidden until this runs, the
// data lives in data-* attributes set by the template, and nothing here
// touches inline styles (CSP style-src 'self').
(function () {
  var controls = document.getElementById('project-filters');
  var list = document.getElementById('project-list');
  if (!controls || !list) return;
  var blocks = Array.prototype.slice.call(list.querySelectorAll('.project-block'));
  blocks.forEach(function (b, i) { b.dataset.index = String(i); });
  var status = controls.querySelector('[data-filter="status"]');
  var region = controls.querySelector('[data-filter="region"]');
  var sort = controls.querySelector('[data-sort]');
  var count = controls.querySelector('[data-count]');

  function apply() {
    var s = status.value, r = region.value, order = sort.value;
    var visible = 0;
    var sorted = blocks.slice().sort(function (a, b) {
      if (order === 'name') return a.dataset.name.localeCompare(b.dataset.name);
      if (order === 'date') return (Number(b.dataset.date) || 0) - (Number(a.dataset.date) || 0);
      return Number(a.dataset.index) - Number(b.dataset.index);
    });
    var lastVisible = null;
    sorted.forEach(function (b) {
      var show = (!s || b.dataset.status === s) && (!r || b.dataset.region === r);
      b.hidden = !show;
      b.classList.remove('is-last');
      if (show) { visible++; lastVisible = b; }
      list.appendChild(b); // re-append in sorted order
    });
    if (lastVisible) lastVisible.classList.add('is-last');
    if (count) count.textContent = visible === blocks.length ? '' : visible + ' of ' + blocks.length + ' projects';
  }
  [status, region, sort].forEach(function (el) { el.addEventListener('change', apply); });
  controls.hidden = false;
})();
