import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './i18n';
import App from './App.tsx';
import { AppDialogProvider } from './components/AppDialogProvider';
import './index.css';
import { registerDevBuiltinAgentReset } from './dev/resetBuiltinAgents';
import { initTheme } from './hooks/useTheme';
import logoUrl from '../LOGO.png';

registerDevBuiltinAgentReset();
initTheme();

document.title = 'Spoor';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = logoUrl;
if (!favicon.parentNode) document.head.appendChild(favicon);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppDialogProvider>
      <App />
    </AppDialogProvider>
  </StrictMode>,
);
