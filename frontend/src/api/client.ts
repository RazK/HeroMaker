const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// JWT Token management
const JWT_TOKEN_KEY = 'heromaker_jwt_token';

export function getAuthToken(): string | null {
  return localStorage.getItem(JWT_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(JWT_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(JWT_TOKEN_KEY);
}

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
  user_id: string;
  username: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  steps: CreationStepResponse[];
  error_message: string | null;
}

// Step configuration from backend
export interface StepConfig {
  name: string;
  display_name: string;
  credit_cost: number;
  output_file: string;
}

export interface StepsConfigResponse {
  steps: StepConfig[];
  total_cost: number;
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

  // Add JWT token to headers if available
  const token = getAuthToken();
  const headers = new Headers(options?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Merge headers with existing options
  const requestOptions: RequestInit = {
    ...options,
    headers,
  };

  // Log all requests except polling (to reduce spam)
  if (!isPolling) {
    console.log(`[API] ${method} ${url}`, options?.body ? '(with body)' : '');
  }

  const startTime = Date.now();
  const response = await fetch(url, requestOptions);
  const duration = Date.now() - startTime;

  // Handle 401 Unauthorized - clear token and trigger auth flow
  if (response.status === 401) {
    clearAuthToken();
    // Dispatch custom event for auth error handling
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
  }

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
   * Create a new creation and upload the image file.
   * Pipeline must be started separately using startPipeline().
   */
  async createCreation(file: File, characterName?: string): Promise<CreationResponse> {
    console.log('[API] createCreation:', {
      filename: file.name,
      size: `${(file.size / 1024).toFixed(1)}KB`,
      type: file.type,
      characterName,
    });
    const formData = new FormData();
    formData.append('image_file', file);
    if (characterName) {
      formData.append('character_name', characterName);
    }

    const result = await fetchJson<CreationResponse>(
      `${API_BASE_URL}/api/creations/`,
      {
        method: 'POST',
        body: formData,
      }
    );
    console.log('[API] createCreation result:', {
      creationId: result.id,
      status: result.status,
      stepsCount: result.steps.length,
    });
    return result;
  },

  /**
   * Start pipeline (or resume from a specific step for retry).
   * @param creationId The creation to process
   * @param fromStep Optional step name to start from (for retry scenarios)
   * @param mockCreationId Optional creation ID to copy outputs from (admin testing)
   */
  async startPipeline(creationId: string, fromStep?: string, mockCreationId?: string): Promise<{ message: string; creation_id: string; from_step: string }> {
    const params = new URLSearchParams();
    if (fromStep) params.append('from_step', fromStep);
    if (mockCreationId) params.append('mock_creation_id', mockCreationId);
    const queryString = params.toString() ? `?${params.toString()}` : '';
    console.log('[API] startPipeline:', { creationId, fromStep, mockCreationId });
    const result = await fetchJson<{ message: string; creation_id: string; from_step: string }>(
      `${API_BASE_URL}/api/creations/${creationId}/start${queryString}`,
      {
        method: 'POST',
      }
    );
    console.log('[API] startPipeline result:', result);
    return result;
  },

  /**
   * Cancel all running steps for a creation.
   */
  async cancelCreation(creationId: string): Promise<{ message: string }> {
    console.log('[API] cancelCreation:', { creationId });
    const result = await fetchJson<{ message: string }>(
      `${API_BASE_URL}/api/creations/${creationId}/cancel`,
      {
        method: 'POST',
      }
    );
    console.log('[API] cancelCreation result:', result);
    return result;
  },

  /**
   * Get creation status with all steps (requires auth + ownership)
   */
  async getCreation(creationId: string): Promise<CreationResponse> {
    const result = await fetchJson<CreationResponse>(`${API_BASE_URL}/api/creations/${creationId}`);
    // Log step statuses for debugging (only log 10% to reduce spam)
    if (Math.random() < 0.1) {
      const stepStatuses = result.steps.map(s => `${s.step_name}:${s.status}`).join(', ');
      console.log(`[API] getCreation ${creationId}: status=${result.status}, steps=[${stepStatuses}]`);
    }
    return result;
  },

  /**
   * List creations with optional filters.
   * @param owner 'everyone' (default) or 'my'
   * @param status 'all' (default), 'completed', 'failed', 'pending', 'processing'
   */
  async listCreations(owner: string = 'everyone', status: string = 'all'): Promise<CreationResponse[]> {
    const params = new URLSearchParams();
    if (owner !== 'everyone') params.append('owner', owner);
    if (status !== 'all') params.append('status', status);
    const qs = params.toString();
    const url = `${API_BASE_URL}/api/creations/${qs ? '?' + qs : ''}`;
    const result = await fetchJson<CreationResponse[]>(url);
    console.log('[API] listCreations result:', { owner, status, count: result.length });
    return result;
  },

  /**
   * Get file URL for a creation file (no user_id needed — backend looks it up)
   */
  getFileUrl(creationId: string, filename: string): string {
    return `${API_BASE_URL}/api/creations/${creationId}/files/${filename}`;
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
    const body: Record<string, any> = {
      name: trimmedName,
      age: age !== null ? age : null,
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
      name: trimmedName,
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
      age: age !== null ? age : null,
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
   * Download a file (requires authentication)
   */
  async downloadFile(creationId: string, filename: string): Promise<void> {
    const url = `${API_BASE_URL}/api/creations/${creationId}/files/${filename}?download=true`;
    console.log('[API] downloadFile:', { creationId, filename, url });

    const headers: Record<string, string> = {};
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.error('[API] downloadFile failed:', { status: response.status, filename });
      if (response.status === 401) {
        throw new ApiError(401, 'Authentication required to download files');
      }
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

  /**
   * Authentication methods
   */
  async signup(username: string, email: string, password: string, name: string, dateOfBirth: string): Promise<{ access_token: string; user: any }> {
    console.log('[API] signup:', { username, email, name });
    const result = await fetchJson<{ access_token: string; token_type: string; user: any }>(
      `${API_BASE_URL}/api/auth/signup`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password, name, date_of_birth: dateOfBirth }),
      }
    );
    setAuthToken(result.access_token);
    window.dispatchEvent(new CustomEvent('auth:login'));
    console.log('[API] signup success');
    return result;
  },

  async login(username: string, password: string): Promise<{ access_token: string; user: any }> {
    console.log('[API] login:', { username });
    const result = await fetchJson<{ access_token: string; token_type: string; user: any }>(
      `${API_BASE_URL}/api/auth/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      }
    );
    setAuthToken(result.access_token);
    window.dispatchEvent(new CustomEvent('auth:login'));
    console.log('[API] login success');
    return result;
  },

  async logout(): Promise<void> {
    console.log('[API] logout');
    try {
      await fetchJson(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
      });
    } catch (err) {
      // Ignore errors on logout
      console.warn('[API] logout error (ignored):', err);
    }
    clearAuthToken();
    window.dispatchEvent(new CustomEvent('auth:logout'));
    console.log('[API] logout success');
  },

  async getMe(): Promise<any> {
    const result = await fetchJson<any>(`${API_BASE_URL}/api/auth/me`);
    console.log('[API] getMe success');
    return result;
  },

  /**
   * Redeem a coupon code for credits
   */
  async redeemCoupon(code: string): Promise<{ success: boolean; message: string; credits_added: number; new_balance: number }> {
    console.log('[API] redeemCoupon:', { code });
    const result = await fetchJson<{ success: boolean; message: string; credits_added: number; new_balance: number }>(
      `${API_BASE_URL}/api/coupons/redeem`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      }
    );
    console.log('[API] redeemCoupon success:', result);
    return result;
  },

  /**
   * Get step configuration and total cost from backend
   */
  async getStepsConfig(): Promise<StepsConfigResponse> {
    const result = await fetchJson<StepsConfigResponse>(`${API_BASE_URL}/api/creations/steps`);
    console.log('[API] getStepsConfig:', result);
    return result;
  },

  /**
   * Update current user's profile (self-service)
   */
  async updateProfile(data: {
    name?: string;
    username?: string;
    email?: string;
    date_of_birth?: string;
    current_password?: string;
    new_password?: string;
  }): Promise<any> {
    console.log('[API] updateProfile:', { ...data, current_password: data.current_password ? '***' : undefined, new_password: data.new_password ? '***' : undefined });
    const result = await fetchJson<any>(
      `${API_BASE_URL}/api/auth/me`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      }
    );
    console.log('[API] updateProfile success');
    return result;
  },

  /**
   * Admin API methods
   */
  admin: {
    // Users
    async listUsers(): Promise<AdminUserResponse[]> {
      console.log('[API] admin.listUsers');
      const result = await fetchJson<AdminUserResponse[]>(`${API_BASE_URL}/api/admin/users`);
      console.log('[API] admin.listUsers success:', { count: result.length });
      return result;
    },

    async updateUser(userId: string, data: { credits?: number; is_admin?: boolean }): Promise<AdminUserResponse> {
      console.log('[API] admin.updateUser:', { userId, data });
      const result = await fetchJson<AdminUserResponse>(
        `${API_BASE_URL}/api/admin/users/${userId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      console.log('[API] admin.updateUser success');
      return result;
    },

    async deleteUser(userId: string): Promise<void> {
      console.log('[API] admin.deleteUser:', { userId });
      await fetchJson<{ message: string }>(
        `${API_BASE_URL}/api/admin/users/${userId}`,
        { method: 'DELETE' }
      );
      console.log('[API] admin.deleteUser success');
    },

    // Coupons
    async listCoupons(): Promise<AdminCouponResponse[]> {
      console.log('[API] admin.listCoupons');
      const result = await fetchJson<AdminCouponResponse[]>(`${API_BASE_URL}/api/admin/coupons`);
      console.log('[API] admin.listCoupons success:', { count: result.length });
      return result;
    },

    async createCoupon(data: {
      code: string;
      credit_amount: number;
      max_uses?: number;
      allow_multiple_per_user?: boolean;
      expires_at?: string;
    }): Promise<AdminCouponResponse> {
      console.log('[API] admin.createCoupon:', { code: data.code, credit_amount: data.credit_amount });
      const result = await fetchJson<AdminCouponResponse>(
        `${API_BASE_URL}/api/admin/coupons`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      console.log('[API] admin.createCoupon success');
      return result;
    },

    async updateCoupon(couponId: string, data: { is_active?: boolean }): Promise<AdminCouponResponse> {
      console.log('[API] admin.updateCoupon:', { couponId, data });
      const result = await fetchJson<AdminCouponResponse>(
        `${API_BASE_URL}/api/admin/coupons/${couponId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      console.log('[API] admin.updateCoupon success');
      return result;
    },

    async deleteCoupon(couponId: string): Promise<void> {
      console.log('[API] admin.deleteCoupon:', { couponId });
      await fetchJson<{ message: string }>(
        `${API_BASE_URL}/api/admin/coupons/${couponId}`,
        { method: 'DELETE' }
      );
      console.log('[API] admin.deleteCoupon success');
    },
  },
};

// Admin types
export interface CreationStats {
  completed: number;
  failed: number;
  in_progress: number;
}

export interface AdminUserResponse {
  id: string;
  username: string;
  email: string;
  name: string | null;
  date_of_birth: string | null;
  credits: number;
  is_admin: boolean;
  created_at: string;
  creation_stats: CreationStats;
}

export interface AdminCouponResponse {
  id: string;
  code: string;
  credit_amount: number;
  max_uses: number;
  current_uses: number;
  allow_multiple_per_user: boolean;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export { ApiError };
