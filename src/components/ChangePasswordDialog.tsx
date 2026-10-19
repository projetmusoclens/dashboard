import React, { useState } from 'react';
import { changePassword } from '../services/api';
import { useAuth } from './AuthGate';

const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 };

const ChangePasswordDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { setSession } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (next !== confirm) { setError('Les deux nouveaux mots de passe diffèrent.'); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await changePassword(current, next);
      setSession(result.token, result.user);
      setDone(true);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(10, 18, 26, 0.58)' }}>
      <form role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={submit} style={{ width: 'min(100%, 380px)', display: 'grid', gap: 10, background: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 10, padding: 22, boxShadow: '0 24px 80px rgba(0,0,0,0.28)' }}>
        <h2 id="password-title" style={{ fontSize: 17, margin: '0 0 4px' }}>Mon mot de passe</h2>
        {done ? (
          <>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Mot de passe modifié. Vos autres sessions ont été fermées.</p>
            <button type="button" onClick={onClose} style={{ padding: '9px 12px', border: 0, borderRadius: 6, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Fermer</button>
          </>
        ) : (
          <>
            <label htmlFor="password-current" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Mot de passe actuel</label>
            <input id="password-current" type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} style={inputStyle} />
            <label htmlFor="password-next" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Nouveau mot de passe (8 caractères minimum)</label>
            <input id="password-next" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(event) => setNext(event.target.value)} style={inputStyle} />
            <label htmlFor="password-confirm" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Confirmer</label>
            <input id="password-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} style={inputStyle} />
            {error && <p role="alert" style={{ color: '#e34948', fontSize: 13 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" onClick={onClose} style={{ padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>Annuler</button>
              <button type="submit" disabled={busy} style={{ padding: '9px 12px', border: 0, borderRadius: 6, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Enregistrement…' : 'Changer'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
};

export default ChangePasswordDialog;
