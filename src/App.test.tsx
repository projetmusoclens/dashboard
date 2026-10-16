import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';
import { dashboardData } from './data/dashboardData';

test('renders the dashboard shell with the main navigation', () => {
  render(<App />);

  expect(screen.getByRole('button', { name: /vue globale/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: new RegExp(dashboardData.title, 'i') })).toBeInTheDocument();
  expect(screen.getAllByText(new RegExp(dashboardData.subtitle, 'i')).length).toBeGreaterThan(0);
  expect(screen.getByText(/surveillance claire/i)).toBeInTheDocument();
  expect(screen.getByText(/chargement des données/i)).toBeInTheDocument();
});
