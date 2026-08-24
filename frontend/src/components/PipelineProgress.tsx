import { useState } from 'react';
import { CreationResponse, CreationStepResponse } from '../api/client';
import { StepCard } from './StepCard';
import { ControlBar } from './ControlBar';
import { PreviewModal } from './PreviewModal';
import { getStepByName } from '../config/steps';
import { api } from '../api/client';
import { webModel } from '../api/webModel';
import './PipelineProgress.css';

interface PipelineProgressProps {
  creation: CreationResponse;
  creditBalance?: number;
  isLoggedIn: boolean;
  currentUserId?: string;
  isAdmin: boolean;
  onStepRun?: (stepName: string) => void;
  onCreationRefresh?: () => Promise<void>;
  onDelete?: () => void;
}

/**
 * Calculate which step is "ready" (first non-completed step)
 * Returns the step name that should be enabled, or null if all completed
 */
function getReadyStepName(steps: CreationStepResponse[]): string | null {
  for (const step of steps) {
    // Skip if processing - that step is already running
    if (step.status === 'processing') {
      return null; // No step is "ready" when one is processing
    }
    // First non-completed step is ready
    if (step.status !== 'completed') {
      return step.step_name;
    }
  }
  return null; // All completed
}

/**
 * The rail shows stages, not raw pipeline steps.
 *
 * The backend runs five steps; two of them are plumbing as far as the person
 * waiting is concerned. convert_vrm produces a download, not a picture, and
 * lives in the ControlBar. meshy_3d produces an untextured GLB that is only
 * ever an input to meshy_rig - shown on its own it was a tile identical to the
 * one next to it.
 *
 * The previous rule hid meshy_3d once it completed, which meant the rail had
 * four tiles during a run and three afterwards: the tile you were watching
 * disappeared at the moment it succeeded and everything after it renumbered.
 * Grouping instead keeps the rail at a fixed three from the moment a creation
 * exists to the moment it finishes - only the third tile's contents change as
 * modelling hands over to rigging.
 */
const RAIL_STAGES: { key: string; label: string; stepNames: string[] }[] = [
  { key: 'drawing', label: 'The Drawing', stepNames: ['image_processing'] },
  { key: 'render', label: 'AI Rendering', stepNames: ['openai_render'] },
  { key: 'hero', label: '3D Hero', stepNames: ['meshy_3d', 'meshy_rig'] },
];

export interface RailStage {
  key: string;
  label: string;
  /** Every backend step this tile stands for, in pipeline order. */
  steps: CreationStepResponse[];
  /** The one the tile opens on the big stage. */
  step: CreationStepResponse;
  /** The one the tile takes its picture from - not always the same. */
  previewStep: CreationStepResponse;
  status: CreationStepResponse['status'];
}

/**
 * Roll the backend's steps up into the tiles the rail shows.
 *
 * A stage is only 'completed' when its *last* step is - so "3D Hero" does not
 * claim to be done while rigging is still to run. A failure anywhere in the
 * group surfaces on the tile rather than being hidden behind a completed
 * sibling, which is what answers "what if rigging is skipped or fails": the
 * tile shows the untextured model it did get, and the stage below says why
 * there is no rigged one.
 */
export function buildStages(steps: CreationStepResponse[]): RailStage[] {
  const byName = new Map(steps.map((s) => [s.step_name, s]));

  return RAIL_STAGES.flatMap(({ key, label, stepNames }) => {
    const members = stepNames.map((n) => byName.get(n)).filter(Boolean) as CreationStepResponse[];
    if (members.length === 0) return [];

    const last = members[members.length - 1];
    const status: CreationStepResponse['status'] =
      members.some((m) => m.status === 'failed') ? 'failed'
      : members.some((m) => m.status === 'processing') ? 'processing'
      : last.status === 'completed' ? 'completed'
      : last.status;

    // Open the most advanced thing that exists: the running step if there is
    // one, otherwise the last that finished, otherwise the first.
    const step =
      members.find((m) => m.status === 'processing') ??
      [...members].reverse().find((m) => m.status === 'completed') ??
      members[0];

    // The picture comes from the last step that actually produced output. While
    // rigging runs, the tile shows the model that modelling already made rather
    // than sitting empty for the several minutes rigging takes.
    const previewStep = [...members].reverse().find((m) => m.status === 'completed') ?? step;

    return [{ key, label, steps: members, step, previewStep, status }];
  });
}

export function calculateOverallProgress(creation: CreationResponse): number {
  if (creation.steps.length === 0) return 0;
  const completed = creation.steps.filter((s) => s.status === 'completed').length;
  return Math.round((completed / creation.steps.length) * 100);
}

export function PipelineProgress({ creation, creditBalance, isLoggedIn, currentUserId, isAdmin, onStepRun, onCreationRefresh, onDelete }: PipelineProgressProps) {
  const [previewStep, setPreviewStep] = useState<CreationStepResponse | null>(null);
  const [selectedStepName, setSelectedStepName] = useState<string | null>(null);
  // Stills captured from the 3D stage, keyed by step. Model steps have no image
  // on disk, so this is what stops their rail tile duplicating the AI render.
  const [snapshots, setSnapshots] = useState<Record<string, string>>({});
  // Which rail pictures have finished decoding. Drives the loading sheen, which
  // is what stops a tile reading as broken while its image is in flight.
  const [loadedThumbs, setLoadedThumbs] = useState<Record<string, boolean>>({});

  const stages = buildStages(creation.steps);

  // Calculate which step is ready
  const readyStepName = getReadyStepName(creation.steps);
  
  // User can download/redo only their own creations (or if admin)
  const canDownload = isLoggedIn && (isAdmin || creation.user_id === currentUserId);

  // The stage shows one step at full size. Default to the most advanced thing
  // worth looking at: whatever is running now, or the last thing that finished.
  const autoStage =
    stages.find((s) => s.status === 'processing') ??
    [...stages].reverse().find((s) => s.status === 'completed') ??
    stages[0];
  const stagedStage =
    stages.find((s) => s.steps.some((step) => step.step_name === selectedStepName)) ?? autoStage;
  const stagedStep = stagedStage?.step;
  const stagedIndex = stages.findIndex((s) => s.key === stagedStage?.key);

  /**
   * Preview image for a rail item. Image steps use their own output; the two
   * 3D steps have no image output, so they borrow the render and carry a glyph
   * that says which stage they are.
   */
  const railPreview = (
    step: CreationStepResponse
  ): { src: string | null; glyph: string | null; borrowed: boolean } => {
    const out = getStepByName(step.step_name)?.output_file;
    if (!out || step.status !== 'completed') return { src: null, glyph: null, borrowed: false };
    const captured = snapshots[step.step_name];
    if (captured) return { src: captured, glyph: '\u25B6', borrowed: false };
    const isImage = /\.(jpe?g|png)$/i.test(out);
    // 128px, not 512px: the tiles are ~90px wide, so the large variant was
    // four times the pixels and four times the wait for no visible gain.
    const file = isImage ? `thumb_128_${out}` : 'thumb_128_rendered.png';
    // Only the animated hero carries a glyph now; nothing else is a model.
    const glyph = isImage ? null : '\u25B6';
    try {
      // A model step has no picture of its own until the stage has been opened
      // and snapshotted, so until then it borrows the render. Flagged, because
      // an unflagged borrow is a tile identical to its neighbour - the "three
      // of these look the same" problem.
      return { src: api.getFileUrl(creation.id, file, creation.user_id), glyph, borrowed: !isImage };
    } catch {
      return { src: null, glyph, borrowed: false };
    }
  };

  // Get file URLs for preview modal
  const getPreviewData = (step: CreationStepResponse) => {
    const config = getStepByName(step.step_name);
    const outputFile = config?.output_file;
    
    if (!outputFile) return null;

    const walkingGlbFilename = (step.step_name === 'meshy_rig' && step.metadata_json?.walking_glb_url) 
      ? step.metadata_json.walking_glb_url 
      : null;
    
    const modelFile = (step.step_name === 'meshy_rig' && walkingGlbFilename) 
      ? walkingGlbFilename 
      : outputFile;
    
    // The modal is a preview too, so it takes the web-sized copies.
    const fileUrl = api.getFileUrl(creation.id, webModel(modelFile), creation.user_id);
    const walkingUrl = walkingGlbFilename 
      ? api.getFileUrl(creation.id, webModel(walkingGlbFilename), creation.user_id) 
      : null;
    const riggedUrl = step.step_name === 'meshy_rig' 
      ? api.getFileUrl(creation.id, webModel(outputFile), creation.user_id) 
      : null;

    return {
      fileUrl,
      outputFile,
      walkingUrl,
      riggedUrl,
      displayName: config?.display_name || step.step_name,
    };
  };

  const handlePreviewClick = (step: CreationStepResponse) => {
    if (step.status === 'completed') {
      setPreviewStep(step);
    }
  };

  const handleClosePreview = () => {
    setPreviewStep(null);
  };

  const previewData = previewStep ? getPreviewData(previewStep) : null;

  return (
    <div className="pipeline-progress">
      <div className="pipeline-layout">
        <div className="pipeline-stage">
          {stagedStep && (() => {
            const config = getStepByName(stagedStep.step_name);
            return (
              <StepCard
                key={stagedStep.step_name}
                step={stagedStep}
                creationId={creation.id}
                userId={creation.user_id}
                stepIndex={stagedIndex}
                isReady={stagedStep.step_name === readyStepName}
                displayName={config?.display_name || stagedStep.step_name}
                outputFile={config?.output_file}
                stepCost={config?.credit_cost || 0}
                creditBalance={creditBalance}
                isLoggedIn={isLoggedIn}
                canDownload={canDownload}
                onStepRun={onStepRun}
                onCreationRefresh={onCreationRefresh}
                onPreviewClick={() => handlePreviewClick(stagedStep)}
                onSnapshot={(dataUrl) =>
                  setSnapshots((prev) =>
                    prev[stagedStep.step_name] ? prev : { ...prev, [stagedStep.step_name]: dataUrl }
                  )
                }
              />
            );
          })()}
        </div>

        <ol className="pipeline-rail">
          {stages.map((stage, index) => {
            const isActive = stage.key === stagedStage?.key;
            return (
              <li key={stage.key}>
                <button
                  type="button"
                  className={`pipeline-rail-item is-${stage.status}`}
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={`Show ${stage.label}`}
                  title={stage.label}
                  onClick={() => setSelectedStepName(stage.step.step_name)}
                >
                  {(() => {
                    const { src, glyph, borrowed } = railPreview(stage.previewStep);
                    // A tile is "settled" when nothing more is coming: its
                    // picture has decoded, or the stage is not running and has
                    // nothing to show. A stage that IS running keeps the sheen,
                    // because a picture really is on its way.
                    const settled = src
                      ? Boolean(loadedThumbs[stage.previewStep.step_name])
                      : stage.status !== 'processing';
                    const settle = () =>
                      setLoadedThumbs((prev) =>
                        prev[stage.previewStep.step_name]
                          ? prev
                          : { ...prev, [stage.previewStep.step_name]: true }
                      );
                    return (
                      <span
                        className={`pipeline-rail-thumb${settled ? ' is-settled' : ''}${
                          borrowed ? ' is-borrowed' : ''
                        }`}
                      >
                        {/*
                          * No lazy loading here: the rail is on screen the
                          * moment a creation opens, and deferring these left
                          * tiles blank for seconds. They are a few KB each.
                          */}
                        {src ? (
                          <img
                            src={src}
                            alt=""
                            width={128}
                            height={128}
                            decoding="async"
                            fetchPriority="high"
                            onLoad={settle}
                            onError={settle}
                          />
                        ) : (
                          <span className="pipeline-rail-empty" aria-hidden="true" />
                        )}
                        {glyph && <span className="pipeline-rail-glyph" aria-hidden="true">{glyph}</span>}
                        <span className="pipeline-rail-index">{index + 1}</span>
                      </span>
                    );
                  })()}
                  <span className="pipeline-rail-label">{stage.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      
      <ControlBar 
        creation={creation}
        isLoggedIn={isLoggedIn}
        canDownload={canDownload}
        onDelete={onDelete}
        onCreationRefresh={onCreationRefresh}
      />

      {/* Preview Modal for 3D interaction */}
      {previewStep && previewData && (
        <PreviewModal
          isOpen={true}
          onClose={handleClosePreview}
          creationId={creation.id}
          userId={creation.user_id}
          stepName={previewStep.step_name}
          displayName={previewData.displayName}
          fileUrl={previewData.fileUrl}
          outputFile={previewData.outputFile}
          walkingUrl={previewData.walkingUrl}
          riggedUrl={previewData.riggedUrl}
          canDownload={canDownload}
        />
      )}
    </div>
  );
}
