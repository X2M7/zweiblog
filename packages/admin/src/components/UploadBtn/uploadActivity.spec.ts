import { describe, expect, it, vi } from 'vitest';
import {
  createUploadActivityTracker,
  getUploadKey,
  shouldApplyUploadResult,
  trackUploadLifecycle,
} from './uploadActivity';

describe('upload activity tracking', () => {
  it('keeps a shared batch loading until every release and refreshes once', () => {
    const setLoading = vi.fn();
    const onIdle = vi.fn();
    const tracker = createUploadActivityTracker(() => ({ setLoading, onIdle }));

    const releaseFolderFile = tracker.start();
    const releaseSingleFile = tracker.start();
    expect(setLoading.mock.calls).toEqual([[true]]);
    expect(tracker.getActiveCount()).toBe(2);

    releaseFolderFile();
    expect(setLoading.mock.calls).toEqual([[true]]);
    expect(onIdle).not.toHaveBeenCalled();

    releaseSingleFile();
    releaseSingleFile();
    expect(setLoading.mock.calls).toEqual([[true], [false]]);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(tracker.getActiveCount()).toBe(0);
  });

  it('counts ordinary multiple-upload progress and terminal events once per file', () => {
    const setLoading = vi.fn();
    const onIdle = vi.fn();
    const tracker = createUploadActivityTracker(() => ({ setLoading, onIdle }));
    const activeUploads = new Map<string, () => void>();
    const first = { uid: 'first', name: 'first.png' };
    const second = { uid: 'second', name: 'second.png' };

    expect(trackUploadLifecycle(activeUploads, tracker, first, 'uploading')).toBe('started');
    expect(trackUploadLifecycle(activeUploads, tracker, first, 'uploading')).toBeUndefined();
    expect(trackUploadLifecycle(activeUploads, tracker, second, 'uploading')).toBe('started');
    trackUploadLifecycle(activeUploads, tracker, first, 'done');
    expect(setLoading.mock.calls).toEqual([[true]]);
    expect(onIdle).not.toHaveBeenCalled();

    trackUploadLifecycle(activeUploads, tracker, second, 'error');
    trackUploadLifecycle(activeUploads, tracker, second, 'error');
    expect(setLoading.mock.calls).toEqual([[true], [false]]);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('lets a shared image form ignore a stale response', () => {
    const oldFile = { uid: 'old', name: 'old.png' };
    const latestFile = { uid: 'latest', name: 'latest.png' };
    const latestKey = getUploadKey(latestFile);

    expect(shouldApplyUploadResult(latestKey, oldFile)).toBe(false);
    expect(shouldApplyUploadResult(latestKey, latestFile)).toBe(true);
  });
});
