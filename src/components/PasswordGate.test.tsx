import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PasswordGate from './PasswordGate';

function mockFetch(handler: (init?: RequestInit) => number) {
  global.fetch = jest.fn((_url: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve({ ok: handler(init) === 200, status: handler(init) } as Response),
  ) as jest.Mock;
}

const authHeader = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Authorization;

afterEach(() => sessionStorage.clear());

test('shows the app directly when the API needs no password', async () => {
  mockFetch(() => 200);
  render(<PasswordGate><p>Contenu</p></PasswordGate>);
  expect(await screen.findByText('Contenu')).toBeInTheDocument();
});

test('asks for the password and unlocks the app with the right one', async () => {
  mockFetch((init) => (authHeader(init) === 'Bearer secret' ? 200 : 401));
  render(<PasswordGate><p>Contenu</p></PasswordGate>);

  const input = await screen.findByLabelText('Mot de passe');
  fireEvent.change(input, { target: { value: 'faux' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe incorrect.');

  fireEvent.change(input, { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrer' }));
  expect(await screen.findByText('Contenu')).toBeInTheDocument();
  expect(sessionStorage.getItem('dashboard-password')).toBe('secret');
});
