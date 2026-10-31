import React from 'react';

export const reportFrontendReady = () => {
  if (document.documentElement.dataset.resonanceFrontend !== 'failed') {
    document.documentElement.dataset.resonanceFrontend = 'ready';
  }
};

// A render failure must not leave a blank workspace or a stale readiness signal.
class FrontendHealthBoundary extends React.Component {
  static getDerivedStateFromError() {
    return { failed: true };
  }

  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  componentDidCatch() {
    document.documentElement.dataset.resonanceFrontend = 'failed';
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main
        role="alert"
        style={{
          background: '#0c1020',
          color: '#f4f5f7',
          display: 'grid',
          fontFamily: 'system-ui, sans-serif',
          minHeight: '100vh',
          padding: '32px',
          placeContent: 'center',
        }}
      >
        <h1>The web app couldn’t continue</h1>
        <p>Reload to try again. Your saved sign-in will be kept.</p>
        <button
          onClick={() => window.location.reload()}
          type="button"
        >
          Reload Resonance
        </button>
      </main>
    );
  }
}

export default FrontendHealthBoundary;
