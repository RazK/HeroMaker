import { Component, ReactNode } from 'react';
import './PartsBoundary.css';

/**
 * Catches a parts viewer that cannot load (its GLB 404s, CORS, the network,
 * the three.js chunk): GLTFLoader throws inside the Canvas, and with nothing
 * here to catch it the whole hero page went blank. The slide shows `fallback`
 * instead and the rest of the page goes on. Kept out of PartsViewer so it is
 * there before that chunk loads.
 */
export class PartsBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('The parts viewer could not load:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** What shows instead: the split's preview picture when there is one, else a calm line. */
export function PartsFallback({ preview, alt }: { preview?: string | null; alt: string }) {
  return (
    <div className="tb-parts-fallback" role="status">
      {/* The line first: the drawing's corner card sits over the slide's foot. */}
      <span>{preview ? 'The 3D action figure can\'t load right now' : 'The action figure can\'t load right now'}</span>
      {preview ? <img src={preview} alt={alt} /> : null}
    </div>
  );
}
