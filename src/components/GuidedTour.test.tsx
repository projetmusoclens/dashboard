import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GuidedTour from './GuidedTour';

test('opens on the overview and navigates between tour steps', () => {
  const onNavigate = jest.fn();
  const onClose = jest.fn();
  render(<GuidedTour open onNavigate={onNavigate} onClose={onClose} />);

  expect(screen.getByRole('dialog')).toHaveTextContent('Vue globale');
  expect(onNavigate).toHaveBeenCalledWith('overview');

  fireEvent.click(screen.getByRole('button', { name: 'Étape suivante' }));

  expect(screen.getByRole('dialog')).toHaveTextContent('Explorer les publications');
  expect(onNavigate).toHaveBeenCalledWith('posts');
});

test('closes the guided tour from its close control', () => {
  const onClose = jest.fn();
  render(<GuidedTour open onNavigate={jest.fn()} onClose={onClose} />);

  fireEvent.click(screen.getByRole('button', { name: 'Fermer le tour' }));

  expect(onClose).toHaveBeenCalledTimes(1);
});