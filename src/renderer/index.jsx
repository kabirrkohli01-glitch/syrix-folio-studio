import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/app.css';

class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="empty" style={{ height: '100%' }}>
          <h3>Something went wrong</h3>
          <p>Your documents are saved. Reload the window to continue.</p>
          <p className="mono muted" style={{ fontSize: 11 }}>{String(this.state.error.message || this.state.error)}</p>
          <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);
