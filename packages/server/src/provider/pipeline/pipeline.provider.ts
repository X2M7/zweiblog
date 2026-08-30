import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PipelineDocument } from 'src/scheme/pipeline.schema';
import { ZweiblogSystemEvent, ZweiblogSystemEventNames } from 'src/types/event';
import { CreatePipelineDto, UpdatePipelineDto } from 'src/types/pipeline.dto';
import { sleep } from 'src/utils/sleep';
import { fork, spawnSync } from 'child_process';
import { config } from 'src/config/index';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { LogProvider } from '../log/log.provider';
import {
  createMinimalPackageManagerEnvironment,
  createMinimalPipelineEnvironment,
  PIPELINE_MAX_CONCURRENCY,
  PIPELINE_MAX_LOG_ENTRIES,
  PIPELINE_MAX_LOG_LENGTH,
  runManagedPipelineChild,
  stringifyPipelineLogValue,
  validatePipelineDependencies,
  validatePipelineScript,
} from './pipeline.security';

export interface CodeResult {
  logs: string[];
  output: any;
  status: 'success' | 'error';
}

const DEFAULT_PIPELINE_SCRIPT = `
// Use the input variable to read or update event data.
// Keep asynchronous work at the top level with await.
`;

@Injectable()
export class PipelineProvider {
  logger = new Logger(PipelineProvider.name);
  idLock = false;
  runnerPath = config.codeRunnerPath;
  private activeRuns = 0;
  constructor(
    @InjectModel('Pipeline')
    private pipelineModel: Model<PipelineDocument>,
    private readonly logProvider: LogProvider,
  ) {
    void this.init().catch((error) => {
      this.logger.error(`初始化流水线失败: ${error?.message || error}`);
    });
  }

  private isUnsafeExecutionAllowed() {
    return config.pipeline.allowUnsafeExecution === true;
  }

  private assertUnsafeExecutionAllowed() {
    if (!this.isUnsafeExecutionAllowed()) {
      throw new ForbiddenException(
        '流水线执行默认关闭；仅可通过 pipeline.allowUnsafeExecution 显式启用不受信任代码执行',
      );
    }
  }

  private parseScript(script: unknown) {
    try {
      return validatePipelineScript(script);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private parseDependencies(deps: unknown) {
    try {
      return validatePipelineDependencies(deps);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private assertValidId(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new BadRequestException('Invalid pipeline id');
    }
  }

  checkEvent(eventName: string) {
    if (ZweiblogSystemEventNames.includes(eventName)) {
      return true;
    }
    return false;
  }

  async checkAllDeps() {
    if (!this.isUnsafeExecutionAllowed()) return;
    this.logger.log('初始化流水线代码库，这可能需要一段时间');
    const pipelines = await this.getAll();
    const deps = [];
    for (const pipeline of pipelines) {
      for (const dep of pipeline.deps || []) {
        if (!deps.includes(dep)) {
          deps.push(dep);
        }
      }
    }
    await this.addDeps(deps);
  }

  async saveAllScripts() {
    if (!this.isUnsafeExecutionAllowed()) return;
    const pipelines = await this.getAll();
    for (const pipeline of pipelines) {
      try {
        await this.saveOrUpdateScriptToRunnerPath(pipeline.id, pipeline.script);
      } catch (error) {
        await this.deleteScriptById(pipeline.id);
        this.logger.error(`流水线 ${pipeline.id} 脚本无效，未写入执行目录: ${(error as Error).message}`);
      }
    }
  }

  async init() {
    if (!this.isUnsafeExecutionAllowed()) {
      this.logger.warn('流水线执行已安全关闭（pipeline.allowUnsafeExecution=false）');
      return;
    }
    mkdirSync(this.runnerPath, { recursive: true, mode: 0o700 });
    // 先检查依赖；任一依赖不符合约束时，不生成可执行脚本。
    await this.checkAllDeps();
    await this.saveAllScripts();
  }

  async getNewId() {
    while (this.idLock) {
      await sleep(10);
    }
    this.idLock = true;
    const maxObj = await this.pipelineModel.find({}).sort({ id: -1 }).limit(1);
    let res = 1;
    if (maxObj.length) {
      res = maxObj[0].id + 1;
    }
    this.idLock = false;
    return res;
  }

  async createPipeline(pipeline: CreatePipelineDto) {
    if (!this.checkEvent(pipeline.eventName)) {
      throw new NotFoundException('Event not found in ZweiblogEventNames');
    }
    const id = await this.getNewId();
    // The create dialog historically omits the editor and relies on a starter
    // script. Never persist a blank executable file, while keeping that flow.
    const requestedScript =
      typeof pipeline.script === 'string' && pipeline.script.trim()
        ? pipeline.script
        : DEFAULT_PIPELINE_SCRIPT;
    const script = this.parseScript(requestedScript);
    const deps = this.parseDependencies(pipeline.deps);
    const newPipeline = await this.pipelineModel.create({
      id,
      name: pipeline.name,
      description: pipeline.description,
      enabled: pipeline.enabled === true,
      eventName: pipeline.eventName,
      script,
      deps,
    });
    await newPipeline.save();
    if (this.isUnsafeExecutionAllowed()) {
      await this.addDeps(deps);
      await this.saveOrUpdateScriptToRunnerPath(id, script);
    }
    return newPipeline;
  }

  async updatePipelineById(id: number, updateDto: UpdatePipelineDto) {
    this.assertValidId(id);
    const update: UpdatePipelineDto = {};
    if (updateDto.name !== undefined) update.name = updateDto.name;
    if (updateDto.description !== undefined) update.description = updateDto.description;
    if (updateDto.enabled !== undefined) update.enabled = updateDto.enabled === true;
    if (updateDto.eventName !== undefined) {
      if (!this.checkEvent(updateDto.eventName)) {
        throw new NotFoundException('Event not found in ZweiblogEventNames');
      }
      update.eventName = updateDto.eventName;
    }
    const script =
      updateDto.script !== undefined ? this.parseScript(updateDto.script) : undefined;
    const deps = updateDto.deps !== undefined ? this.parseDependencies(updateDto.deps) : undefined;
    if (script !== undefined) update.script = script;
    if (deps !== undefined) update.deps = deps;

    await this.pipelineModel.updateOne({ id, deleted: false }, update);
    if (this.isUnsafeExecutionAllowed()) {
      if (deps !== undefined) await this.addDeps(deps);
      if (script !== undefined) await this.saveOrUpdateScriptToRunnerPath(id, script);
    }
    return this.getPipelineById(id);
  }

  async deletePipelineById(id: number) {
    this.assertValidId(id);
    await this.pipelineModel.updateOne(
      { id: id },
      {
        deleted: true,
      },
    );
    await this.deleteScriptById(id);
  }
  async getAll() {
    return await this.pipelineModel.find({
      deleted: false,
    });
  }

  async getPipelineById(id: number) {
    this.assertValidId(id);
    return await this.pipelineModel.findOne({ id, deleted: false });
  }

  async getPipelinesByEvent(eventName: string) {
    return await this.pipelineModel.find({
      eventName,
      deleted: false,
    });
  }

  async triggerById(id: number, data: any) {
    this.assertUnsafeExecutionAllowed();
    const result = await this.runCodeByPipelineId(id, data);
    return result;
  }

  async dispatchEvent(eventName: ZweiblogSystemEvent, data?: any) {
    // Normal application events must remain unaffected when unsafe execution
    // is disabled. In particular, do not read or materialize stored scripts.
    if (!this.isUnsafeExecutionAllowed()) return [];
    const pipelines = await this.getPipelinesByEvent(eventName);
    const results: CodeResult[] = [];
    for (const pipeline of pipelines) {
      if (pipeline.enabled) {
        try {
          const result = await this.runCodeByPipelineId(pipeline.id, data);
          results.push(result);
        } catch (e) {
          this.logger.error(e);
        }
      }
    }
    return results;
  }

  getPathById(id: number) {
    this.assertValidId(id);
    return `${this.runnerPath}/${id}.js`;
  }

  async runCodeByPipelineId(id: number, data: any): Promise<CodeResult> {
    this.assertUnsafeExecutionAllowed();
    this.assertValidId(id);
    if (this.activeRuns >= PIPELINE_MAX_CONCURRENCY) {
      throw new ServiceUnavailableException(
        `流水线并发数已达到上限 ${PIPELINE_MAX_CONCURRENCY}，请稍后再试`,
      );
    }
    this.activeRuns += 1;
    const traceId = new Date().getTime();
    let pipeline: PipelineDocument;
    try {
      pipeline = await this.getPipelineById(id);
      if (!pipeline) {
        throw new NotFoundException('Pipeline not found');
      }
      this.logger.log(`[${traceId}]开始运行流水线: ${id} ${stringifyPipelineLogValue(data)}`);
      const subProcess = fork(this.getPathById(id), [], {
        cwd: this.runnerPath,
        env: createMinimalPipelineEnvironment(),
        execArgv: [],
        detached: false,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const result = (await runManagedPipelineChild(subProcess, data)) as CodeResult;
      this.logger.log(`[${traceId}]运行流水线成功: ${id} ${stringifyPipelineLogValue(result)}`);
      void this.logProvider.runPipeline(pipeline, data, result);
      return result;
    } catch (err) {
      this.logger.error(
        `[${traceId}]运行流水线失败: ${id} ${(err as Error)?.message || 'unknown error'}`,
      );
      if (pipeline) void this.logProvider.runPipeline(pipeline, data, undefined, err as Error);
      throw err;
    } finally {
      this.activeRuns = Math.max(0, this.activeRuns - 1);
    }
  }

  async addDeps(deps: string[]) {
    if (!this.isUnsafeExecutionAllowed()) return;
    const safeDependencies = this.parseDependencies(deps);
    const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    for (const dep of safeDependencies) {
      const result = spawnSync(
        executable,
        ['add', '--ignore-scripts', '--save-exact', dep],
        {
          cwd: this.runnerPath,
          shell: false,
          env: createMinimalPackageManagerEnvironment(),
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          timeout: 60_000,
          windowsHide: true,
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const details = (result.stderr || '').slice(0, 2_000);
        throw new Error(
          `安装流水线依赖 ${dep} 失败（exit=${result.status ?? 'unknown'}）${
            details ? `: ${details}` : ''
          }`,
        );
      }
    }
  }

  async deleteScriptById(id: number) {
    const filePath = this.getPathById(id);
    try {
      rmSync(filePath, { force: true });
    } catch (err) {
      this.logger.error(err);
    }
  }

  async saveOrUpdateScriptToRunnerPath(id: number, script: string) {
    this.assertUnsafeExecutionAllowed();
    const safeScript = this.parseScript(script);
    const filePath = this.getPathById(id);
    const scriptToSave = `
      let input = {};
      let logs = [];
      console.log = (...args) => {
        if (logs.length >= ${PIPELINE_MAX_LOG_ENTRIES}) return;
        const logArr = args.map((each) => {
          try {
            const serialized = typeof each === 'string' ? each : JSON.stringify(each);
            return String(serialized).slice(0, ${PIPELINE_MAX_LOG_LENGTH});
          } catch(err) {
            return '[Unserializable log entry]';
          }
        });
        logs.push(logArr.join(" ").slice(0, ${PIPELINE_MAX_LOG_LENGTH}));
      };
      process.on('message',async (msg) => {
        input = msg;
        try {
          ${safeScript}
          process.send({
            status: 'success',
            output: input,
            logs,
          });
        } catch(err) {
          process.send({
            status: 'error',
            output: err instanceof Error ? { name: err.name, message: err.message } : err,
            logs,
          });
        }
      });
    `;
    writeFileSync(filePath, scriptToSave, { encoding: 'utf-8', mode: 0o600 });
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Windows does not implement POSIX file modes.
    }
  }
}
