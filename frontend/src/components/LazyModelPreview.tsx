import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';
import type { ModelPreview as ModelPreviewType } from './ModelPreview';

/**
 * three.js is ~800 kB — the single heaviest thing the app ships. Only the model
 * previews need it, and neither the landing page nor the gallery renders one, so
 * it is split into its own chunk and fetched the first time a 3D view mounts.
 */
const ModelPreview = lazy(() =>
  import('./ModelPreview').then((m) => ({ default: m.ModelPreview }))
);

type Props = ComponentProps<typeof ModelPreviewType>;

export function LazyModelPreview(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="model-preview-loading" role="status" aria-live="polite">
          <span className="model-preview-loading-spinner" aria-hidden="true" />
          <span>Loading 3D view…</span>
        </div>
      }
    >
      <ModelPreview {...props} />
    </Suspense>
  );
}
