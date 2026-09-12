/* Tipline form — /tip.html */
(function () {
  const form = document.getElementById('tipForm');
  if (!form) return;

  const anonymousCheckbox = document.getElementById('anonymous');
  const nameField = document.getElementById('name');
  const submitBtn = document.getElementById('submitBtn');
  const successMsg = document.getElementById('successMsg');
  const errorMsg = document.getElementById('errorMsg');
  const fallbackError = errorMsg.innerHTML; // keeps the mailto link intact

  // Anonymous checkbox — clears and locks the name field
  anonymousCheckbox.addEventListener('change', () => {
    const anon = anonymousCheckbox.checked;
    if (anon) nameField.value = '';
    nameField.disabled = anon;
    nameField.classList.toggle('disabled', anon);
  });

  function showError(text) {
    if (text) errorMsg.textContent = text;
    else errorMsg.innerHTML = fallbackError;
    errorMsg.style.display = 'block';
  }

  // Submits to /api/tip (Cloudflare Pages Function — Airtable token never reaches the browser)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    successMsg.style.display = 'none';
    errorMsg.style.display = 'none';

    const email = document.getElementById('email').value.trim();
    const tipBody = document.getElementById('tipBody').value.trim();
    const privacyConsent = document.getElementById('privacyConsent').checked;

    if (!email || !tipBody) {
      showError('Please provide your email and tip details before submitting.');
      return;
    }
    if (!privacyConsent) {
      showError('Please confirm you have read and agree to the Privacy Policy.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    // Field names match Airtable base — see functions/api/tip.js for full mapping
    const payload = {
      name: nameField.value.trim(),
      anonymous: anonymousCheckbox.checked,
      email,
      subject_of_tip: document.getElementById('subject').value.trim(),
      tip_summary: tipBody,
    };

    try {
      const res = await fetch('/api/tip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showError(data.error || null);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Tip';
        return;
      }

      successMsg.style.display = 'block';
      form.reset();
      nameField.disabled = false;
      nameField.classList.remove('disabled');
      submitBtn.textContent = 'Submitted';
      // Stay disabled — prevents accidental duplicate tips. Reload to send another.
    } catch (err) {
      showError(null);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Tip';
    }
  });
})();
