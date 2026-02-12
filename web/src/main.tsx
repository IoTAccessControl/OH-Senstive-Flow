import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './theme.css';
import App from './App.tsx';
import { AnalysisProvider } from './AnalysisProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnalysisProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AnalysisProvider>
  </StrictMode>,
);
