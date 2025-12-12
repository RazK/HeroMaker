interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="banner banner--error" role="alert">
      <div>
        <strong>Something went wrong.</strong>
        <p>{message}</p>
      </div>
      {onDismiss && (
        <button className="banner__dismiss" onClick={onDismiss} aria-label="Dismiss error">
          ×
        </button>
      )}
    </div>
  );
}
