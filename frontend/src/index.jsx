import 'semantic-ui-less/semantic.less';
import App from './components/App';
import { postLog } from './lib/logs';
import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter as Router } from 'react-router-dom';

const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  originalConsoleError(...args);
  postLog('error', ...args);
};

const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  originalConsoleWarn(...args);
  postLog('warn', ...args);
};

window.addEventListener('unhandledrejection', (event) => {
  postLog('error', event.reason ?? 'Unhandled promise rejection');
});

window.addEventListener('error', (event) => {
  if (event.message?.includes('ResizeObserver loop')) {
    event.stopImmediatePropagation();
    return;
  }

  postLog('error', event.error ?? event.message ?? 'Unknown error');
});

ReactDOM.render(
  <Router>
    <App />
  </Router>,
  document.querySelector('#root'),
);
