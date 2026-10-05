/* Utah Civic Compact — petition pages (docs/systems/petition.md)
   /petition        : the signature form → POST /api/petition → /petition-thanks
   /petition-thanks : "I can help" payment modal → POST /api/create-checkout-session
   The signer's name/email/zip ride along in sessionStorage so the checkout
   is prefilled; nothing else is stored client-side. Debug prefix: [petition]. */

// ── /petition: signature form ──────────────────────────────────────────────
(function initPetitionForm() {
  const form = document.getElementById('petition-form');
  if (!form) return;
  const btn = document.getElementById('petition-submit');
  const errorEl = document.getElementById('petition-error');
  const idle = btn.textContent;

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.add('is-visible');
  }
  function clearError() {
    errorEl.textContent = '';
    errorEl.classList.remove('is-visible');
    form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  }
  function value(id) { return form.querySelector('#' + id).value.trim(); }
  function invalid(id, msg) {
    form.querySelector('#' + id).classList.add('is-invalid');
    form.querySelector('#' + id).focus();
    showError(msg);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const payload = {
      petition: form.dataset.petition,
      firstName: value('first-name'),
      lastName: value('last-name'),
      email: value('email'),
      zip: value('zip'),
      address: value('address'),
      phone: value('phone'),
      // Present only when the Turnstile widget is rendered (settings.turnstileSiteKey set)
      turnstileToken: window.turnstile ? window.turnstile.getResponse() : undefined,
    };

    if (!payload.firstName) return invalid('first-name', 'Please enter your first name.');
    if (!payload.lastName) return invalid('last-name', 'Please enter your last name.');
    if (!/^\d{5}(-\d{4})?$/.test(payload.zip)) return invalid('zip', 'Please enter a 5-digit ZIP code.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return invalid('email', 'Please enter a valid email address.');

    btn.disabled = true;
    btn.textContent = 'Signing…';

    try {
      const res = await fetch('/api/petition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        try {
          sessionStorage.setItem('petition-signer', JSON.stringify({
            petition: payload.petition, firstName: payload.firstName, lastName: payload.lastName,
            email: payload.email, zip: payload.zip,
          }));
        } catch (_) {}
        window.location.href = '/petition-thanks';
        return;
      }
      const data = await res.json().catch(() => ({}));
      console.warn('[petition] sign failed:', res.status);
      showError(data.error || 'Something went wrong. Please try again.');
      if (window.turnstile) window.turnstile.reset();
    } catch (_) {
      console.warn('[petition] sign network error');
      showError('Network error. Please check your connection and try again.');
    }
    btn.disabled = false;
    btn.textContent = idle;
  });
}());

// ── /petition-thanks: payment modal ────────────────────────────────────────
(function initPetitionThanks() {
  const overlay = document.getElementById('petition-modal');
  const helpBtn = document.getElementById('petition-help');
  if (!overlay || !helpBtn || typeof createModal !== 'function') return;

  const modal = createModal(overlay);
  const tiers = overlay.querySelectorAll('.tier-btn');
  const checkoutBtn = document.getElementById('petition-checkout');
  const errorEl = document.getElementById('petition-modal-error');
  let amountCents = 2500; // $25 preselected

  let signer = {};
  try { signer = JSON.parse(sessionStorage.getItem('petition-signer') || '{}') || {}; } catch (_) {}

  helpBtn.addEventListener('click', () => modal.show());

  tiers.forEach(t => {
    t.addEventListener('click', () => {
      tiers.forEach(b => b.classList.remove('active'));
      t.classList.add('active');
      amountCents = parseInt(t.dataset.amount, 10);
    });
  });

  checkoutBtn.addEventListener('click', async () => {
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Redirecting to checkout…';
    errorEl.classList.add('is-hidden');
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'onetime',
          amountCents,
          email: signer.email || '',
          firstName: signer.firstName || '',
          lastName: signer.lastName || '',
          zip: signer.zip || '',
          newsletterOptIn: true, // they agreed to communications when signing
          publicDonor: document.getElementById('petition-public').checked,
          source: signer.petition ? 'petition:' + signer.petition : 'petition',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) { window.location.href = data.url; return; }
      throw new Error(data.error || 'Something went wrong.');
    } catch (err) {
      console.warn('[petition] checkout failed');
      errorEl.textContent = err.message;
      errorEl.classList.remove('is-hidden');
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = 'Continue to checkout';
    }
  });
}());

// ── Signature counter (hero + /petition) ───────────────────────────────────
// Fills every [data-petition-count] from GET /api/petition/count (Utah
// signers only; the API caches ~1 min). Hidden until there is at least one.
(function initPetitionCount() {
  const els = document.querySelectorAll('[data-petition-count]');
  if (!els.length) return;
  els.forEach(async (el) => {
    const slug = el.dataset.petitionCount;
    const label = el.dataset.countLabel || '';
    if (!slug || !label.includes('{count}')) return;
    try {
      const res = await fetch('/api/petition/count?petition=' + encodeURIComponent(slug));
      if (!res.ok) return;
      const { count } = await res.json();
      if (!count) return;
      const [before, after] = label.split('{count}');
      const strong = document.createElement('strong');
      strong.textContent = Number(count).toLocaleString('en-US');
      el.textContent = '';
      el.append(before, strong, after);
      el.removeAttribute('hidden');
    } catch (_) {
      console.warn('[petition] count unavailable');
    }
  });
}());
