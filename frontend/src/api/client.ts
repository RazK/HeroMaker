const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const DEBUG_USER_ID = 'debug-user-uuid';

export interface CreationStepResponse {
  step_name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  estimated_completion_time: string | null;
  error_message: string | null;
  metadata_json?: { [key: string]: any } | null;
}

export interface CreationResponse {
  id: string;
  character_name: string | null;
  name: string | null;
  age: number | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  current_step: string | null;
  user_id: string;
  username: string | null; // Deprecated, use name instead
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  steps: CreationStepResponse[];
  error_message: string | null;
}

export interface RunPipelineResponse {
  message: string;
  creation_id: string;
  step_name?: string;
  retry_all_following: boolean;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const method = options?.method || 'GET';
  const isPolling = url.includes('/api/creations/') && method === 'GET';
  
  // Log all requests except polling (to reduce spam)
  if (!isPolling) {
    console.log(`[API] ${method} ${url}`, options?.body ? '(with body)' : '');
  }
  
  const startTime = Date.now();
  const response = await fetch(url, options);
  const duration = Date.now() - startTime;
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.detail || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    console.error(`[API] ${method} ${url} failed (${duration}ms):`, {
      status: response.status,
      error: errorMessage,
    });
    throw new ApiError(response.status, errorMessage);
  }
  
  const data = await response.json();
  
  // Log all responses except polling (to reduce spam)
  if (!isPolling) {
    console.log(`[API] ${method} ${url} success (${duration}ms)`, data);
  }
  
  return data;
}

export const api = {
  /**
   * Upload an image file and create a new creation
   */
  async uploadImage(file: File, characterName?: string): Promise<CreationResponse> {
    console.log('[API] uploadImage:', {
      filename: file.name,
      size: `${(file.size / 1024).toFixed(1)}KB`,
      type: file.type,
      characterName,
    });
    const formData = new FormData();
    formData.append('file', file);
    if (characterName) {
      formData.append('character_name', characterName);
    }
    
    const result = await fetchJson<CreationResponse>(`${API_BASE_URL}/api/creations/upload`, {
      method: 'POST',
      body: formData,
    });
    console.log('[API] uploadImage result:', {
      creationId: result.id,
      status: result.status,
      stepsCount: result.steps.length,
    });
    return result;
  },

  /**
   * Start or restart the pipeline for a creation
   */
  async runPipeline(
    creationId: string, 
    stepName?: string, 
    retryAllFollowing: boolean = true
  ): Promise<RunPipelineResponse> {
    console.log('[API] runPipeline:', { creationId, stepName, retryAllFollowing });
    const params = new URLSearchParams();
    if (stepName) {
      params.append('step_name', stepName);
    }
    params.append('retry_all_following', String(retryAllFollowing));
    
    const result = await fetchJson<RunPipelineResponse>(
      `${API_BASE_URL}/api/creations/${creationId}/run?${params.toString()}`,
      {
        method: 'POST',
      }
    );
    console.log('[API] runPipeline result:', result);
    return result;
  },

  /**
   * Run a single step
   */
  async runStep(creationId: string, stepName: string): Promise<{ message: string; creation_id: string; step_name: string }> {
    console.log('[API] runStep:', { creationId, stepName });
    const result = await fetchJson<{ message: string; creation_id: string; step_name: string }>(
      `${API_BASE_URL}/api/creations/${creationId}/steps/${stepName}/run`,
      {
        method: 'POST',
      }
    );
    console.log('[API] runStep result:', result);
    return result;
  },

  /**
   * Reset a step and all following steps, then run pipeline from that step
   */
  async resetAndRunFromStep(creationId: string, stepName: string): Promise<{ message: string; creation_id: string; step_name: string }> {
    console.log('[API] resetAndRunFromStep:', { creationId, stepName });
    const result = await fetchJson<{ message: string; creation_id: string; step_name: string }>(
      `${API_BASE_URL}/api/creations/${creationId}/steps/${stepName}/reset-and-run`,
      {
        method: 'POST',
      }
    );
    console.log('[API] resetAndRunFromStep result:', result);
    return result;
  },

  /**
   * Get creation status with all steps
   */
  async getCreation(creationId: string): Promise<CreationResponse> {
    const result = await fetchJson<CreationResponse>(`${API_BASE_URL}/api/creations/${creationId}`);
    // Log step statuses for debugging (only log when status changes or periodically)
    const stepStatuses = result.steps.map(s => `${s.step_name}:${s.status}`).join(', ');
    // Log every 10th call to reduce spam (polling happens every 2s)
    if (Math.random() < 0.1) {
      console.log(`[API] getCreation ${creationId}: status=${result.status}, steps=[${stepStatuses}]`);
    }
    return result;
  },

  /**
   * List all creations
   */
  async listCreations(limit: number = 50, offset: number = 0): Promise<{ creations: CreationResponse[]; total: number }> {
    const result = await fetchJson<{ creations: CreationResponse[]; total: number; limit: number; offset: number }>(
      `${API_BASE_URL}/api/creations/?limit=${limit}&offset=${offset}`
    );
    console.log('[API] listCreations result:', {
      count: result.creations.length,
      total: result.total,
    });
    return { creations: result.creations, total: result.total };
  },

  /**
   * Get file URL for a creation file
   */
  getFileUrl(creationId: string, filename: string): string {
    const url = `${API_BASE_URL}/api/files/${DEBUG_USER_ID}/${creationId}/${filename}`;
    console.log('[API] getFileUrl:', { creationId, filename, url });
    return url;
  },

  /**
   * Update creation character name
   */
  async updateCharacterName(creationId: string, characterName: string): Promise<CreationResponse> {
    console.log('[API] updateCharacterName:', { creationId, characterName });
    const result = await fetchJson<CreationResponse>(
      `${API_BASE_URL}/api/creations/${creationId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ character_name: characterName }),
      }
    );
    console.log('[API] updateCharacterName result:', result);
    return result;
  },

  /**
   * Update creation name and age
   */
  async updateNameAndAge(creationId: string, name: string, age: number | null): Promise<CreationResponse> {
    console.log('[API] updateNameAndAge:', { creationId, name, age });
    const trimmedName = name.trim();
    // Always send name (even if empty string) so backend knows to update it
    // Send empty string instead of null so backend can distinguish between "not provided" and "clear value"
    const body: Record<string, any> = {
      name: trimmedName, // Send empty string if empty, not null
      age: age !== null ? age : null, // Send null explicitly for age
    };
    console.log('[API] updateNameAndAge body:', body);
    const result = await fetchJson<CreationResponse>(
      `${API_BASE_URL}/api/creations/${creationId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    console.log('[API] updateNameAndAge result:', result);
    return result;
  },

  /**
   * Update creation name only
   */
  async updateName(creationId: string, name: string): Promise<CreationResponse> {
    console.log('[API] updateName:', { creationId, name });
    const trimmedName = name.trim();
    const body: Record<string, any> = {
      name: trimmedName, // Send empty string if empty, not null
    };
    console.log('[API] updateName body:', body);
    const result = await fetchJson<CreationResponse>(
      `${API_BASE_URL}/api/creations/${creationId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    console.log('[API] updateName result:', result);
    return result;
  },

  /**
   * Update creation age only
   */
  async updateAge(creationId: string, age: number | null): Promise<CreationResponse> {
    console.log('[API] updateAge:', { creationId, age });
    const body: Record<string, any> = {
      age: age !== null ? age : null, // Send null explicitly for age
    };
    console.log('[API] updateAge body:', body);
    const result = await fetchJson<CreationResponse>(
      `${API_BASE_URL}/api/creations/${creationId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    console.log('[API] updateAge result:', result);
    return result;
  },

  /**
   * Delete a creation
   */
  async deleteCreation(creationId: string): Promise<void> {
    console.log('[API] deleteCreation:', { creationId });
    await fetchJson<void>(
      `${API_BASE_URL}/api/creations/${creationId}`,
      {
        method: 'DELETE',
      }
    );
    console.log('[API] deleteCreation success');
  },

  /**
   * Download a file
   */
  async downloadFile(creationId: string, filename: string): Promise<void> {
    const url = this.getFileUrl(creationId, filename);
    console.log('[API] downloadFile:', { creationId, filename, url });
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('[API] downloadFile failed:', { status: response.status, filename });
      throw new ApiError(response.status, `Failed to download file: ${filename}`);
    }
    
    const blob = await response.blob();
    console.log('[API] downloadFile success:', { filename, size: `${(blob.size / 1024).toFixed(1)}KB` });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  },
};

export { ApiError };

