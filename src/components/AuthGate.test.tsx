import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AuthGate, { useAuth } from './AuthGate';

const user = { id: '1', username: 'alice', name: 'Alice', role: 'annotateur', active: true, created_at: null, last_login_at: null };

function respond(status: number, body: unknown = {}) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);
}

const Who: React.FC = () => <p>Bonjour {useAuth().user.name}</p>;

afterEach(() => localStorage.clear());

test('asks for credentials and opens the app with a valid account', async () => {
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/api/health')) return respond(200, { ok: true });
    if (path.endsWith('/api/auth/login')) {
      const { password } = JSON.parse(String(init?.body));
      return password === 'bon-mot-de-passe' ? respond(200, { token: 'tok', user }) : respond(401);
    }
    return respond(404);
  }) as jest.Mock;
  render(<AuthGate><Who /></AuthGate>);

  fireEvent.change(await screen.findByLabelText('Identifiant'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'faux' } });
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Identifiant ou mot de passe incorrect.');

  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'bon-mot-de-passe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(await screen.findByText('Bonjour Alice')).toBeInTheDocument();
  expect(localStorage.getItem('dashboard-session')).toBe('tok');
});

test('reuses a stored session', async () => {
  localStorage.setItem('dashboard-session', 'tok');
  global.fetch = jest.fn(() => respond(200, { user })) as jest.Mock;
  render(<AuthGate><Who /></AuthGate>);
  expect(await screen.findByText('Bonjour Alice')).toBeInTheDocument();
});

test('offers a retry when the API cannot be reached', async () => {
  global.fetch = jest.fn(() => Promise.reject(new TypeError('NetworkError'))) as jest.Mock;
  render(<AuthGate><Who /></AuthGate>);
  expect(await screen.findByText('Impossible de joindre le serveur.')).toBeInTheDocument();
  localStorage.setItem('dashboard-session', 'tok');
  global.fetch = jest.fn(() => respond(200, { user })) as jest.Mock;
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Bonjour Alice')).toBeInTheDocument();
});
