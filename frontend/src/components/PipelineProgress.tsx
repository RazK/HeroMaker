import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/* ------------------------------------------------------------------------- *
 * Studio geometry
 *
 * Every picture in the Studio is square - the stage and all three rail tiles -
 * and the whole thing has to land inside one screen with no page scroll and no
 * horizontal overflow. That is not something flexbox can express: "the largest
 * square that still leaves room for three smaller squares and an action panel"
 * is a simultaneous constraint on both axes, and `aspect-ratio` alone resolves
 * it by overflowing rather than by shrinking.
 *
 * So the two side lengths are solved here, once per resize, and handed to CSS
 * as custom properties. Placement is still ordinary flexbox; only the numbers
 * come from JS. Because the solved sizes are written to children of a box whose
 * own size comes from its parent, there is no ResizeObserver feedback loop.
 * ------------------------------------------------------------------------- */

/** var(--space-3): stage to rail, rail to actions. */
const GAP_MAIN = 12;
/** var(--space-2): between rail tiles. */
const GAP_RAIL = 8;
/** Above this the rail becomes a column on the left and the stage moves right. */
const WIDE_AT = 900;
/** Two rows of comfortable buttons - the least the action panel may have. */
const ACTIONS_MIN_H = 104;
const ACTIONS_MIN_W = 172;
/**
 * Past this the panel stops growing and the leftover becomes page margin.
 * Without a cap, a tall phone or a wide desktop turned four buttons into four
 * 200px slabs - which fills the space, but not with anything worth looking at.
 * The Studio is centred, so what the panel declines becomes symmetric margin.
 */
const ACTIONS_MAX_H = 136;
const ACTIONS_MAX_W = 320;

type StudioMode = 'portrait' | 'landscape';

interface StudioGeometry {
  mode: StudioMode;
  /** Side of the big square. */
  main: number;
  /** Side of one rail tile. */
  tile: number;
  /** The action panel's height (portrait) or width (landscape). */
  actions: number;
}

/**
 * Solve for the square side.
 *
 * Three tiles plus their two gaps span exactly the same length as the stage, so
 * tile = (main - 2*GAP_RAIL) / 3 and the stage-plus-rail run measures
 * (4*main - 2*GAP_RAIL) / 3 along the stacking axis. Setting that equal to the
 * space left after the gaps and the action panel gives `main` directly; the
 * other axis then just caps it.
 */
function solveStudio(width: number, height: number, mode: StudioMode, hasActions: boolean): StudioGeometry {
  const alongStack = mode === 'portrait' ? height : width;
  const acrossStack = mode === 'portrait' ? width : height;
  // Signed out there are no actions at all - reserving room for them would put
  // back exactly the empty band this layout exists to remove.
  const actionsMin = !hasActions ? 0 : mode === 'portrait' ? ACTIONS_MIN_H : ACTIONS_MIN_W;
  const gaps = hasActions ? 2 : 1;

  const budget = alongStack - gaps * GAP_MAIN - actionsMin;
  const main = Math.max(0, Math.floor(Math.min(acrossStack, (3 * budget + 2 * GAP_RAIL) / 4)));
  const tile = Math.max(0, (main - 2 * GAP_RAIL) / 3);
  // Whatever the squares did not use is the action panel - there is no third
  // thing to give it to, and leaving it empty is the "dead band" this replaces.
  const spare = hasActions ? alongStack - main - tile - 2 * GAP_MAIN : 0;
  const actions = Math.max(0, Math.min(mode === 'portrait' ? ACTIONS_MAX_H : ACTIONS_MAX_W, spare));

  return { mode, main, tile, actions };
}

function useStudioGeometry(hasActions: boolean) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<StudioGeometry>({
    mode: 'portrait',
    main: 0,
    tile: 0,
    actions: 0,
  });

  const measure = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    const mode: StudioMode = window.innerWidth >= WIDE_AT ? 'landscape' : 'portrait';
    const next = solveStudio(el.clientWidth, el.clientHeight, mode, hasActions);
    setGeometry((prev) =>
      prev.mode === next.mode && prev.main === next.main && prev.actions === next.actions
        ? prev
        : next
    );
  }, [hasActions]);

  // Layout effect, not effect: the first paint should already have real sizes,
  // otherwise the stage flashes at zero and the 3D canvas initialises against
  // a degenerate viewport.
  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // innerWidth decides the orientation, and a ResizeObserver on the frame
    // does not necessarily see a width change that only moves the breakpoint.
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return { frameRef, geometry };
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

  // The action panel is the only thing in the Studio that a signed-out visitor
  // does not get, and its absence changes the geometry, so it is an input.
  const { frameRef, geometry } = useStudioGeometry(isLoggedIn);

  const stages = buildStages(creation.steps);

  // Calculate which step is ready
  const readyStepName = getReadyStepName(creation.steps);

  // User can download/redo only their own creations (or if admin)
  const canDownload = isLoggedIn && (isAdmin || creation.user_id === currentUserId);

  // The stage shows one phase at full size. Default to the thing that most
  // wants looking at: what is running, then what went wrong - a failure that
  // opens on the phase before it is a failure nobody sees - and otherwise the
  // furthest phase that has a picture at all. That last test is on the preview
  // step rather than the phase: when rigging is skipped, "3D Hero" is pending
  // but the model from the modelling step is still the best thing on screen.
  const autoStage =
    stages.find((s) => s.status === 'processing') ??
    stages.find((s) => s.status === 'failed') ??
    [...stages].reverse().find((s) => s.previewStep.status === 'completed') ??
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
    if (captured) return { src: captured, glyph: '▶', borrowed: false };
    const isImage = /\.(jpe?g|png)$/i.test(out);
    // 128px, not 512px: the tiles are ~90px wide, so the large variant was
    // four times the pixels and four times the wait for no visible gain.
    const file = isImage ? `thumb_128_${out}` : 'thumb_128_rendered.png';
    // Only the animated hero carries a glyph now; nothing else is a model.
    const glyph = isImage ? null : '▶';
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

  const stagedConfig = stagedStep ? getStepByName(stagedStep.step_name) : undefined;

  return (
    <div
      className={`studio studio-${geometry.mode}`}
      ref={frameRef}
      style={{
        // The solved sides. Everything square in the Studio reads from these
        // two numbers, so the stage and the tiles cannot drift apart.
        ['--studio-main' as string]: `${geometry.main}px`,
        ['--studio-tile' as string]: `${geometry.tile}px`,
        ['--studio-actions' as string]: `${geometry.actions}px`,
      }}
    >
      <div className="studio-stage">
        {stagedStep && stagedStage && (
          <StepCard
            key={stagedStep.step_name}
            step={stagedStep}
            creationId={creation.id}
            userId={creation.user_id}
            stepIndex={stagedIndex}
            stageLabel={stagedStage.label}
            isReady={stagedStep.step_name === readyStepName}
            displayName={stagedConfig?.display_name || stagedStep.step_name}
            outputFile={stagedConfig?.output_file}
            creation={creation}
            isAdmin={isAdmin}
            isLoggedIn={isLoggedIn}
            onIdentityUpdated={onCreationRefresh}
            onPreviewClick={() => handlePreviewClick(stagedStep)}
            onSnapshot={(dataUrl) =>
              setSnapshots((prev) =>
                prev[stagedStep.step_name] ? prev : { ...prev, [stagedStep.step_name]: dataUrl }
              )
            }
          />
        )}
      </div>

      <ol className="studio-rail">
        {stages.map((stage, index) => {
          const isActive = stage.key === stagedStage?.key;
          return (
            <li key={stage.key}>
              <button
                type="button"
                className={`studio-tile is-${stage.status}`}
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
                      className={`studio-tile-thumb${settled ? ' is-settled' : ''}${
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
                        <span className="studio-tile-empty" aria-hidden="true" />
                      )}
                      {glyph && <span className="studio-tile-glyph" aria-hidden="true">{glyph}</span>}
                      <span className="studio-tile-index">{index + 1}</span>
                    </span>
                  );
                })()}
              </button>
            </li>
          );
        })}
      </ol>

      <ControlBar
        creation={creation}
        stage={stagedStage}
        creditBalance={creditBalance}
        isLoggedIn={isLoggedIn}
        canDownload={canDownload}
        onDelete={onDelete}
        onStepRun={onStepRun}
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
