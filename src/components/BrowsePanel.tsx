interface BrowsePanelProps {
  onStart: () => void;
  isLoading: boolean;
}

export function BrowsePanel({ onStart, isLoading }: BrowsePanelProps) {
  return (
    <section className="panel panel--browse">
      <div>
        <p className="eyebrow">Journey 1 • Step 1</p>
        <h1>Turn drawings into heroes.</h1>
        <p className="lede">
          Kick off a new creation to launch the webcam capture workflow described in the HeroMaker docs.
          The backend becomes the source of truth immediately, so every click mirrors real data.
        </p>
        <div className="cta-group">
          <button className="button button--primary" onClick={onStart} disabled={isLoading}>
            {isLoading ? 'Starting...' : 'Make a New Hero'}
          </button>
          <p className="cta-hint">POST /api/creations • transitions to Create state</p>
        </div>
      </div>
      <div className="panel__orbital" aria-hidden>
        <div className="panel__halo" />
        <div className="panel__halo panel__halo--delayed" />
      </div>
    </section>
  );
}
