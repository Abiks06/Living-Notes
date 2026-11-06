import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { trackFocusSource } from './lib/keyboard';
import { watchInstallOffer } from './pwa/install';
import { registerServiceWorker } from './pwa/register';
import { initAppearance } from './settings/appearance';
import { bindSettings } from './settings/bindings';
import { initUrlSync } from './settings/urlSync';
import './styles/global.css';

// Apply a shared look before the first render, so the link opens straight into it.
initAppearance();
initUrlSync();
trackFocusSource();
bindSettings();
watchInstallOffer();
registerServiceWorker();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
