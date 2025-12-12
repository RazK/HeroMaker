import { useCallback, useState } from 'react';
import type { Creation } from '../types/api';
import { createCreation } from '../api/client';

export type AppState = 'browse' | 'create' | 'show';

export interface UseCreationResult {
  creation: Creation | null;
  appState: AppState;
  isLoading: boolean;
  error: string | null;
  startCreation: () => Promise<void>;
  clearError: () => void;
}

export function useCreation(): UseCreationResult {
  const [creation, setCreation] = useState<Creation | null>(null);
  const [appState, setAppState] = useState<AppState>('browse');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCreation = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await createCreation();
      setCreation(result);
      setAppState('create');
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    creation,
    appState,
    isLoading,
    error,
    startCreation,
    clearError,
  };
}
