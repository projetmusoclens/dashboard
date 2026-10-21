import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import api, { AUTH_REQUIRED_EVENT, storeToken } from '../services/api';
import { User } from '../types';

type GateState = 'checking' | 'locked' | 'open' | 'unreachable';

interface AuthContextValue {
  user: User;
  setSession: (token: string, user: User) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé sous <AuthGate>');
  return value;
}

const WAKE_UP_HINT_MS = 5000;
const inputStyle: React.CSSProperties = { padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 };

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<GateState>('checking');
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState('');
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
    api.getSession()
      .then((sessionUser) => {
        if (!mounted) return;
        setUser(sessionUser);
        setState(sessionUser ? 'open' : 'locked');
      })
      .catch(() => { if (mounted) setState('unreachable'); })
      .finally(() => window.clearTimeout(hint));
    return () => { mounted = false; window.clearTimeout(hint); };
  }, [attempt]);

  useEffect(() => {
    const onAuthRequired = () => {
      storeToken('');
      setUser(null);
      setError('Session expirée, reconnectez-vous.');
      setState('locked');
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const setSession = useCallback((token: string, sessionUser: User) => {
    storeToken(token);
    setUser(sessionUser);
  }, []);

  const logout = useCallback(() => {
    storeToken('');
    setUser(null);
    setError(null);
    setState('locked');
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.login(username.trim(), password);
      if (result === 'invalid') setError('Identifiant ou mot de passe incorrect.');
      else if (result === 'locked') setError('Trop de tentatives. Réessayez dans 15 minutes.');
      else {
        setSession(result.token, result.user);
        setPassword('');
        setState('open');
      }
    } catch {
      setError('Le serveur ne répond pas. Réessayez dans un instant.');
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'open' && user) {
    return <AuthContext.Provider value={{ user, setSession, logout }}>{children}</AuthContext.Provider>;
  }

  const disabled = submitting || !username.trim() || !password;
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
        <form onSubmit={submit} style={{ width: 'min(100%, 360px)', display: 'grid', gap: 12, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Lock size={18} color="var(--accent)" />
            <h1 style={{ fontSize: 18 }}>Dashboard World Cup 2026</h1>
          </div>
          <label htmlFor="login-username" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Identifiant</label>
          <input id="login-username" autoFocus autoComplete="username" autoCapitalize="none" value={username} onChange={(event) => setUsername(event.target.value)} style={inputStyle} />
          <label htmlFor="login-password" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Mot de passe</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} style={inputStyle} />
          {error && <p role="alert" style={{ color: '#e34948', fontSize: 13 }}>{error}</p>}
          <button type="submit" disabled={disabled} style={{ padding: '10px 12px', border: 0, borderRadius: 6, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
            {submitting ? 'Connexion…' : 'Se connecter'}
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pas de compte ? Demandez-en un à l’administrateur du dashboard.</p>
        </form>
      )}
    </main>
  );
};

export default AuthGate;
