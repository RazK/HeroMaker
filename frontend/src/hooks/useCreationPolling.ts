import { useEffect, useRef } from 'react';
import { api, CreationResponse } from '../api/client';

export function useCreationPolling(
  creationId: string | null,
  onUpdate: (creation: CreationResponse) => void
) {
  const intervalRef = useRef<number | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const prevStatusRef = useRef<string | null>(null);
  const pollCountRef = useRef(0);

  // Keep callback ref up to date
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!creationId) {
      console.log('[Polling] No creationId, clearing interval');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      prevStatusRef.current = null;
      pollCountRef.current = 0;
      return;
    }

    console.log(`[Polling] Starting polling for creation ${creationId}`);
    prevStatusRef.current = null;
    pollCountRef.current = 0;

    const poll = async () => {
      try {
        pollCountRef.current++;
        // Log every 5th poll to reduce spam
        if (pollCountRef.current % 5 === 0) {
          console.log(`[Polling] Polling creation ${creationId} (poll #${pollCountRef.current})`);
        }
        const creation = await api.getCreation(creationId);
        
        // Log when status changes or every 10th poll
        if (creation.status !== prevStatusRef.current || pollCountRef.current % 10 === 0) {
          console.log(`[Polling] Received update for ${creationId}:`, {
            status: creation.status,
            currentStep: creation.current_step,
            completedSteps: creation.steps.filter(s => s.status === 'completed').length,
            totalSteps: creation.steps.length,
          });
          prevStatusRef.current = creation.status;
        }
        
        onUpdateRef.current(creation);

        // Stop polling if completed or failed
        if (creation.status === 'completed' || creation.status === 'failed') {
          console.log(`[Polling] Stopping polling for ${creationId}: status = ${creation.status}`);
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch (error) {
        console.error(`[Polling] Error polling ${creationId}:`, error);
      }
    };

    // Clear any existing interval
    if (intervalRef.current) {
      console.log(`[Polling] Clearing existing interval for ${creationId}`);
      clearInterval(intervalRef.current);
    }

    // Poll immediately
    poll();

    // Then poll every 2 seconds
    intervalRef.current = window.setInterval(poll, 2000);
    console.log(`[Polling] Set up polling interval for ${creationId} (every 2s)`);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [creationId]);
}
