import type { Creation } from '../types/api';
import { CreationMetaCard } from './CreationMetaCard';
import { CreationRoadmap } from './CreationRoadmap';
import { WebcamCapture } from './WebcamCapture';

interface CreatePanelProps {
  creation: Creation;
}

export function CreatePanel({ creation }: CreatePanelProps) {
  return (
    <section className="panel panel--create">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Create state</p>
          <h2>Webcam scan task is ready.</h2>
          <p className="lede">
            POST /api/creations already seeded the entire pipeline. Capture the drawing, upload it to the backend, and let the
            remaining tasks auto-trigger.
          </p>
        </div>
      </div>
      <div className="panel__grid">
        <CreationMetaCard creation={creation} />
        <CreationRoadmap tasks={creation.tasks} currentTask={creation.current_task} />
        <WebcamCapture />
      </div>
    </section>
  );
}
