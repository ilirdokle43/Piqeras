import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { AuthProvider } from './state/auth';
import { registerOfflineWorker } from './lib/push';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);

// Registered after first paint so it never competes with the initial render.
window.addEventListener('load', () => {
  void registerOfflineWorker();
});
