import { lazy, Suspense } from 'react';

type Props = Parameters<typeof import('./ModelPreview')['ModelPreview']>[0];

const Impl = lazy(() => import('./ModelPreview').then((m) => ({ default: m.ModelPreview })));

/**
 * ModelPreview, loaded when first shown. It brings @react-three/fiber, drei
 * and their own three.js (~220 KB gzipped), which only "Every step" and its
 * preview dialog use; nothing on the gallery or a hero's page needs them.
 */
export function ModelPreview(props: Props) {
  return (
    <Suspense fallback={<div className={`model-preview-container ${props.className ?? ''}`} />}>
      <Impl {...props} />
    </Suspense>
  );
}
