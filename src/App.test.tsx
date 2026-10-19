import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';
import { AuthContext } from './components/AuthGate';
import { dashboardData } from './data/dashboardData';

test('renders the dashboard shell with the main navigation', () => {
  const user = { id: '1', username: 'alice', name: 'Alice', role: 'admin' as const, active: true, created_at: null, last_login_at: null };
  render(<AuthContext.Provider value={{ user, setSession: () => {}, logout: () => {} }}><App /></AuthContext.Provider>);

  expect(screen.getByRole('button', { name: /vue globale/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: new RegExp(dashboardData.title, 'i') })).toBeInTheDocument();
  expect(screen.getAllByText(new RegExp(dashboardData.subtitle, 'i')).length).toBeGreaterThan(0);
  expect(screen.getByText(/surveillance claire/i)).toBeInTheDocument();
  expect(screen.getByText(/chargement des données/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /utilisateurs/i })).toBeInTheDocument();
  expect(screen.getByText('Alice')).toBeInTheDocument();
});
