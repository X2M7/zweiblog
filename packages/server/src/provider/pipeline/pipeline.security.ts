export const PIPELINE_TIMEOUT_MS = 10_000;
export const PIPELINE_MAX_CONCURRENCY = 2;
export const PIPELINE_MAX_SCRIPT_BYTES = 64 * 1024;
export const PIPELINE_MAX_DEPENDENCIES = 20;
export const PIPELINE_MAX_LOG_ENTRIES = 100;
export const PIPELINE_MAX_LOG_LENGTH = 2_000;
export const PIPELINE_MAX_RESULT_BYTES = 1024 * 1024;

const NPM_PACKAGE_PART = '[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?';
const NPM_PACKAGE_NAME = new RegExp(`^(?:@${NPM_PACKAGE_PART}/)?${NPM_PACKAGE_PART}$`);

export interface PipelineChildResult {
  logs: string[];
  output: any;
  status: 'success' | 'error';
}

export interface ManagedPipelineChildProcess {
  connected: boolean;
  killed: boolean;
  send(message: any, callback?: (error: Error | null) => void): boolean;
  once(event: string, listener: (...args: any[]) => void): any;
  removeListener(event: string, listener: (...args: any[]) => void): any;
  disconnect(): void;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export class PipelineReportedError extends Error {
  readonly result: PipelineChildResult;

  constructor(result: PipelineChildResult) {
    super('Pipeline script reported an error');
    this.name = 'PipelineReportedError';
    this.result = result;
  }
}

export function parseUnsafeExecutionFlag(value: unknown) {
  return value === true || value === 'true';
}

export function validatePipelineScript(script: unknown): string {
  if (typeof script !== 'string' || script.trim().length === 0) {
    throw new Error('Pipeline script must not be blank');
  }
  if (Buffer.byteLength(script, 'utf8') > PIPELINE_MAX_SCRIPT_BYTES) {
    throw new Error(`Pipeline script must not exceed ${PIPELINE_MAX_SCRIPT_BYTES} bytes`);
  }
  return script;
}

/**
 * Accept registry package names only. Versions, aliases, URLs, git sources,
 * local paths and command-line options are intentionally not supported.
 */
export function validatePipelineDependencies(deps: unknown): string[] {
  if (deps === undefined || deps === null) return [];
  if (!Array.isArray(deps)) {
    throw new Error('Pipeline dependencies must be an array');
  }
  if (deps.length > PIPELINE_MAX_DEPENDENCIES) {
    throw new Error(`Pipeline dependencies must not exceed ${PIPELINE_MAX_DEPENDENCIES} entries`);
  }

  const unique = new Set<string>();
  for (const value of deps) {
    if (
      typeof value !== 'string' ||
      value.length > 214 ||
      value.trim() !== value ||
      !NPM_PACKAGE_NAME.test(value)
    ) {
      throw new Error('Pipeline dependencies must be plain npm registry package names');
    }
    unique.add(value);
  }
  return Array.from(unique);
}

export function createMinimalPipelineEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: source.NODE_ENV || 'production',
  };
  for (const key of ['TZ', 'LANG', 'LC_ALL']) {
    if (source[key]) env[key] = source[key];
  }
  return env;
}

export function createMinimalPackageManagerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
) {
  const env: NodeJS.ProcessEnv = {
    npm_config_ignore_scripts: 'true',
  };
  for (const key of [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'ComSpec',
    'HOME',
    'USERPROFILE',
    'TMP',
    'TEMP',
    'PNPM_HOME',
  ]) {
    if (source[key]) env[key] = source[key];
  }
  return env;
}

export function sanitizePipelineLogs(logs: unknown): string[] {
  if (!Array.isArray(logs)) return [];
  return logs.slice(0, PIPELINE_MAX_LOG_ENTRIES).map((entry) => {
    let text: string;
    try {
      text = typeof entry === 'string' ? entry : JSON.stringify(entry);
    } catch {
      text = '[Unserializable log entry]';
    }
    if (typeof text !== 'string') text = String(entry);
    return text.slice(0, PIPELINE_MAX_LOG_LENGTH);
  });
}

function assertResultSize(output: any) {
  let serialized: string;
  try {
    const value = JSON.stringify(output);
    serialized = value === undefined ? 'null' : value;
  } catch {
    throw new Error('Pipeline output must be JSON serializable');
  }
  if (Buffer.byteLength(serialized, 'utf8') > PIPELINE_MAX_RESULT_BYTES) {
    throw new Error(`Pipeline output must not exceed ${PIPELINE_MAX_RESULT_BYTES} bytes`);
  }
}

export function normalizePipelineChildResult(message: unknown): PipelineChildResult {
  if (!message || typeof message !== 'object') {
    throw new Error('Pipeline child returned an invalid result');
  }
  const candidate = message as Partial<PipelineChildResult>;
  if (candidate.status !== 'success' && candidate.status !== 'error') {
    throw new Error('Pipeline child returned an invalid status');
  }
  assertResultSize(candidate.output);
  return {
    status: candidate.status,
    output: candidate.output,
    logs: sanitizePipelineLogs(candidate.logs),
  };
}

export function stringifyPipelineLogValue(value: unknown, maxLength = 4_096) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return '';
    return serialized.slice(0, maxLength);
  } catch {
    return '[Unserializable value]';
  }
}

export function runManagedPipelineChild(
  child: ManagedPipelineChildProcess,
  input: any,
  timeoutMs = PIPELINE_TIMEOUT_MS,
): Promise<PipelineChildResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const onMessage = (message: unknown) => {
      try {
        const result = normalizePipelineChildResult(message);
        if (result.status === 'error') {
          finish(new PipelineReportedError(result));
        } else {
          finish(undefined, result);
        }
      } catch (error) {
        finish(error as Error);
      }
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`Pipeline child exited before returning a result (${code ?? signal ?? 'unknown'})`));
    const onDisconnect = () => finish(new Error('Pipeline child disconnected before returning a result'));

    const detachListeners = () => {
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      child.removeListener('disconnect', onDisconnect);
    };

    const stopChild = () => {
      try {
        if (child.connected) child.disconnect();
      } catch {
        // The process may already have closed its IPC channel.
      }
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        // The process may already have exited.
      }
    };

    function finish(error?: Error, result?: PipelineChildResult) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      detachListeners();
      stopChild();
      if (error) reject(error);
      else resolve(result);
    }

    child.once('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
    child.once('disconnect', onDisconnect);

    timer = setTimeout(() => {
      finish(new Error(`Pipeline execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      child.send(input || {}, (error) => {
        if (error) finish(error);
      });
    } catch (error) {
      finish(error as Error);
    }
  });
}
