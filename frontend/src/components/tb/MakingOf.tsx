import { useState } from 'react';
import { api, CreationResponse } from '../../api/client';
import { ModelPreview } from '../ModelPreview';
import { Icon, IconName } from './Icon';
import { Header, NavButton } from './parts';
import { heroName } from './pipeline';
import './MakingOf.css';

/**
 * How a hero was made, one phase at a time: the drawing, the painting, the 3D
 * sculpt, and the hero moving. For showing off, so anyone who can see the
 * hero can see this, and it is all pictures.
 */
export function MakingOf({ creation, onBack }: { creation: CreationResponse; onBack: () => void }) {
  const file = (f: string) => api.getFileUrl(creation.id, f, creation.user_id);
  const rig = creation.steps.find((s) => s.step_name === 'meshy_rig');
  const walking = (rig?.metadata_json as { walking_glb_url?: string } | null)?.walking_glb_url ?? 'walking.glb';
  const done = (step: string) => creation.steps.find((s) => s.step_name === step)?.status === 'completed';

  const phases: Array<{ icon: IconName; label: string; show: () => JSX.Element }> = [
    { icon: 'pencil', label: 'The drawing', show: () => <img className="tb-making-img" src={file('original.jpg')} alt="The drawing" /> },
    ...(done('openai_render') ? [{ icon: 'brush' as IconName, label: 'Painted', show: () => <img className="tb-making-img" src={file('rendered.png')} alt="Painted" /> }] : []),
    ...(done('meshy_3d') ? [{ icon: 'cube' as IconName, label: 'Sculpted in 3D', show: () => <ModelPreview url={file('model.glb')} interactive={false} /> }] : []),
    ...(done('meshy_rig') ? [{ icon: 'run' as IconName, label: 'Brought to life', show: () => <ModelPreview url={file('rigged.glb')} walkingUrl={file(walking)} interactive={false} /> }] : []),
  ];
  const [at, setAt] = useState(0);
  const phase = phases[at];
  const last = at === phases.length - 1;

  return (
    <div className="tb-screen tb-screen--fit tb-making-of">
      <Header left={<NavButton icon="back" label="Back to hero" onClick={onBack} className="tb-back" />} title={heroName(creation)} />
      <div className="tb-screen-body">
        <div className="tb-stepper tb-making-steps" role="tablist" aria-label="How it was made">
          {phases.map((p, i) => (
            <div key={p.label} style={{ display: 'contents' }}>
              <button type="button" role="tab" aria-selected={i === at} aria-label={p.label}
                className={`tb-step-dot ${i < at ? 'tb-step-dot--done' : i === at ? 'tb-step-dot--now' : 'tb-step-dot--next'}`}
                onClick={() => setAt(i)}>
                <Icon name={p.icon} size={i === at ? 24 : 18} />
              </button>
              {i < phases.length - 1 && <div className={`tb-step-line${i < at ? ' tb-step-line--done' : ''}`} />}
            </div>
          ))}
        </div>
        <div className="tb-stage tb-making-stage" data-phase={at}>{phase.show()}</div>
        <div className="tb-h2 tb-making-label">{phase.label}</div>
      </div>
      <div className="tb-bar">
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-making-next" onClick={() => (last ? setAt(0) : setAt(at + 1))}>
          {last ? <><Icon name="redo" />Watch again</> : <>Next<Icon name="play" /></>}
        </button>
      </div>
    </div>
  );
}
