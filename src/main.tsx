import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { trackFocusSource } from './lib/keyboard';
import { bindSettings } from './settings/bindings';
import { initUrlSync } from './settings/urlSync';
import './styles/global.css';

// Apply a shared look before the first render, so the link opens straight into it.
initUrlSync();
trackFocusSource();
bindSettings();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
