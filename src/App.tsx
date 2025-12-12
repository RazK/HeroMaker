import { BrowsePanel } from './components/BrowsePanel';
import { CreatePanel } from './components/CreatePanel';
import { ErrorBanner } from './components/ErrorBanner';
import { useCreation } from './hooks/useCreation';

export default function App() {
  const { creation, appState, error, isLoading, startCreation, clearError } = useCreation();

  return (
    <div className="app-shell">
      <div className="app-shell__gradient" aria-hidden />
      <main className="app-shell__content">
        <header className="app-header">
          <div>
            <p className="eyebrow">HeroMaker • Frontend Prototype</p>
            <h1>Browse → Create → Show</h1>
            <p className="lede">
              Step 1 focuses on moving from Browse to Create by invoking `POST /api/creations`, highlighting the first task, and
              surfacing the webcam capture interface described in the docs.
            </p>
          </div>
        </header>
        {error && <ErrorBanner message={error} onDismiss={clearError} />}
        {appState === 'browse' && <BrowsePanel onStart={startCreation} isLoading={isLoading} />}
        {appState === 'create' && creation && <CreatePanel creation={creation} />}
      </main>
    </div>
  );
}
