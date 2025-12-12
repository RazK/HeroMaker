import type { CreationTask } from '../types/api';

interface CreationRoadmapProps {
  tasks: CreationTask[];
  currentTask: string | null;
}

const taskOrder = [
  'webcam_scan',
  'image_processing',
  'chatgpt_render',
  'meshy_3d',
  'meshy_remesh',
  'meshy_texture',
  'meshy_rig',
  'meshy_animate',
  'select_glb',
  'convert_vrm',
  'complete',
];

function normalizeTasks(tasks: CreationTask[]): CreationTask[] {
  const byName = new Map(tasks.map((task) => [task.name, task]));
  return taskOrder.map((name) => byName.get(name) ?? { name, status: 'pending' });
}

export function CreationRoadmap({ tasks, currentTask }: CreationRoadmapProps) {
  const normalized = normalizeTasks(tasks);

  return (
    <div className="card">
      <header className="card__header">
        <p className="eyebrow">Creation roadmap</p>
        <strong>{normalized.length} tasks</strong>
      </header>
      <ol className="roadmap">
        {normalized.map((task) => {
          const isActive = task.name === currentTask;
          return (
            <li key={task.name} className={`roadmap__item${isActive ? ' is-active' : ''}`}>
              <div>
                <p className="roadmap__name">{task.name.replace(/_/g, ' ')}</p>
                <p className="roadmap__meta">
                  {task.status === 'completed' && task.output_file
                    ? task.output_file
                    : task.status === 'processing'
                      ? 'in progress'
                      : 'pending'}
                </p>
              </div>
              <span className="status-chip">{task.status}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
