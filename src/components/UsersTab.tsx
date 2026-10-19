import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, UserPlus } from 'lucide-react';
import { createUser, listUsers, updateUser, User, UserRole } from '../services/api';
import { useAuth } from './AuthGate';

const cardStyle: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' };
const titleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' };
const inputStyle: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 13 };
const buttonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const primaryStyle: React.CSSProperties = { ...buttonStyle, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' };

const formatDate = (raw: string | null) => (raw ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(raw)) : '—');

// Mot de passe proposé à la création ou à la réinitialisation, à transmettre par un canal privé.
function suggestPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const values = new Uint32Array(12);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

const UsersTab: React.FC = () => {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [form, setForm] = useState({ username: '', name: '', password: suggestPassword(), role: 'annotateur' as UserRole });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    listUsers()
      .then((result) => setUsers(result.users))
      .catch((error) => setMessage({ text: error.message, error: true }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ text: success, error: false });
      refresh();
    } catch (error: any) {
      setMessage({ text: error.message || String(error), error: true });
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const created = { ...form, username: form.username.trim().toLowerCase() };
    run(() => createUser(created), `Compte « ${created.username} » créé. Mot de passe à transmettre : ${created.password}`)
      .then(() => setForm({ username: '', name: '', password: suggestPassword(), role: 'annotateur' }));
  };

  const resetPassword = (target: User) => {
    const proposal = suggestPassword();
    const password = window.prompt(`Nouveau mot de passe pour ${target.username} (8 caractères minimum) :`, proposal);
    if (!password) return;
    run(() => updateUser(target.id, { password }), `Mot de passe de « ${target.username} » réinitialisé : ${password}. Ses sessions ouvertes sont fermées.`);
  };

  return (
    <div>
      {message && (
        <div role="status" style={{ ...cardStyle, padding: '0.8rem 1rem', color: message.error ? '#e34948' : 'var(--text-primary)', borderColor: message.error ? '#e34948' : 'var(--accent)' }}>
          {message.text}
        </div>
      )}

      <form onSubmit={submit} style={cardStyle}>
        <h3 style={titleStyle}>Créer un compte</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>Identifiant
            <input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="ex. marie.dupont" autoCapitalize="none" style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>Nom affiché
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="ex. Marie Dupont" style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>Mot de passe initial
            <input required minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>Rôle
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })} style={inputStyle}>
              <option value="annotateur">Annotateur</option>
              <option value="admin">Administrateur</option>
            </select>
          </label>
          <button type="submit" disabled={busy} style={{ ...primaryStyle, justifyContent: 'center', padding: '9px 12px' }}><UserPlus size={14} /> Créer</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
          Transmettez le mot de passe par un canal privé ; la personne pourra le changer depuis « Mon mot de passe ». Identifiant : 3 à 32 caractères parmi a-z, 0-9, « . », « _ », « - ».
        </p>
      </form>

      <div style={cardStyle}>
        <h3 style={titleStyle}>Comptes ({users.length})</h3>
        {loading ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Chargement…</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Identifiant</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Nom</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Rôle</th>
                  <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>Annotations</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Dernière connexion</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Statut</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} style={{ borderTop: '1px solid var(--border)', opacity: user.active ? 1 : 0.55 }}>
                    <td style={{ padding: '0.6rem 0.5rem', fontWeight: 700 }}>{user.username}{user.id === me.id && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (vous)</span>}</td>
                    <td style={{ padding: '0.6rem 0.5rem' }}>{user.name}</td>
                    <td style={{ padding: '0.6rem 0.5rem' }}>
                      <select aria-label={`Rôle de ${user.username}`} value={user.role} disabled={busy || user.id === me.id} onChange={(event) => run(() => updateUser(user.id, { role: event.target.value as UserRole }), `Rôle de « ${user.username} » modifié.`)} style={{ ...inputStyle, padding: '5px 8px' }}>
                        <option value="annotateur">Annotateur</option>
                        <option value="admin">Administrateur</option>
                      </select>
                    </td>
                    <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>{user.annotations ?? 0}</td>
                    <td style={{ padding: '0.6rem 0.5rem', color: 'var(--text-secondary)' }}>{formatDate(user.last_login_at)}</td>
                    <td style={{ padding: '0.6rem 0.5rem' }}>{user.active ? 'Actif' : 'Désactivé'}</td>
                    <td style={{ padding: '0.6rem 0.5rem' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" disabled={busy} style={buttonStyle} onClick={() => resetPassword(user)}><KeyRound size={13} /> Mot de passe</button>
                        {user.id !== me.id && (
                          <button type="button" disabled={busy} style={{ ...buttonStyle, color: user.active ? '#e34948' : 'var(--text-primary)' }} onClick={() => run(() => updateUser(user.id, { active: !user.active }), user.active ? `« ${user.username} » désactivé : il ne peut plus se connecter.` : `« ${user.username} » réactivé.`)}>
                            {user.active ? 'Désactiver' : 'Réactiver'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
          Désactiver un compte ferme ses sessions et conserve ses annotations. Il doit toujours rester au moins un administrateur actif.
        </p>
      </div>
    </div>
  );
};

export default UsersTab;
