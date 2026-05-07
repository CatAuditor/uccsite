/* Utah Compact — Main JS */

// Sticky nav on scroll
const header = document.getElementById('site-header');
function onScroll() {
  if (window.scrollY > 40) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
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

// Form submission (client-side demo)
const form = document.getElementById('join-form');
const formSuccess = document.getElementById('form-success');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.textContent = 'Joining...';
    btn.disabled = true;
    // Simulate network request
    setTimeout(() => {
      form.style.display = 'none';
      formSuccess.style.display = 'block';
    }, 900);
  });
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
  let selectedPriceId = 'price_1TUYkERpmK1SjHcT1coNdzwN'; // $25/mo default
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
        selectedPriceId = null;
        customWrap.style.display = 'block';
        customInput.focus();
      } else {
        isCustom = false;
        selectedPriceId = btn.dataset.priceId;
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
    let priceId = selectedPriceId;

    if (isCustom) {
      const raw = parseFloat(customInput.value);
      if (!raw || raw < 1) {
        showError('Please enter an amount of at least $1.');
        return;
      }
      amountCents = Math.round(raw * 100);
      priceId = null;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Please enter a valid email address.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Redirecting to checkout…';
    errorEl.style.display = 'none';

    try {
      const body = { type: currentType, email, firstName, lastName, zip, newsletterOptIn };
      if (currentType === 'subscription' && priceId) {
        body.priceId = priceId;
      } else {
        body.amountCents = amountCents;
      }

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

// Active nav link highlighting
const sections = document.querySelectorAll('section[id]');
const navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navAnchors.forEach(a => {
          a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
        });
      }
    });
  },
  { rootMargin: '-40% 0px -55% 0px' }
);
sections.forEach(s => sectionObserver.observe(s));
