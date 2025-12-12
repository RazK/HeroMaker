export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface CreationTask {
  name: string;
  status: TaskStatus;
  output_file?: string | null;
  file_url?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface Creation {
  id: string;
  status: TaskStatus | 'pending' | 'processing' | 'completed' | 'failed';
  current_task: string | null;
  character_name: string | null;
  user_id: string;
  created_at: string;
  updated_at?: string;
  tasks: CreationTask[];
}

export interface ApiErrorShape {
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
}
