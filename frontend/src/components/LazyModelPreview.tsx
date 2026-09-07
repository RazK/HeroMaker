import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';
import type { ModelPreview as ModelPreviewType } from './ModelPreview';
// Imported here rather than only inside the lazy chunk: the fallback below is
// rendered before that chunk exists, and without these rules it would be an
// unstyled image with no stage around it.
import './ModelPreview.css';

/**
 * three.js is ~800 kB — the single heaviest thing the app ships. Only the model
 * previews need it, and neither the landing page nor the gallery renders one, so
 * it is split into its own chunk and fetched the first time a 3D view mounts.
 */
const ModelPreview = lazy(() =>
  import('./ModelPreview').then((m) => ({ default: m.ModelPreview }))
);

type Props = ComponentProps<typeof ModelPreviewType>;

export function LazyModelPreview({ posterSrc, className = '', ...props }: Props) {
  return (
    <Suspense
      fallback={
        /*
         * The chunk itself is a second of waiting before the model download can
         * even start, so the still goes up here too. The bar is indeterminate:
         * at this point nothing knows how big the model is.
         *
         * Deliberately the same markup as ModelPreview's own loading state, so
         * the handover from fallback to component is invisible. It is not
         * shared code because ModelPreview lives in the lazy chunk - importing
         * from it here is exactly what the split is avoiding.
         */
        <div className={`model-preview-container ${className}`}>
          {posterSrc && (
            <img
              className="model-preview-poster"
              src={posterSrc}
              alt=""
              aria-hidden="true"
              decoding="async"
              fetchPriority="high"
            />
          )}
          <div className="model-preview-progress" role="status" aria-live="polite">
            <span className="model-preview-progress-label">Bringing your hero to life</span>
            <span className="model-preview-progress-track">
              <span className="model-preview-progress-bar is-indeterminate" />
            </span>
          </div>
        </div>
      }
    >
      <ModelPreview posterSrc={posterSrc} className={className} {...props} />
    </Suspense>
  );
}
