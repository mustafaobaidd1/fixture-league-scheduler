import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import { App } from './app/App';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
