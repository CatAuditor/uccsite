/* Utah Compact — Main JS */

// Sticky nav + hero parallax on scroll
const header = document.getElementById('site-header');
const heroBg = document.querySelector('.hero-bg');

function onScroll() {
  const sy = window.scrollY;

  if (sy > 40) header.classList.add('scrolled');
  else header.classList.remove('scrolled');

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

// Intersection Observer for scroll animations
const animateEls = document.querySelectorAll('[data-animate]');
if (animateEls.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );
  animateEls.forEach(el => observer.observe(el));
}

// Staggered card animations
function addStaggeredAnimations() {
  const groups = [
    '.pillars-grid .pillar-card',
    '.issues-grid .issue-card',
    '.footer-grid > *',
  ];
  groups.forEach(selector => {
    document.querySelectorAll(selector).forEach((el, i) => {
      el.setAttribute('data-animate', '');
      el.setAttribute('data-animate-delay', Math.min(i + 1, 4));
    });
  });
  // Re-observe after adding attributes
  document.querySelectorAll('[data-animate]').forEach(el => {
    if (!el.classList.contains('visible')) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('visible');
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
      );
      observer.observe(el);
    }
  });
}
addStaggeredAnimations();

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
        }),
      });

      if (res.ok) {
        form.style.display = 'none';
        formSuccess.style.display = 'block';
      } else {
        const data = await res.json().catch(() => ({}));
        showFormError(form, data.error || 'Something went wrong. Please try again.');
        btn.textContent = 'Join the Compact';
        btn.disabled = false;
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
const STRIPE_PK = 'pk_test_51TUY6qRpmK1SjHcTmt9gtSea94QhozPKF3TxUfJbDkiXd5xSTw9MjIZeT4dbzj9cOmPS8mPEFlKC5WrpQFZop3tE00IxXtFwgD';

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

      if (btn.dataset.priceId === 'custom') {
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
      const body = { type: currentType, amountCents, email, firstName, lastName, zip, newsletterOptIn };

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
navDropdowns.forEach(dropdown => {
  const toggle = dropdown.querySelector('.nav-dropdown-toggle');

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    navDropdowns.forEach(d => {
      d.classList.remove('open');
      d.querySelector('.nav-dropdown-toggle').setAttribute('aria-expanded', 'false');
    });
    if (!isOpen) {
      dropdown.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
    }
  });

  dropdown.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });
});
document.addEventListener('click', () => {
  navDropdowns.forEach(d => {
    d.classList.remove('open');
    d.querySelector('.nav-dropdown-toggle').setAttribute('aria-expanded', 'false');
  });
});

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

// Donation modal — shows after 1.75s, dismissed per session
(function () {
  if (sessionStorage.getItem('modal-dismissed')) return;
  const overlay = document.getElementById('donate-modal');
  if (!overlay) return;

  function hide() {
    overlay.classList.remove('modal-visible');
    sessionStorage.setItem('modal-dismissed', '1');
  }

  setTimeout(function () {
    overlay.classList.add('modal-visible');
  }, 7500);

  document.getElementById('modal-close').addEventListener('click', hide);
  document.getElementById('modal-dismiss').addEventListener('click', hide);
  document.getElementById('modal-cta').addEventListener('click', hide);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) hide();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hide();
  });
}());
