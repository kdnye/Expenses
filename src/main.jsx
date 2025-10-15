import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '../styles.css';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/service-worker.js')
    .catch((error) => {
      console.error('Service worker registration failed:', error);
    });
}
