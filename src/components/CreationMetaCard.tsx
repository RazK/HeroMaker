import type { Creation } from '../types/api';

interface CreationMetaCardProps {
  creation: Creation;
}

const formatDate = (value?: string) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
};

export function CreationMetaCard({ creation }: CreationMetaCardProps) {
  return (
    <div className="card">
      <header className="card__header">
        <p className="eyebrow">Creation details</p>
        <span className={`status-chip status-chip--${creation.status}`}>{creation.status}</span>
      </header>
      <dl className="meta-list">
        <div>
          <dt>Creation ID</dt>
          <dd>{creation.id}</dd>
        </div>
        <div>
          <dt>User</dt>
          <dd>{creation.user_id}</dd>
        </div>
        <div>
          <dt>Current task</dt>
          <dd>{creation.current_task ?? 'webcam_scan'}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDate(creation.created_at)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDate(creation.updated_at ?? creation.created_at)}</dd>
        </div>
      </dl>
    </div>
  );
}
