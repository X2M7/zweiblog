import { useRef } from 'react';

export interface UploadActivityTracker {
  start: () => () => void;
  getActiveCount: () => number;
}

interface UploadActivityCallbacks {
  setLoading: (loading: boolean) => void;
  onIdle?: () => void;
}

/**
 * Count uploads instead of toggling a shared boolean for every file.  The
 * release function is idempotent so duplicate terminal upload events cannot
 * make a later upload look idle.
 */
export function createUploadActivityTracker(
  getCallbacks: () => UploadActivityCallbacks,
): UploadActivityTracker {
  let activeCount = 0;

  return {
    start() {
      let released = false;
      activeCount += 1;
      if (activeCount === 1) getCallbacks().setLoading(true);

      return () => {
        if (released) return;
        released = true;
        activeCount = Math.max(0, activeCount - 1);
        if (activeCount !== 0) return;

        const callbacks = getCallbacks();
        callbacks.setLoading(false);
        callbacks.onIdle?.();
      };
    },
    getActiveCount() {
      return activeCount;
    },
  };
}

/** Share one tracker between UploadBtn instances that belong to one batch. */
export function useUploadActivityTracker(
  setLoading: (loading: boolean) => void,
  onIdle?: () => void,
) {
  const callbacksRef = useRef<UploadActivityCallbacks>({ setLoading, onIdle });
  callbacksRef.current = { setLoading, onIdle };

  const trackerRef = useRef<UploadActivityTracker | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = createUploadActivityTracker(() => callbacksRef.current);
  }
  return trackerRef.current;
}

export type UploadLifecycleStatus =
  | 'uploading'
  | 'done'
  | 'success'
  | 'error'
  | 'removed'
  | undefined;

export function getUploadKey(file: { uid?: string | number; name?: string }) {
  return String(file.uid ?? file.name ?? '');
}

/**
 * Convert Ant Upload's repeated progress events into exactly one start and one
 * release for each file.
 */
export function trackUploadLifecycle(
  activeUploads: Map<string, () => void>,
  tracker: UploadActivityTracker,
  file: { uid?: string | number; name?: string },
  status: UploadLifecycleStatus,
) {
  const key = getUploadKey(file);
  if (status === 'uploading') {
    if (activeUploads.has(key)) return undefined;
    activeUploads.set(key, tracker.start());
    return 'started' as const;
  }

  if (status === 'done' || status === 'success' || status === 'error' || status === 'removed') {
    const release = activeUploads.get(key);
    if (!release) return undefined;
    activeUploads.delete(key);
    release();
    return 'finished' as const;
  }

  return undefined;
}

export function shouldApplyUploadResult(
  latestUploadKey: string | undefined,
  file: { uid?: string | number; name?: string },
) {
  return latestUploadKey === undefined || latestUploadKey === getUploadKey(file);
}
