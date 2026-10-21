import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  // Change de valeur quand l'utilisateur change d'onglet : l'erreur précédente est alors oubliée.
  resetKey?: string;
}

// Affiche un message au lieu d'une page blanche si un onglet plante.
class ErrorBoundary extends React.Component<ErrorBoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Erreur dans un onglet', error, info.componentStack);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ padding: '1.5rem', border: '1px solid #e34948', borderRadius: 12, background: 'var(--card-bg)', color: 'var(--text-primary)' }}>
        <strong>Cet onglet a rencontré une erreur.</strong>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0 12px' }}>{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })} style={{ padding: '7px 12px', border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
          Réessayer
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
