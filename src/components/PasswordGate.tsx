import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { AUTH_REQUIRED_EVENT, checkPassword, getStoredPassword, storePassword } from '../services/api';

type GateState = 'checking' | 'locked' | 'open' | 'unreachable';

const WAKE_UP_HINT_MS = 5000;

const PasswordGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<GateState>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    setState('checking');
    setSlow(false);
    // L'hébergement gratuit met l'API en veille : le premier appel peut prendre une minute.
    const hint = window.setTimeout(() => { if (mounted) setSlow(true); }, WAKE_UP_HINT_MS);
    checkPassword(getStoredPassword())
      .then((result) => { if (mounted) setState(result === 'ok' ? 'open' : 'locked'); })
      .catch(() => { if (mounted) setState('unreachable'); })
      .finally(() => window.clearTimeout(hint));
    return () => { mounted = false; window.clearTimeout(hint); };
  }, [attempt]);

  useEffect(() => {
    const onAuthRequired = () => {
      storePassword('');
      setError('Session expirée, saisissez de nouveau le mot de passe.');
      setState('locked');
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await checkPassword(password);
      if (result === 'ok') {
        storePassword(password);
        setPassword('');
        setState('open');
      } else {
        setError(result === 'locked' ? 'Trop de tentatives. Réessayez dans 15 minutes.' : 'Mot de passe incorrect.');
      }
    } catch {
      setError('Le serveur ne répond pas. Réessayez dans un instant.');
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'open') return <>{children}</>;

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg)', color: 'var(--text-primary)' }}>
      {state === 'checking' && (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
          Connexion au serveur…
          {slow && <><br />Le serveur se réveille, cela peut prendre jusqu'à une minute.</>}
        </p>
      )}
      {state === 'unreachable' && (
        <div role="alert" style={{ display: 'grid', gap: 12, justifyItems: 'center', textAlign: 'center', maxWidth: 420 }}>
          <p>Impossible de joindre le serveur.</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Il redémarre peut-être, ou cette adresse du site n'est pas autorisée par l'API (variable ALLOWED_ORIGINS).</p>
          <button type="button" onClick={() => setAttempt((count) => count + 1)} style={{ padding: '8px 14px', border: 0, borderRadius: 6, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            Réessayer
          </button>
        </div>
      )}
      {state === 'locked' && (
        <form onSubmit={submit} style={{ width: 'min(100%, 360px)', display: 'grid', gap: 14, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Lock size={18} color="var(--accent)" />
            <h1 style={{ fontSize: 18 }}>Dashboard World Cup 2026</h1>
          </div>
          <label htmlFor="dashboard-password" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Mot de passe</label>
          <input
            id="dashboard-password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }}
          />
          {error && <p role="alert" style={{ color: '#e34948', fontSize: 13 }}>{error}</p>}
          <button type="submit" disabled={submitting || !password} style={{ padding: '10px 12px', border: 0, borderRadius: 6, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: submitting || !password ? 'default' : 'pointer', opacity: submitting || !password ? 0.6 : 1 }}>
            {submitting ? 'Vérification…' : 'Entrer'}
          </button>
        </form>
      )}
    </main>
  );
};

export default PasswordGate;
