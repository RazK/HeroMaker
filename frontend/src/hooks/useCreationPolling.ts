import { useEffect, useRef, useCallback } from 'react';
import { api, CreationResponse } from '../api/client';

/**
 * Hook to fetch creation on demand (not continuous polling).
 * Returns a refresh function that fetches the latest creation.
 */
export function useCreationRefresh(
  creationId: string | null,
  onUpdate: (creation: CreationResponse) => void
) {
  const onUpdateRef = useRef(onUpdate);
  const creationIdRef = useRef(creationId);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    creationIdRef.current = creationId;
  }, [creationId]);

  const refresh = useCallback(async () => {
    const id = creationIdRef.current;
    if (!id) return;
    try {
      const creation = await api.getCreation(id);
      onUpdateRef.current(creation);
    } catch (error) {
      console.error(`[CreationRefresh] Error fetching creation:`, error);
    }
  }, []);

  // Listen for refresh events
  useEffect(() => {
    if (!creationId) return;

    const handleRefreshNow = (event: CustomEvent) => {
      const refreshCreationId = event.detail?.creationId;
      if (refreshCreationId === creationId) {
        refresh();
      }
    };

    window.addEventListener('creation:refresh-now', handleRefreshNow as EventListener);

    return () => {
      window.removeEventListener('creation:refresh-now', handleRefreshNow as EventListener);
    };
  }, [creationId, refresh]);

  return refresh;
}

/**
 * Poll creation continuously when there's a processing step.
 * Uses GET /api/creations/{id} which returns all steps.
 */
export function useCreationPolling(
  creationId: string | null,
  onUpdate: (creation: CreationResponse) => void
) {
  const intervalRef = useRef<number | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const prevStatusRef = useRef<string | null>(null);
  const pollCountRef = useRef(0);
  const creationIdRef = useRef<string | null>(null);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    creationIdRef.current = creationId;
  }, [creationId]);

  useEffect(() => {
    if (!creationId) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      prevStatusRef.current = null;
      pollCountRef.current = 0;
      return;
    }

    prevStatusRef.current = null;
    pollCountRef.current = 0;

    const poll = async () => {
      try {
        const currentCreationId = creationIdRef.current;
        if (!currentCreationId) return;

        pollCountRef.current++;
        const creation = await api.getCreation(currentCreationId);

        // Log when status changes
        if (creation.status !== prevStatusRef.current) {
          const processingStep = creation.steps.find(s => s.status === 'processing');
          console.log(`[Polling] ${currentCreationId}: status=${creation.status}, processing=${processingStep?.step_name || 'none'}`);
          prevStatusRef.current = creation.status;
        }

        onUpdateRef.current(creation);

        // Stop polling if completed or (failed with no processing steps)
        const hasProcessingStep = creation.steps.some(s => s.status === 'processing');
        if (creation.status === 'completed' || (creation.status === 'failed' && !hasProcessingStep)) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch (error) {
        console.error(`[Polling] Error:`, error);
      }
    };

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    poll();
    intervalRef.current = window.setInterval(poll, 2000);

    const handleRefreshNow = (event: CustomEvent) => {
      const refreshCreationId = event.detail?.creationId;
      if (refreshCreationId === creationId) {
        poll();
      }
    };

    window.addEventListener('creation:refresh-now', handleRefreshNow as EventListener);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      window.removeEventListener('creation:refresh-now', handleRefreshNow as EventListener);
    };
  }, [creationId]);
}
