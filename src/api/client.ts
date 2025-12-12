import type { Creation, ApiErrorShape } from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let details: ApiErrorShape | undefined;
    try {
      details = await response.json();
    } catch (error) {
      // ignore parse error and fallback below
    }
    const message =
      details?.error?.message ||
      details?.message ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function createCreation(): Promise<Creation> {
  const response = await fetch(`${API_BASE_URL}/api/creations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  return parseResponse<Creation>(response);
}
