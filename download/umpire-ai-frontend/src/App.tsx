import { Routes, Route } from 'react-router-dom';
import { Header } from './components/common/Header';
import UploadPage from './pages/UploadPage';
import ProcessingPage from './pages/ProcessingPage';
import AnalysisPage from './pages/AnalysisPage';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-50">
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/processing/:videoId" element={<ProcessingPage />} />
          <Route path="/analysis/:videoId" element={<AnalysisPage />} />
        </Routes>
      </main>
    </div>
  );
}
