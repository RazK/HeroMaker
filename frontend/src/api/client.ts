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

export type StepErrorCode =
  | 'safety_blocked' | 'provider_busy' | 'bad_input' | 'out_of_credits_provider'
  | 'not_enough_credits' | 'cancelled' | 'interrupted' | 'unknown';

export interface CreationStepResponse {
  step_name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  estimated_completion_time: string | null;
  /** The safe line below, or for an admin the raw provider error. */
  error_message: string | null;
  /** Why a failed step failed (backend app/services/step_errors.py). */
  error_code?: StepErrorCode | null;
  /** One short line for whoever made the hero. Never the provider's text. */
  error_user?: string | null;
  /** The step's charge really was given back. */
  credits_refunded?: boolean;
  /** Admins only: the raw provider error, and its request ID if it had one. */
  error_detail?: string | null;
  error_request_id?: string | null;
  metadata_json?: { [key: string]: any } | null;
  /** 0-100 as the provider reported it (Meshy); null when the provider reports nothing. */
  progress?: number | null;
  /** The step's typical length, seconds. */
  estimated_duration?: number | null;
}

export interface CreationResponse {
  id: string;
  character_name: string | null;
  name: string | null;
  age: number | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  user_id: string;
  username: string | null; // Deprecated, use name instead
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  steps: CreationStepResponse[];
  error_message: string | null;
  /** The painting's style, a key of GET /api/styles. Older heroes read "pixar". */
  style?: string;
  /** Starred by an admin: shown under Editors' choice. */
  featured?: boolean;
  /** Made in a class, not yet kept by a parent: private, never featured. */
  in_class?: boolean;
  /** File name -> a token that changes whenever that file does (see heroFileUrl). */
  file_versions?: Record<string, string>;
}

/** A look the painting can be made in. The first one is the default. */
export interface RenderStyle {
  key: string;
  label: string;
}

// Step configuration from backend
export interface StepConfig {
  name: string;
  display_name: string;
  credit_cost: number;
  output_file: string;
}


class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
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
      // FastAPI validation errors arrive as a list of {msg, loc}; a plain
      // string detail is shown as-is. Never let an object reach the UI, where
      // it renders as "[object Object]".
      const detail = errorJson.detail;
      if (Array.isArray(detail)) {
        errorMessage = detail
          .map((d: { msg?: string }) => String(d?.msg ?? '').replace(/^Value error, /, ''))
          .filter(Boolean)
          .join('. ') || errorMessage;
      } else if (typeof detail === 'string') {
        errorMessage = detail;
      }
    } catch {
      // Not JSON: an HTML error page from a proxy (413, 502...). Never show
      // markup to the user; say what happened in plain words.
      errorMessage = response.status === 413
        ? 'That photo is too big. Try another one.'
        : /^\s*</.test(errorText) || !errorText
          ? 'Something went wrong. Please try again.'
          : errorText;
    }
    console.error(`[API] ${method} ${url} failed (${duration}ms):`, {
      status: response.status,
      error: errorMessage,
    });
    throw new ApiError(response.status, errorMessage);
  }

  // 204 No Content has no body to parse.
  if (response.status === 204) {
    return undefined as T;
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
   * Pipeline must be started separately using runPipeline().
   */
  async createCreation(file: File, characterName?: string): Promise<CreationResponse> {
    console.log('[API] createCreation:', {
      filename: file.name,
      size: `${(file.size / 1024).toFixed(1)}KB`,
      type: file.type,
      characterName,
    });
    const formData = new FormData();
    const upload = await shrinkPhoto(file);
    formData.append('image_file', upload, upload.name);
    if (characterName) {
      formData.append('character_name', characterName);
    }
    
    const result = await fetchJson<CreationResponse>(
      `${API_BASE_URL}/api/creations/create`,
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
   * Run full pipeline (all steps sequentially)
   * @param creationId The creation to process
   * @param fromStep Optional step name to start from (for retry scenarios)
   * @param style Optional painting style, stored on the hero. Leave it out to
   *   keep the hero's own (Make it again, Try again).
   */
  async runPipeline(creationId: string, fromStep?: string, style?: string): Promise<{ message: string; creation_id: string; from_step: string }> {
    const query = new URLSearchParams();
    if (fromStep) query.set('from_step', fromStep);
    if (style) query.set('style', style);
    const params = query.toString() ? `?${query}` : '';
    console.log('[API] runPipeline:', { creationId, fromStep, style });
    const result = await fetchJson<{ message: string; creation_id: string; from_step: string }>(
      `${API_BASE_URL}/api/creations/${creationId}/run-pipeline${params}`,
      {
        method: 'POST',
      }
    );
    console.log('[API] runPipeline result:', result);
    return result;
  },

  /**
   * Cancel a processing step
   */
  async cancelStep(creationId: string, stepName: string): Promise<{ message: string; creation_id: string; step_name: string }> {
    console.log('[API] cancelStep:', { creationId, stepName });
    const result = await fetchJson<{ message: string; creation_id: string; step_name: string }>(
      `${API_BASE_URL}/api/creations/${creationId}/steps/${stepName}/cancel`,
      {
        method: 'POST',
      }
    );
    console.log('[API] cancelStep result:', result);
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
  async listCreations(limit: number = 50, offset: number = 0, mineOnly: boolean = false, featuredOnly: boolean = false): Promise<{ creations: CreationResponse[]; total: number }> {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    params.append('offset', String(offset));
    if (mineOnly) {
      params.append('mine_only', 'true');
    }
    if (featuredOnly) {
      params.append('featured_only', 'true');
    }
    const result = await fetchJson<CreationResponse[]>(
      `${API_BASE_URL}/api/creations/?${params.toString()}`
    );
    console.log('[API] listCreations result:', {
      count: result.length,
      total: result.length,
      mineOnly,
    });
    return { creations: result, total: result.length };
  },

  /**
   * Get file URL for a creation file
   */
  getFileUrl(creationId: string, filename: string, userId?: string): string {
    // Use provided userId, fallback to DEBUG_USER_ID for backward compatibility
    const user_id = userId || 'debug-user-uuid';
    const url = `${API_BASE_URL}/api/files/${user_id}/${creationId}/${filename}`;
    return url;
  },

  /**
   * URL of one of a hero's files, carrying the file's version when the hero
   * has one for it. A versioned thumbnail (thumb_*) is served as its bytes and
   * cached by the browser for a year: re-running a step changes the version,
   * hence the URL. Use this for every thumbnail, so the gallery, the hero
   * page and the polaroid all share one cached copy.
   */
  heroFileUrl(creation: Pick<CreationResponse, 'id' | 'user_id' | 'file_versions'>, filename: string): string {
    const url = api.getFileUrl(creation.id, filename, creation.user_id);
    if (!filename.startsWith('thumb_')) return url;
    const version = creation.file_versions?.[filename.slice('thumb_'.length)];
    return version ? `${url}?v=${encodeURIComponent(version)}` : url;
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
   * Star or unstar a hero for Editors' choice (admins only).
   */
  async setFeatured(creationId: string, featured: boolean): Promise<CreationResponse> {
    return fetchJson<CreationResponse>(
      `${API_BASE_URL}/api/creations/${creationId}/featured`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured }),
      }
    );
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
  async downloadFile(creationId: string, filename: string, userId?: string): Promise<void> {
    const effectiveUserId = userId || 'unknown';
    const url = `${API_BASE_URL}/api/files/download/${effectiveUserId}/${creationId}/${filename}`;
    console.log('[API] downloadFile:', { creationId, filename, userId, url });
    
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
  async signup(username: string, email: string, password: string, name: string, dateOfBirth: string, isTeacher = false): Promise<{ access_token: string; user: any }> {
    console.log('[API] signup:', { username, email, name });
    const result = await fetchJson<{ access_token: string; token_type: string; user: any }>(
      `${API_BASE_URL}/api/auth/signup`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password, name, date_of_birth: dateOfBirth, is_teacher: isTeacher }),
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

  /** Which sign-in features this deployment offers. Fetched once per page load. */
  getAuthConfig(): Promise<AuthConfig> {
    authConfigPromise ??= fetchJson<AuthConfig>(`${API_BASE_URL}/api/auth/config`)
      .catch(() => ({ password_reset: false, google_client_id: null }));
    return authConfigPromise;
  },

  /** Always resolves the same way whether or not the account exists. */
  async forgotPassword(email: string): Promise<void> {
    await fetchJson(`${API_BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  },

  /** Sets the new password and signs in, exactly like login. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const result = await fetchJson<{ access_token: string }>(`${API_BASE_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: newPassword }),
    });
    setAuthToken(result.access_token);
    window.dispatchEvent(new CustomEvent('auth:login'));
  },

  /** Sign in or up with a Google Identity Services ID token. */
  async loginWithGoogle(credential: string): Promise<{ access_token: string; user: any }> {
    const result = await fetchJson<{ access_token: string; token_type: string; user: any }>(
      `${API_BASE_URL}/api/auth/google`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ credential }),
      }
    );
    setAuthToken(result.access_token);
    window.dispatchEvent(new CustomEvent('auth:login'));
    console.log('[API] google login success');
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

  /**
   * Delete the signed-in account. `confirm` must be the username.
   * On success the token is dropped and `auth:account-deleted` is announced.
   */
  async deleteAccount(confirm: string): Promise<void> {
    await fetchJson<void>(`${API_BASE_URL}/api/auth/me`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    });
    clearAuthToken();
    window.dispatchEvent(new CustomEvent('auth:account-deleted'));
    window.dispatchEvent(new CustomEvent('auth:logout'));
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
   * Credit packs on sale. Only packs with a working checkout are listed.
   */
  async getPacks(): Promise<CreditPack[]> {
    return fetchJson<CreditPack[]>(`${API_BASE_URL}/api/payments/packs`);
  },

  /**
   * The painting styles, in picker order. Public.
   */
  async getStyles(): Promise<RenderStyle[]> {
    return fetchJson<RenderStyle[]>(`${API_BASE_URL}/api/styles`);
  },

  /**
   * Open a Lemon Squeezy checkout for a pack. The caller sends the browser to
   * checkout_url and nothing else: credits are granted only by the signed
   * webhook, never by anything the browser reports.
   */
  async createCheckout(pack: string, redirectUrl: string): Promise<{ checkout_url: string; test_mode: boolean }> {
    return fetchJson<{ checkout_url: string; test_mode: boolean }>(`${API_BASE_URL}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack, redirect_url: redirectUrl }),
    });
  },

  /**
   * Get the credit cost for running steps
   */
  async getCreationCost(steps?: string[]): Promise<{ cost: number }> {
    const params = new URLSearchParams();
    if (steps && steps.length > 0) {
      params.append('steps', steps.join(','));
    }
    const url = `${API_BASE_URL}/api/creations/cost${params.toString() ? `?${params.toString()}` : ''}`;
    const result = await fetchJson<{ cost: number }>(url);
    console.log('[API] getCreationCost:', result);
    return result;
  },

  /**
   * Get step configuration from backend
   */
  async getStepsConfig(): Promise<StepConfig[]> {
    const result = await fetchJson<{ steps: StepConfig[] }>(`${API_BASE_URL}/api/creations/steps/config`);
    console.log('[API] getStepsConfig:', result);
    return result.steps;
  },

  /**
   * Get individual step status (for polling during processing)
   */
  async getStepStatus(creationId: string, stepName: string): Promise<CreationStepResponse> {
    const result = await fetchJson<CreationStepResponse>(
      `${API_BASE_URL}/api/creations/${creationId}/steps/${stepName}`
    );
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
    is_teacher?: boolean;
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
    // Live accounts only. Test accounts (robot_*, @example.com) only when asked.
    async listUsers(includeTest = false): Promise<AdminUserResponse[]> {
      console.log('[API] admin.listUsers', { includeTest });
      const result = await fetchJson<AdminUserResponse[]>(
        `${API_BASE_URL}/api/admin/users${includeTest ? '?include_test=true' : ''}`,
      );
      console.log('[API] admin.listUsers success:', { count: result.length });
      return result;
    },

    async countUsers(): Promise<AdminUserCounts> {
      return fetchJson<AdminUserCounts>(`${API_BASE_URL}/api/admin/users/count`);
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

    /** One account: who, their heroes (removed ones too) and the audit log.
     * Also gives this browser the pass to load removed heroes' files. */
    userDetail(userId: string): Promise<AdminUserDetail> {
      return fetchJson<AdminUserDetail>(`${API_BASE_URL}/api/admin/users/${userId}`);
    },

    removeHero(creationId: string, reason: RemovalReason, note: string): Promise<AdminAction> {
      return fetchJson<AdminAction>(`${API_BASE_URL}/api/admin/creations/${creationId}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, note }),
      });
    },

    restoreHero(creationId: string): Promise<AdminAction> {
      return fetchJson<AdminAction>(`${API_BASE_URL}/api/admin/creations/${creationId}/restore`, { method: 'POST' });
    },

    /** Give (amount > 0) or take back (amount < 0) credits. The note is required. */
    changeCredits(userId: string, amount: number, note: string): Promise<{ credits: number; action: AdminAction }> {
      return fetchJson<{ credits: number; action: AdminAction }>(`${API_BASE_URL}/api/admin/users/${userId}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, note }),
      });
    },

    // Coupons
    async listCoupons(): Promise<AdminCouponResponse[]> {
      console.log('[API] admin.listCoupons');
      const result = await fetchJson<AdminCouponResponse[]>(`${API_BASE_URL}/api/admin/coupons`);
      console.log('[API] admin.listCoupons success:', { count: result.length });
      return result;
    },

    async createCoupon(data: {
      code?: string;
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

    // Money: income, costs, net, provider balances, monthly bills
    moneySummary(period: MoneyPeriod): Promise<MoneySummary> {
      return fetchJson<MoneySummary>(`${API_BASE_URL}/api/admin/money/summary?period=${period}`);
    },

    async providerBalances(refresh = false): Promise<ProviderBalance[]> {
      const r = await fetchJson<{ providers: ProviderBalance[] }>(
        `${API_BASE_URL}/api/admin/money/providers${refresh ? '?refresh=true' : ''}`
      );
      return r.providers;
    },

    createRecurring(data: { name: string; amount_usd: number; started_on?: string }): Promise<RecurringExpense> {
      return fetchJson<RecurringExpense>(`${API_BASE_URL}/api/admin/money/recurring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    updateRecurring(id: string, data: { name?: string; amount_usd?: number; started_on?: string; is_active?: boolean }): Promise<RecurringExpense> {
      return fetchJson<RecurringExpense>(`${API_BASE_URL}/api/admin/money/recurring/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    deleteRecurring(id: string): Promise<void> {
      return fetchJson<void>(`${API_BASE_URL}/api/admin/money/recurring/${id}`, { method: 'DELETE' });
    },
  },
};

export type MoneyPeriod = 'month' | '30d' | 'all';

export interface IncomeTotals {
  gross_usd_micros: number;
  fee_usd_micros: number;
  net_usd_micros: number;
  count: number;
}

export interface RecurringExpense {
  id: string;
  name: string;
  amount_usd_micros: number;
  started_on: string;
  is_active: boolean;
  next_charge_on: string | null;
}

export interface MoneySummary {
  period: MoneyPeriod;
  range: { start: string | null; end: string };
  income: { live: IncomeTotals; test: IncomeTotals; refunds: IncomeTotals; fee_is_estimated: boolean };
  costs: {
    providers: { provider: string; cost_usd_micros: number; calls: number }[];
    providers_total_usd_micros: number;
    recurring_usd_micros: number;
    total_usd_micros: number;
    prices_last_checked: string | null;
  };
  net_usd_micros: number;
  recurring: {
    monthly_total_usd_micros: number;
    items: RecurringExpense[];
    upcoming: { id: string; name: string; amount_usd_micros: number; on: string }[];
    upcoming_total_usd_micros: number;
  };
  credits_held: { credits: number; cost_per_credit_usd_micros: number | null; cost_to_serve_usd_micros: number | null };
}

export interface ProviderBalance {
  provider: 'meshy' | 'openai' | 'railway' | string;
  status: 'ok' | 'not_configured' | 'error';
  hint: string | null;
  checked_at: string;
  cached?: boolean;
  // meshy
  credits?: number;
  value_usd_micros?: number;
  monthly_resets_at?: string | null;
  // openai
  month_to_date_usd_micros?: number;
  // railway
  workspace?: string | null;
  current_usage_usd_micros?: number | null;
  projected_usage_usd_micros?: number | null;
  credit_balance_usd_micros?: number | null;
  period_end?: string | null;
}

// Admin types
export interface AuthConfig {
  password_reset: boolean;
  google_client_id: string | null;
}

let authConfigPromise: Promise<AuthConfig> | undefined;

export interface CreditPack {
  slug: string;
  name: string;
  blurb: string;
  credits: number;
  heroes: number;
  price_cents: number;
  price_display: string;
  highlight: boolean;
}

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
  is_test_account?: boolean;
}

export interface AdminUserCounts {
  users: number;
  test_accounts: number;
}

export type RemovalReason = 'inappropriate' | 'not_a_drawing' | 'duplicate' | 'other';

/** One row of the admin audit log: who did what, when and why. */
export interface AdminAction {
  id: string;
  action: 'remove_hero' | 'restore_hero' | 'grant_credits' | 'take_credits' | 'set_credits' | 'make_admin' | 'remove_admin' | 'delete_account';
  reason: RemovalReason | null;
  note: string | null;
  amount: number | null;
  creation_id: string | null;
  details: { hero_name?: string | null; balance_after?: number; previous_balance?: number };
  created_at: string;
  admin: { id: string; username: string | null; name: string | null };
}

export interface AdminHero extends CreationResponse {
  /** Set when an admin took it down: hidden from everyone but admins. */
  removed: { at: string; reason: RemovalReason | null; note: string | null; by: string | null } | null;
  /** A teacher's class hero: the class it was made in. */
  class_title: string | null;
}

export interface AdminUserDetail {
  user: {
    id: string;
    username: string;
    email: string | null;
    name: string | null;
    credits: number;
    is_admin: boolean;
    is_teacher: boolean;
    is_test_account: boolean;
    created_at: string;
    school: { name: string; city: string | null; country: string | null; type: string | null } | null;
    classes: number;
  };
  counts: { heroes: number; removed: number };
  heroes: AdminHero[];
  audit: AdminAction[];
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


/**
 * A phone photo is 3-12 MB at 4000px; the pipeline needs nowhere near that.
 * Scale it to 2048px on the long side as a JPEG, upright (EXIF orientation is
 * applied by createImageBitmap), so uploads are fast on mobile data and stay
 * well under the server's body limit. Anything that fails returns the file as is.
 */
export async function shrinkPhoto(file: File, maxSide = 2048): Promise<File> {
  try {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) { bmp.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
