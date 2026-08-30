import { EventEmitter } from 'node:events';
import {
  ManagedPipelineChildProcess,
  parseUnsafeExecutionFlag,
  PIPELINE_MAX_LOG_ENTRIES,
  PIPELINE_MAX_LOG_LENGTH,
  runManagedPipelineChild,
  validatePipelineDependencies,
  validatePipelineScript,
} from './pipeline.security';

class FakePipelineChild extends EventEmitter implements ManagedPipelineChildProcess {
  connected = true;
  killed = false;
  sent: any;

  send(message: any, callback?: (error: Error | null) => void) {
    this.sent = message;
    if (callback) callback(null);
    return true;
  }

  disconnect() {
    this.connected = false;
  }

  kill() {
    this.killed = true;
    return true;
  }
}

describe('pipeline security helpers', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps unsafe execution disabled unless explicitly true', () => {
    expect(parseUnsafeExecutionFlag(undefined)).toBe(false);
    expect(parseUnsafeExecutionFlag(false)).toBe(false);
    expect(parseUnsafeExecutionFlag('false')).toBe(false);
    expect(parseUnsafeExecutionFlag('TRUE')).toBe(false);
    expect(parseUnsafeExecutionFlag(true)).toBe(true);
    expect(parseUnsafeExecutionFlag('true')).toBe(true);
  });

  it('rejects blank scripts and non-registry dependency specifications', () => {
    expect(() => validatePipelineScript('   ')).toThrow('must not be blank');
    expect(validatePipelineDependencies(['lodash', '@scope/package'])).toEqual([
      'lodash',
      '@scope/package',
    ]);
    for (const dependency of ['https://example.invalid/package.tgz', 'file:../package', 'git+ssh:repo']) {
      expect(() => validatePipelineDependencies([dependency])).toThrow('plain npm registry');
    }
  });

  it('times out and always disconnects and kills the child', async () => {
    jest.useFakeTimers();
    const child = new FakePipelineChild();
    const run = runManagedPipelineChild(child, { test: true }, 25);
    const rejection = expect(run).rejects.toThrow('timed out');

    jest.advanceTimersByTime(25);

    await rejection;
    expect(child.connected).toBe(false);
    expect(child.killed).toBe(true);
  });

  it('rejects an early exit and always cleans up the child', async () => {
    const child = new FakePipelineChild();
    const run = runManagedPipelineChild(child, {});
    const rejection = expect(run).rejects.toThrow('exited before returning');

    child.emit('exit', 1, null);

    await rejection;
    expect(child.connected).toBe(false);
    expect(child.killed).toBe(true);
  });

  it('bounds child log count and line length', async () => {
    const child = new FakePipelineChild();
    const run = runManagedPipelineChild(child, {});
    child.emit('message', {
      status: 'success',
      output: {},
      logs: Array.from({ length: PIPELINE_MAX_LOG_ENTRIES + 10 }, () =>
        'x'.repeat(PIPELINE_MAX_LOG_LENGTH + 10),
      ),
    });

    const result = await run;
    expect(result.logs).toHaveLength(PIPELINE_MAX_LOG_ENTRIES);
    expect(result.logs.every((entry) => entry.length === PIPELINE_MAX_LOG_LENGTH)).toBe(true);
    expect(child.connected).toBe(false);
    expect(child.killed).toBe(true);
  });
});
