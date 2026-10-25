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
  | 'safety_blocked' | 'provider_busy' | 'bad_input' | 'out_of_credits_provider' | 'provider_setup'
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
  /** How many credits came back, when the refund recorded it. */
  refunded_credits?: number | null;
  /** Admins only, from the ledger: what the failed attempt was charged (0: never charged). */
  charged_credits?: number | null;
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
  /** The owner's id: the path of the hero's files. */
  user_id: string;
  /** The owner's login name: only for the owner and admins (null for everyone else). */
  username: string | null;
  /** Admins only: the owner's display name. */
  owner_name?: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  steps: CreationStepResponse[];
  error_message: string | null;
  /** The painting's style, a key of GET /api/v1/styles. Older heroes read "pixar". */
  style?: string;
  /** Starred by an admin: shown under Editors' choice. */
  featured?: boolean;
  /** Made in a class, not yet kept by a parent: private, never featured. */
  in_class?: boolean;
  /** File name -> a token that changes whenever that file does (see heroFileUrl). */
  file_versions?: Record<string, string>;
  /** How the painting stands on a plate (see Painting). Absent or null: not decided yet. */
  painting?: Painting | null;
}

/**
 * How a hero's painting is shown on a plate. Older paintings have an opaque
 * studio backdrop baked in; the backend cuts it away (cut_rendered.png):
 * - cut: the backdrop was removed, the hero stands free
 * - transparent: the painting never had one
 * - framed: no confident cut, so the painting is a polaroid, like the drawing
 */
export type Painting = 'cut' | 'transparent' | 'framed';

/** The painting to stand on a plate: its cut-out, or the painting itself when it needs none. */
export const PAINTING_FILE = 'cut_rendered.png';

/** Show this hero's painting in a polaroid frame (no confident cut-out)? */
export const paintingFramed = (h: { painting?: Painting | null } | null | undefined) => h?.painting === 'framed';

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
  const isPolling = (url.includes('/api/v1/heroes/') || url.includes('/api/v1/gallery')) && method === 'GET';
  
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
      } else if (detail && typeof detail.message === 'string') {
        errorMessage = detail.message;
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

export interface ApiKeyInfo {
  id: string;
  name: string;
  kind: 'secret' | 'publishable';
  prefix: string;
  allowed_origins: string[];
  daily_limit: number | null;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

export interface NewApiKey {
  name: string;
  kind: 'secret' | 'publishable';
  allowed_origins?: string[];
  daily_limit?: number | null;
}

export interface ApiEstimates {
  total: { typical_seconds: number; p90_seconds: number };
  stages: Array<{ stage: string; typical_seconds: number; p90_seconds: number; samples: number; source: string }>;
  cost_credits: number;
}

/** A hero as /api/v1 answers it (backend app/services/api_heroes.py view). */
export interface V1Stage {
  stage: string;
  step?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  finishes_at?: string | null;
  typical_seconds: number;
  progress: number;
  provider_progress?: number | null;
  charged_credits?: number | null;
  file: string | null;
  error?: { code: StepErrorCode; message: string | null; credits_refunded: boolean; refunded_credits?: number | null; detail?: string | null; request_id?: string | null } | null;
}
export interface V1Hero {
  id: string;
  status: 'draft' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  stages: V1Stage[];
  files: Record<string, string | null>;
  error: { stage: string; code: string; message: string; credits_refunded: boolean } | null;
  artist: { name: string | null; age: number | null };
  style?: string;
  painting?: Painting | null;
  featured?: boolean;
  in_class?: boolean;
  file_versions?: Record<string, string>;
  owner_id: string;
  mine: boolean;
  owner?: { username: string | null; name: string | null };
}

const V1_STATUS: Record<V1Hero['status'], CreationResponse['status']> = {
  draft: 'pending', queued: 'pending', processing: 'processing', completed: 'completed', failed: 'failed', cancelled: 'failed',
};

/**
 * The app's screens read heroes as CreationResponse. Every hero now comes
 * from /api/v1 (one API for every client), and this is the one place its
 * shape is turned into theirs.
 */
export function fromV1(h: V1Hero): CreationResponse {
  const steps: CreationStepResponse[] = h.stages.filter((s) => s.step).map((s) => ({
    step_name: s.step as string,
    status: s.status,
    started_at: s.started_at,
    completed_at: s.completed_at,
    estimated_completion_time: s.finishes_at ?? null,
    error_message: s.error ? (s.error.detail ?? s.error.message) : null,
    error_code: s.error?.code ?? null,
    error_user: s.error?.message ?? null,
    credits_refunded: s.error?.credits_refunded ?? false,
    refunded_credits: s.error?.refunded_credits ?? null,
    charged_credits: s.charged_credits ?? null,
    error_detail: s.error?.detail ?? null,
    error_request_id: s.error?.request_id ?? null,
    metadata_json: s.step === 'meshy_rig' && h.files.walking_animation ? { walking_glb_url: 'walking.glb' } : {},
    progress: s.status === 'completed' ? 100 : s.provider_progress ?? null,
    estimated_duration: s.typical_seconds || null,
  }));
  const failed = steps.find((s) => s.status === 'failed');
  return {
    id: h.id,
    character_name: h.name,
    name: h.artist?.name ?? null,
    age: h.artist?.age ?? null,
    status: V1_STATUS[h.status] ?? 'pending',
    user_id: h.owner_id,
    username: h.owner?.username ?? null,
    owner_name: h.owner?.name ?? null,
    created_at: h.created_at,
    updated_at: h.updated_at,
    completed_at: h.completed_at,
    steps,
    error_message: failed?.error_message ?? null,
    style: h.style,
    featured: h.featured,
    in_class: h.in_class,
    file_versions: h.file_versions,
    painting: h.painting ?? null,
  };
}

/** The stage a pipeline step is, on /api/v1. */
const STAGE_OF: Record<string, string> = {
  image_processing: 'cleanup', openai_render: 'painting', meshy_3d: 'model', meshy_rig: 'rig', convert_vrm: 'avatar',
};

const V1 = `${API_BASE_URL}/api/v1`;
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const api = {
  /**
   * Create a new creation and upload the image file.
   * Pipeline must be started separately using runPipeline().
   */
  async createCreation(file: File, characterName?: string): Promise<CreationResponse> {
    // Uploaded only: "Make this hero?" starts it (runPipeline) with its style.
    const formData = new FormData();
    const upload = await shrinkPhoto(file);
    formData.append('drawing', upload, upload.name);
    formData.append('start', 'false');
    if (characterName) formData.append('name', characterName);
    return fromV1(await fetchJson<V1Hero>(`${V1}/heroes`, { method: 'POST', body: formData }));
  },

  /**
   * Run a single step
   */
  async runStep(creationId: string, stepName: string): Promise<{ message: string; creation_id: string; step_name: string }> {
    await fetchJson<V1Hero>(`${V1}/heroes/${creationId}/stages/${STAGE_OF[stepName] ?? stepName}/run`, { method: 'POST' });
    return { message: 'Step started', creation_id: creationId, step_name: stepName };
  },

  /**
   * Run full pipeline (all steps sequentially)
   * @param creationId The creation to process
   * @param fromStep Optional step name to start from (for retry scenarios)
   * @param style Optional painting style, stored on the hero. Leave it out to
   *   keep the hero's own (Make it again, Try again).
   */
  async runPipeline(creationId: string, fromStep?: string, style?: string): Promise<{ message: string; creation_id: string; from_step: string }> {
    await fetchJson<V1Hero>(`${V1}/heroes/${creationId}/start`, json('POST', {
      ...(fromStep ? { from_stage: STAGE_OF[fromStep] ?? fromStep } : {}),
      ...(style ? { style } : {}),
    }));
    return { message: 'Pipeline started', creation_id: creationId, from_step: fromStep ?? 'image_processing' };
  },

  /**
   * Cancel a processing step
   */
  async cancelStep(creationId: string, stepName: string): Promise<{ message: string; creation_id: string; step_name: string }> {
    await fetchJson<V1Hero>(`${V1}/heroes/${creationId}/cancel`, { method: 'POST' });
    return { message: `Step ${stepName} cancelled`, creation_id: creationId, step_name: stepName };
  },

  /**
   * Get creation status with all steps
   */
  async getCreation(creationId: string): Promise<CreationResponse> {
    return fromV1(await fetchJson<V1Hero>(`${V1}/heroes/${encodeURIComponent(creationId)}`));
  },

  /**
   * List all creations
   */
  async listCreations(_limit: number = 50, _offset: number = 0, mineOnly: boolean = false, featuredOnly: boolean = false): Promise<{ creations: CreationResponse[]; total: number }> {
    const view = mineOnly ? 'mine' : featuredOnly ? 'featured' : 'all';
    const result = await fetchJson<{ data: V1Hero[] }>(`${V1}/gallery?view=${view}`);
    const creations = result.data.map(fromV1);
    return { creations, total: creations.length };
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
    // Derived files (thumb_x, cut_x) carry the version of the file they are made from.
    const derived = /^(thumb|cut)_/.exec(filename);
    if (!derived) return url;
    const version = creation.file_versions?.[filename.slice(derived[0].length)];
    return version ? `${url}?v=${encodeURIComponent(version)}` : url;
  },

  /**
   * Update creation character name
   */
  /** Rename a hero and say who drew it, in one save. */
  async updateHero(creationId: string, fields: { character_name?: string; name?: string; age?: number | null }): Promise<CreationResponse> {
    const body: Record<string, unknown> = {};
    if (fields.character_name !== undefined) body.name = fields.character_name;
    if (fields.name !== undefined) body.artist_name = fields.name.trim();
    if (fields.age !== undefined) body.artist_age = fields.age;
    return fromV1(await fetchJson<V1Hero>(`${V1}/heroes/${creationId}`, json('PATCH', body)));
  },

  async updateCharacterName(creationId: string, characterName: string): Promise<CreationResponse> {
    return api.updateHero(creationId, { character_name: characterName });
  },

  async updateNameAndAge(creationId: string, name: string, age: number | null): Promise<CreationResponse> {
    return api.updateHero(creationId, { name, age });
  },

  async updateName(creationId: string, name: string): Promise<CreationResponse> {
    return api.updateHero(creationId, { name });
  },

  async updateAge(creationId: string, age: number | null): Promise<CreationResponse> {
    return api.updateHero(creationId, { age });
  },

  /**
   * Star or unstar a hero for Editors' choice (admins only).
   */
  async setFeatured(creationId: string, featured: boolean): Promise<CreationResponse> {
    return fromV1(await fetchJson<V1Hero>(`${V1}/heroes/${creationId}/featured`, json('PUT', { featured })));
  },

  /**
   * Delete a creation
   */
  /** `keepalive`: the request outlives the page (sent as the tab closes). */
  async deleteCreation(creationId: string, { keepalive = false } = {}): Promise<void> {
    await fetchJson<void>(`${V1}/heroes/${creationId}`, { method: 'DELETE', keepalive });
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

  /** The signed-in user's API keys (never the keys themselves). */
  async listApiKeys(): Promise<{ data: ApiKeyInfo[] }> {
    return fetchJson<{ data: ApiKeyInfo[] }>(`${API_BASE_URL}/api/v1/keys`);
  },

  /** A new key: the answer is the only time `key` and `webhook_secret` are shown. */
  async createApiKey(body: NewApiKey): Promise<ApiKeyInfo & { key: string; webhook_secret: string }> {
    return fetchJson(`${API_BASE_URL}/api/v1/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  async revokeApiKey(id: string): Promise<void> {
    await fetchJson(`${API_BASE_URL}/api/v1/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** How long a hero takes now, measured (no sign-in needed). */
  async getApiEstimates(): Promise<ApiEstimates> {
    return fetchJson<ApiEstimates>(`${API_BASE_URL}/api/v1/estimates`);
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
    return (await fetchJson<{ data: RenderStyle[] }>(`${V1}/styles`)).data;
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
    const est = await fetchJson<{ stages: Array<{ step: string; cost_credits: number }>; cost_credits: number }>(`${V1}/estimates`);
    if (!steps || steps.length === 0) return { cost: est.cost_credits };
    return { cost: est.stages.filter((s) => steps.includes(s.step)).reduce((n, s) => n + s.cost_credits, 0) };
  },

  /**
   * Get step configuration from backend
   */
  async getStepsConfig(): Promise<StepConfig[]> {
    const est = await fetchJson<{ stages: Array<{ step: string; title: string; cost_credits: number; file: string }> }>(`${V1}/estimates`);
    return est.stages.map((s) => ({ name: s.step, display_name: s.title, credit_cost: s.cost_credits, output_file: s.file }));
  },

  /**
   * Get individual step status (for polling during processing)
   */
  async getStepStatus(creationId: string, stepName: string): Promise<CreationStepResponse> {
    const hero = await api.getCreation(creationId);
    const step = hero.steps.find((s) => s.step_name === stepName);
    if (!step) throw new ApiError(404, `Step ${stepName} not found`);
    return step;
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

    /** One user's credit ledger, newest first: purchases, step charges, refunds, grants. */
    userLedger(userId: string, limit = 200): Promise<UserLedger> {
      return fetchJson<UserLedger>(`${API_BASE_URL}/api/admin/finance/ledger/${userId}?limit=${limit}`);
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

    lemonSqueezyCheck(refresh = false): Promise<LemonSqueezyCheck> {
      return fetchJson<LemonSqueezyCheck>(
        `${API_BASE_URL}/api/admin/money/lemonsqueezy${refresh ? '?refresh=true' : ''}`
      );
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
  /** Set where the balance is readable: true when it cannot pay for one more step of its kind. */
  out_of_credit?: boolean;
  /** What fails while it is out, e.g. "every 3D step fails". */
  out_of_credit_effect?: string | null;
  /** What one such step costs, in the provider's own credits. */
  step_credits?: number;
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

/** Lemon Squeezy's last 30 days of orders beside our payment rows. */
export interface LemonSqueezyCheck {
  status: 'ok' | 'not_configured' | 'error';
  mode: 'test' | 'live';
  hint: string | null;
  checked_at: string;
  cached?: boolean;
  // status "ok" only
  window_days?: number;
  since?: string;
  store?: {
    name: string | null;
    currency: string | null;
    total_sales: number;
    total_revenue_usd_micros: number;
    thirty_day_sales: number;
    thirty_day_revenue_usd_micros: number;
  };
  orders?: { count: number; gross_usd_micros: number; truncated: boolean; max_orders: number };
  ours?: { count: number; gross_usd_micros: number };
  missing?: { order_id: string; order_number: number | null; status: string; total_usd_micros: number; created_at: string | null }[];
  unknown_payments?: { order_id: string; order_number: number | null; gross_usd_micros: number; created_at: string | null }[];
  matches?: boolean;
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

/** A user's heroes, counted the same way on the users list and their page. */
export interface CreationStats {
  /** Every live hero; the rest split it. */
  total: number;
  completed: number;
  failed: number;
  /** A step running or done, not finished. */
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

/** One movement in a user's credit ledger (app/models.py CREDIT_REASONS). */
export interface LedgerTransaction {
  id: string;
  delta: number;
  reason: string;
  external_ref: string | null;
  creation_id: string | null;
  balance_after: number;
  metadata: Record<string, unknown>;
  created_at: string | null;
}

export interface UserLedger {
  user_id: string;
  transactions: LedgerTransaction[];
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
  counts: CreationStats & { heroes: number; removed: number };
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
