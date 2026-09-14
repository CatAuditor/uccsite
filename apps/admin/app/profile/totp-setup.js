'use client';
// Authenticator-app (TOTP) enrolment: asks the server for a fresh secret,
// shows it (and the otpauth link) for the user's app, then verifies the
// first code. No QR library (spec §15: no extra deps) — apps accept the key
// typed in, and the otpauth link opens directly on a phone.
import { useState, useTransition } from 'react';
import { startTotp, finishTotp } from './actions';
import ActionForm from '../action-form';

export default function TotpSetup() {
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const begin = () => start(async () => {
    const r = await startTotp();
    if (r.error) setError(r.error); else { setError(''); setSetup(r); }
  });
  if (!setup) {
    return (
      <div>
        {error && <div className="error">{error}</div>}
        <button type="button" onClick={begin} disabled={pending}>Set up an authenticator app</button>
      </div>
    );
  }
  return (
    <div className="totp">
      <p>Add this key to your authenticator app (1Password, Google Authenticator, Authy…), then enter the 6-digit code it shows.</p>
      <div className="totp-secret"><code>{setup.secret.match(/.{1,4}/g).join(' ')}</code></div>
      <p className="hint"><a href={setup.otpauth}>Open in an authenticator app on this device</a> · issuer “UCC Admin”</p>
      <ActionForm action={finishTotp} successMessage="Authenticator app enabled.">
        <label htmlFor="totp-code">6-digit code</label>
        <input type="text" id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required />
        <button type="submit">Verify and enable</button>
      </ActionForm>
    </div>
  );
}
