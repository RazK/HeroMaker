import { useState, useEffect } from 'react';
import { CreationResponse, CreationStepResponse } from '../api/client';
import { ImagePreview } from './ImagePreview';
import { LazyModelPreview as ModelPreview } from './LazyModelPreview';
import { HeroNameEditor } from './HeroNameEditor';
import { api } from '../api/client';
import { webModel } from '../api/webModel';
import './StepCard.css';

interface StepCardProps {
  step: CreationStepResponse;
  creationId: string;
  userId: string;
  stepIndex: number;
  /** The rail's name for this phase - "The Drawing", "AI Rendering", "3D Hero". */
  stageLabel: string;
  isReady: boolean;  // Calculated by parent: first non-completed step
  displayName: string;  // From step config
  outputFile?: string;  // From step config
  creation: CreationResponse;  // For the identity overlay and the VRM share link
  isAdmin: boolean;
  isLoggedIn: boolean;
  onIdentityUpdated?: () => Promise<void>;  // Re-read the creation after a rename
  onPreviewClick?: () => void;  // Called when 3D model is clicked to open modal
  onSnapshot?: (dataUrl: string) => void;  // A still of the rendered model, for the rail
}

function parseDate(dateStr: string): number {
  if (typeof dateStr === 'string' && !dateStr.endsWith('Z') && !dateStr.match(/[+-]\d{2}:\d{2}$/)) {
    return new Date(dateStr + 'Z').getTime();
  }
  return new Date(dateStr).getTime();
}

function getTimeRemaining(step: CreationStepResponse): string | null {
  if (step.status !== 'processing' || !step.estimated_completion_time || !step.started_at) {
    return null;
  }

  const now = new Date().getTime();
  const started = parseDate(step.started_at);
  const estimated = parseDate(step.estimated_completion_time);
  const total = estimated - started;
  const elapsed = now - started;
  const remaining = estimated - now;

  const isStale = remaining < 0 && elapsed > total * 2;

  if (isStale) {
    return 'Taking longer than expected...';
  }

  if (remaining <= 0) {
    return 'Anytime now...';
  }

  if (remaining < 1000) {
    return 'Almost done...';
  }

  const seconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  let timeStr: string;
  if (hours > 0) {
    timeStr = `~${hours}h ${minutes % 60}m remaining`;
  } else if (minutes > 0) {
    timeStr = `~${minutes}m ${seconds % 60}s remaining`;
  } else {
    timeStr = `~${seconds}s remaining`;
  }

  return timeStr;
}

function getKalidoFace3DShareLink(vrmFileUrl: string): string {
  const encodedVrmUrl = encodeURIComponent(vrmFileUrl);
  return `https://3d.kalidoface.com/?vrm=${encodedVrmUrl}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}

/**
 * The picture the 3D stage stands on while its model downloads.
 *
 * Every model in the pipeline is built from the AI render, so the render is a
 * picture of the same character from the same angle - the closest thing to the
 * finished 3D view that exists before the model has arrived. The 512px copy is
 * a few tens of kilobytes and is pre-built when the render step completes, so
 * it lands in roughly the time a rail tile does.
 */
const MODEL_POSTER_FILE = 'thumb_512_rendered.png';

/** "Tap" reads wrong with a mouse and "Click" reads wrong on a phone. */
const POINTER_VERB =
  typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches ? 'Tap' : 'Click';

/**
 * What the status chip in the stage's corner says.
 *
 * It used to be a header band above the hero's name, which pushed the picture
 * down and stacked two titles on top of each other. In the corner it costs no
 * layout at all, so it can afford to be specific: a phase that is running names
 * the step that is running rather than the phase it belongs to.
 */
function chipText(
  step: CreationStepResponse,
  stepIndex: number,
  stageLabel: string,
  displayName: string,
  isReady: boolean
): string {
  const phase = `Phase ${stepIndex + 1}`;
  if (step.status === 'processing') return `${phase} · ${displayName}`;
  if (step.status === 'failed') return `${phase} · Failed`;
  if (step.status === 'pending') return `${phase} · ${isReady ? 'Up next' : 'Not run yet'}`;
  return `${phase} · ${stageLabel}`;
}

export function StepCard({
  step,
  creationId,
  userId,
  stepIndex,
  stageLabel,
  isReady,
  displayName,
  outputFile,
  creation,
  isAdmin,
  isLoggedIn,
  onIdentityUpdated,
  onPreviewClick,
  onSnapshot,
}: StepCardProps) {
  const [, setTick] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);

  // Force re-render every second for live time updates
  useEffect(() => {
    if (step.status === 'processing') {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [step.status, step.step_name]);

  const timeRemaining = getTimeRemaining(step);
  const isImageStep = outputFile && (outputFile.endsWith('.jpg') || outputFile.endsWith('.png'));
  const isModelStep = outputFile && outputFile.endsWith('.glb');
  const showPreview = step.status === 'completed' && outputFile;

  const walkingGlbFilename = (step.step_name === 'meshy_rig' && step.metadata_json?.walking_glb_url)
    ? step.metadata_json.walking_glb_url
    : null;

  const modelFile = (step.step_name === 'meshy_rig' && walkingGlbFilename)
    ? walkingGlbFilename
    : outputFile;

  // Previews load the web-sized copy; the share link below keeps the original.
  const fileUrl = showPreview && modelFile
    ? api.getFileUrl(creationId, webModel(modelFile), userId)
    : null;

  const walkingUrl = (step.step_name === 'meshy_rig' && showPreview && walkingGlbFilename)
    ? api.getFileUrl(creationId, webModel(walkingGlbFilename), userId)
    : null;

  const riggedUrl = (step.step_name === 'meshy_rig' && showPreview && outputFile)
    ? api.getFileUrl(creationId, webModel(outputFile), userId)
    : null;

  const posterSrc = isModelStep
    ? api.getFileUrl(creationId, MODEL_POSTER_FILE, userId)
    : undefined;

  const thumbSrc = isImageStep && outputFile
    ? api.getFileUrl(creationId, `thumb_512_${outputFile}`, userId)
    : undefined;

  // The blurred fill behind the artwork. Same picture, 512px copy - see
  // .studio-card-backdrop for why the stage has one at all.
  const backdropSrc = step.status === 'completed' ? (thumbSrc ?? posterSrc) : undefined;

  // The VRM is produced by a step the rail does not show, so its share link
  // hangs off the 3D stage - the only place in the Studio it makes sense.
  const vrmReady = creation.steps.some(
    (s) => s.step_name === 'convert_vrm' && s.status === 'completed'
  );
  const canShareVrm = isModelStep && step.status === 'completed' && vrmReady;

  const handleShareVrm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // The untouched file, not the web-sized copy: an outside viewer has to be
    // able to read it with a strict glTF loader.
    const shareLink = getKalidoFace3DShareLink(api.getFileUrl(creationId, 'avatar.vrm', userId));
    const success = await copyToClipboard(shareLink);
    if (success) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } else {
      window.open(shareLink, '_blank');
    }
  };

  return (
    <div className={`studio-card is-${step.status}${isReady && step.status === 'pending' ? ' is-ready' : ''}`}>
      {/*
        * The picture, edge to edge. Everything else in the Studio floats on
        * top of it - nothing above it, nothing beside it, so the square the
        * layout solved for is all picture.
        */}
      <div className="studio-card-media">
        {backdropSrc && (
          <img className="studio-card-backdrop" src={backdropSrc} alt="" aria-hidden="true" decoding="async" />
        )}
        {step.status === 'completed' && showPreview && fileUrl && (
          <div className="studio-card-content">
            {isImageStep && (
              <ImagePreview
                src={fileUrl}
                alt={displayName}
                className="studio-card-image"
                /* 512px copy of the same picture, painted while the full-size
                   render downloads. */
                placeholderSrc={thumbSrc}
              />
            )}
            {isModelStep && (
              <div
                className="studio-card-model"
                onClick={onPreviewClick}
                title={`${POINTER_VERB} to interact with 3D model`}
              >
                <ModelPreview
                  onSnapshot={onSnapshot}
                  url={fileUrl}
                  isRigged={step.step_name === 'meshy_rig'}
                  walkingUrl={walkingUrl}
                  riggedUrl={riggedUrl}
                  posterSrc={posterSrc}
                  interactive={false}
                />
                <div className="studio-card-model-hint">{POINTER_VERB} to interact</div>
              </div>
            )}
          </div>
        )}

        {step.status === 'processing' && (() => {
          const timeMatch = timeRemaining?.match(/^(~?)(.+?)\s+(remaining)$/);
          const timeValue = timeMatch ? timeMatch[1] + timeMatch[2] : timeRemaining;
          const remainingText = timeMatch ? timeMatch[3] : '';

          return (
            <div className="studio-card-waiting">
              <div className="studio-card-waiting-spinner" aria-hidden="true" />
              {timeValue && <div className="studio-card-countdown">{timeValue}</div>}
              {remainingText && <div className="studio-card-countdown-label">{remainingText}</div>}
            </div>
          );
        })()}

        {step.status === 'failed' && (
          <div className="studio-card-failed" role="alert">
            <strong>{displayName} failed</strong>
            {step.error_message && <span>{step.error_message}</span>}
          </div>
        )}

        {step.status === 'pending' && (
          <div className="studio-card-pending">
            <span aria-hidden="true">✧</span>
            <span>{isReady ? 'Not made yet' : 'Waiting for the phase before it'}</span>
          </div>
        )}
      </div>

      {/* The status chip - a corner of the picture, never a band above it. */}
      <span className="studio-card-chip">
        {chipText(step, stepIndex, stageLabel, displayName, isReady)}
      </span>

      {canShareVrm && (
        <button
          type="button"
          className="studio-card-share"
          onClick={handleShareVrm}
          title="Copy a KalidoFace3D link to this VRM"
        >
          {shareCopied ? '✓ Copied' : '🔗 Share'}
        </button>
      )}

      {/*
        * Name, creator and age ride on the picture on a scrim, exactly the way
        * a gallery card carries them, so the Studio and the Gallery read as the
        * same object. Editing happens in place - there is no form band.
        */}
      <HeroNameEditor
        creationId={creation.id}
        characterName={creation.character_name}
        name={creation.name}
        age={creation.age}
        isAdmin={isAdmin}
        isLoggedIn={isLoggedIn}
        onUpdated={onIdentityUpdated}
      />
    </div>
  );
}
