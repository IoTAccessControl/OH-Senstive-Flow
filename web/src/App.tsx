import { Navigate, Route, Routes } from 'react-router-dom';

import { HomePage } from './pages/Home';
import { SinksPage } from './pages/Sinks';
import { SourcesPage } from './pages/Sources';
import { CallGraphPage } from './pages/CallGraph';
import { DataflowsPage } from './pages/Dataflows';
import { PrivacyReportPage } from './pages/PrivacyReport';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/sinks" element={<SinksPage />} />
      <Route path="/sources" element={<SourcesPage />} />
      <Route path="/callgraph" element={<CallGraphPage />} />
      <Route path="/dataflows" element={<DataflowsPage />} />
      <Route path="/privacy-report" element={<PrivacyReportPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
