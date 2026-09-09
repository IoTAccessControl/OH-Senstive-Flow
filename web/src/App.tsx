import { Navigate, Route, Routes } from 'react-router-dom';

import { HomePage } from './pages/Home';
import { SinksPage } from './pages/Sinks';
import { SourcesPage } from './pages/Sources';
import { CallGraphPage } from './pages/CallGraph';
import { DataflowsPage } from './pages/Dataflows';
import { PrivacyReportPage } from './pages/PrivacyReport';

export default function App() {
  console.log('App component rendering');
  return (
    <div style={{ padding: '20px', minHeight: '100vh', background: '#f0f0f0' }}>
      <h1 style={{ color: 'red' }}>App is rendering</h1>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/sinks" element={<SinksPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/callgraph" element={<CallGraphPage />} />
        <Route path="/dataflows" element={<DataflowsPage />} />
        <Route path="/privacy-report" element={<PrivacyReportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
