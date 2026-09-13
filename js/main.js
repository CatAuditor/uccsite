/* Utah Compact — Main JS */

// Sticky nav + hero parallax on scroll
const header = document.getElementById('site-header');
const heroBg = document.querySelector('.hero-bg');

function onScroll() {
  const sy = window.scrollY;

  if (header) header.classList.toggle('scrolled', sy > 40);

  // Subtle parallax — only while hero is in view
  if (heroBg && sy < window.innerHeight) {
    heroBg.style.transform = `translateY(${sy * 0.22}px)`;
  }
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Mobile nav toggle
const navToggle = document.getElementById('nav-toggle');
const navLinks = document.getElementById('nav-links');
if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', isOpen);
    navToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
  });

  // Close mobile nav on link click
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', false);
    });
  });
}

// Scroll-in animations: one shared observer
const animateObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        animateObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
);

// Staggered card animations
[
  '.pillars-grid .pillar-card',
  '.issues-grid .issue-card',
  '.footer-grid > *',
].forEach(selector => {
  document.querySelectorAll(selector).forEach((el, i) => {
    el.setAttribute('data-animate', '');
    el.setAttribute('data-animate-delay', Math.min(i + 1, 4));
  });
});

document.querySelectorAll('[data-animate]').forEach(el => animateObserver.observe(el));

// Join form submission
const form = document.getElementById('join-form');
const formSuccess = document.getElementById('form-success');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const errorEl = form.querySelector('.form-error');
    btn.textContent = 'Joining...';
    btn.disabled = true;
    if (errorEl) errorEl.remove();

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.querySelector('#email').value,
          firstName: form.querySelector('#first-name').value,
          lastName: form.querySelector('#last-name').value,
          address: form.querySelector('#address').value,
          zip: form.querySelector('#zip').value,
          // Present only when the Turnstile widget is rendered (settings.turnstileSiteKey set)
          turnstileToken: window.turnstile ? window.turnstile.getResponse() : undefined,
        }),
      });

      if (res.ok) {
        form.style.display = 'none';
        if (formSuccess) formSuccess.style.display = 'block';
      } else {
        const data = await res.json().catch(() => ({}));
        showFormError(form, data.error || 'Something went wrong. Please try again.');
        btn.textContent = 'Join the Compact';
        btn.disabled = false;
        if (window.turnstile) window.turnstile.reset();
      }
    } catch {
      showFormError(form, 'Network error. Please check your connection and try again.');
      btn.textContent = 'Join the Compact';
      btn.disabled = false;
    }
  });
}

function showFormError(form, msg) {
  const p = document.createElement('p');
  p.className = 'form-error';
  p.style.cssText = 'color:#c0392b;font-size:14px;margin-top:8px;';
  p.textContent = msg;
  form.appendChild(p);
}

// ── Donate form ──────────────────────────────────────────────────
(function initDonate() {
  const toggleBtns = document.querySelectorAll('.toggle-btn');
  const tierBtns = document.querySelectorAll('.tier-btn');
  const customWrap = document.getElementById('donate-custom-wrap');
  const customInput = document.getElementById('donate-custom-amount');
  const submitBtn = document.getElementById('donate-submit');
  const errorEl = document.getElementById('donate-error');

  if (!submitBtn) return;

  let currentType = 'subscription';
  let selectedAmountCents = 2500;
  let isCustom = false;

  // Monthly/one-time toggle
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;

      // Update /mo labels on tier buttons
      document.querySelectorAll('.tier-btn span').forEach(span => {
        span.textContent = currentType === 'subscription' ? '/mo' : '';
      });
    });
  });

  // Tier selection
  tierBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tierBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (btn.dataset.amount === 'custom') {
        isCustom = true;
        customWrap.style.display = 'block';
        customInput.focus();
      } else {
        isCustom = false;
        selectedAmountCents = parseInt(btn.dataset.amount, 10);
        customWrap.style.display = 'none';
      }
    });
  });

  // Submit
  submitBtn.addEventListener('click', async () => {
    const firstName = document.getElementById('donate-first').value.trim();
    const lastName = document.getElementById('donate-last').value.trim();
    const email = document.getElementById('donate-email').value.trim();
    const zip = document.getElementById('donate-zip').value.trim();
    const newsletterOptIn = document.getElementById('donate-newsletter').checked;

    let amountCents = selectedAmountCents;

    if (isCustom) {
      const raw = parseFloat(customInput.value);
      if (!raw || raw < 1) {
        showError('Please enter an amount of at least $1.');
        return;
      }
      amountCents = Math.round(raw * 100);
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Please enter a valid email address.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Redirecting to checkout…';
    errorEl.style.display = 'none';

    try {
      const publicDonor = document.getElementById('donate-public')?.checked !== false;
      const body = { type: currentType, amountCents, email, firstName, lastName, zip, newsletterOptIn, publicDonor };

      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Something went wrong.');
      }
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Support Utah Compact';
    }
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
})();

// Animated counter for impact stats
function animateCounter(el, target, suffix, decimals, duration = 1400) {
  const start = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = eased * target;
    el.textContent = (decimals > 0 ? value.toFixed(decimals) : Math.round(value)) + suffix;
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

const counterEl = document.querySelector('[data-count]');
if (counterEl) {
  const raw = counterEl.dataset.count;
  const suffix = raw.replace(/[\d.]/g, '');
  const numeric = parseFloat(raw);
  const decimals = raw.includes('.') ? raw.split('.')[1].replace(/\D/g, '').length : 0;
  const counterObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target, numeric, suffix, decimals);
          counterObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.6 }
  );
  counterObserver.observe(counterEl);
}

// Dropdown navigation
const navDropdowns = document.querySelectorAll('.nav-dropdown');

function setDropdown(dropdown, open) {
  dropdown.classList.toggle('open', open);
  dropdown.querySelector('.nav-dropdown-toggle')?.setAttribute('aria-expanded', String(open));
}
function closeAllDropdowns() {
  navDropdowns.forEach(d => setDropdown(d, false));
}

navDropdowns.forEach((dropdown, i) => {
  const toggle = dropdown.querySelector('.nav-dropdown-toggle');
  const menu = dropdown.querySelector('.nav-dropdown-menu');
  if (!toggle || !menu) return;

  if (!menu.id) menu.id = `nav-dropdown-menu-${i}`;
  toggle.setAttribute('aria-controls', menu.id);

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) setDropdown(dropdown, true);
  });

  // Keep aria-expanded truthful for the CSS :hover path on desktop
  dropdown.addEventListener('mouseenter', () => toggle.setAttribute('aria-expanded', 'true'));
  dropdown.addEventListener('mouseleave', () => {
    if (!dropdown.classList.contains('open')) toggle.setAttribute('aria-expanded', 'false');
  });

  dropdown.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('a')];
    if (e.key === 'Escape') {
      setDropdown(dropdown, false);
      toggle.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!dropdown.classList.contains('open')) setDropdown(dropdown, true);
      const idx = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown'
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
      next?.focus();
    }
  });

  // Close when focus leaves the dropdown (keyboard users tabbing away)
  dropdown.addEventListener('focusout', (e) => {
    if (!dropdown.contains(e.relatedTarget)) setDropdown(dropdown, false);
  });
});
document.addEventListener('click', closeAllDropdowns);

// Active nav link highlighting
const sections = document.querySelectorAll('section[id]');
const navAnchors = document.querySelectorAll('.nav-links a[href^="/#"]');

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navAnchors.forEach(a => {
          a.classList.toggle('active', a.getAttribute('href') === `/#${id}`);
        });
      }
    });
  },
  { rootMargin: '-40% 0px -55% 0px' }
);
sections.forEach(s => sectionObserver.observe(s));

// Donation modal — shows after 7.5s, dismissed per session
(function () {
  const overlay = document.getElementById('donate-modal');
  if (!overlay) return;

  let dismissed = false;
  try { dismissed = !!sessionStorage.getItem('modal-dismissed'); } catch (_) {}
  if (dismissed) return;

  // Hidden state: out of the tab order and the accessibility tree.
  overlay.setAttribute('inert', '');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.removeAttribute('aria-modal');

  let previousFocus = null;

  function isOpen() { return overlay.classList.contains('modal-visible'); }

  function show() {
    previousFocus = document.activeElement;
    overlay.removeAttribute('inert');
    overlay.removeAttribute('aria-hidden');
    overlay.setAttribute('aria-modal', 'true');
    overlay.classList.add('modal-visible');
    (overlay.querySelector('#modal-close') || overlay).focus();
  }

  function hide() {
    if (!isOpen()) return;
    overlay.classList.remove('modal-visible');
    overlay.setAttribute('inert', '');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.removeAttribute('aria-modal');
    try { sessionStorage.setItem('modal-dismissed', '1'); } catch (_) {}
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  setTimeout(show, 7500);

  ['modal-close', 'modal-dismiss', 'modal-cta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', hide);
  });
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) hide();
  });
  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { hide(); return; }
    // Keep Tab inside the dialog
    if (e.key === 'Tab') {
      const focusable = overlay.querySelectorAll('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}());

// Donation tracker — recent public donors only. The site shows no running
// total or goal by org policy (docs/build-spec-aws.md, planning addendum 2).
(async function initDonationTracker() {
  const tracker = document.getElementById('donation-tracker');
  if (!tracker) return;

  try {
    const res = await fetch('/api/donations/stats');
    if (!res.ok) return;
    const { recent } = await res.json();
    if (!recent || !recent.length) return; // nothing to show — stay hidden

    const fmt = cents => '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const list = document.getElementById('tracker-recent');
    const heading = document.createElement('p');
    heading.className = 'tracker-recent-heading';
    heading.textContent = 'Recent donors';
    list.parentElement.insertBefore(heading, list);
    recent.forEach(({ firstName, amountCents }) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'tracker-donor-name';
      name.textContent = firstName; // user-supplied — never innerHTML
      const amount = document.createElement('span');
      amount.className = 'tracker-donor-amount';
      amount.textContent = fmt(amountCents);
      li.append(name, amount);
      list.appendChild(li);
    });

    tracker.removeAttribute('aria-hidden');
    tracker.classList.add('tracker-loaded');
  } catch (_) {
    // fail silently — tracker is non-critical
  }
}());
