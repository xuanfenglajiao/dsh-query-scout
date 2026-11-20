/**
 * 会话配置存储
 *
 * 一份配置是 { enabled, models, instructions, maxParallel }，models 为按顺序尝试的模型列表，
 * maxParallel 为一个会话同时运行的检索数上限。
 * 会话只存与默认值不同的字段。
 * 0.3 及更早的单模型字段（provider / model / reasoningEffort）在读取时转成列表的第一项。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const INSTRUCTIONS_MAX = 4000;
// 模型列表上限：每多一个失败的模型，主模型就多等一轮
export const MAX_MODELS = 3;
// 同时检索上限的可选范围，与 DSH 默认的子代理容量一致
export const MAX_PARALLEL = 8;
export const DEFAULT_PARALLEL = 2;

// 面板可提交的字段
const FIELDS = ['enabled', 'models', 'instructions', 'maxParallel'];

// 同时检索上限是否合法
function validParallel(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_PARALLEL;
}

export class ServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
  }
}

// 模型的唯一键；模型 ID 自身含斜杠，不能直接拼接
export function routeKey(model) {
  return JSON.stringify([model.provider, model.model]);
}

// 模型的显示路由
export function routeOf(model) {
  return `${model.provider}/${model.model}`;
}

// 读一层配置里的模型列表，丢弃无效项与重复项；列表为空时回退到旧版单模型字段
export function modelsOf(layer) {
  if (layer === null || typeof layer !== 'object') return [];
  const listed = Array.isArray(layer.models) ? layer.models : [];
  const raw =
    listed.length > 0
      ? listed
      : layer.provider && layer.model
        ? [{ provider: layer.provider, model: layer.model, reasoningEffort: layer.reasoningEffort }]
        : [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    if (typeof item.provider !== 'string' || item.provider === '') continue;
    if (typeof item.model !== 'string' || item.model === '') continue;
    const key = routeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      typeof item.reasoningEffort === 'string' && item.reasoningEffort !== ''
        ? { provider: item.provider, model: item.model, reasoningEffort: item.reasoningEffort }
        : { provider: item.provider, model: item.model },
    );
    if (out.length === MAX_MODELS) break;
  }
  return out;
}

// 全局默认值的规范形式
export function defaultsOf(defaults) {
  const { provider, model, reasoningEffort, ...rest } = defaults ?? {};
  return {
    ...rest,
    enabled: rest.enabled === true,
    models: modelsOf(defaults),
    instructions: typeof rest.instructions === 'string' ? rest.instructions : '',
    maxParallel: validParallel(rest.maxParallel) ? rest.maxParallel : DEFAULT_PARALLEL,
  };
}

// 会话覆盖的规范形式：只保留该会话确实指定过的字段
function overrideOf(raw) {
  if (raw === null || typeof raw !== 'object') return undefined;
  const out = {};
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (Array.isArray(raw.models) || (raw.provider && raw.model)) out.models = modelsOf(raw);
  if (typeof raw.instructions === 'string') out.instructions = raw.instructions;
  if (validParallel(raw.maxParallel)) out.maxParallel = raw.maxParallel;
  return out;
}

// 模型与推理强度的唯一键
export function entryKey(model) {
  return JSON.stringify([model.provider, model.model, model.reasoningEffort ?? '']);
}

// 两份模型列表是否相同
function sameModels(left, right) {
  return left.length === right.length && left.every((model, index) => entryKey(model) === entryKey(right[index]));
}

// 与默认值不同的字段
export function overrideFrom(settings, defaults) {
  const out = {};
  if (settings.enabled !== defaults.enabled) out.enabled = settings.enabled;
  if (!sameModels(settings.models, defaults.models)) out.models = settings.models;
  if (settings.instructions !== defaults.instructions) out.instructions = settings.instructions;
  if (settings.maxParallel !== undefined && settings.maxParallel !== defaults.maxParallel) out.maxParallel = settings.maxParallel;
  return out;
}

// 校验面板提交的完整配置
export function cleanPatch(patch) {
  if (patch === null || typeof patch !== 'object') throw new ServiceError('invalid', 'patch must be an object');
  for (const key of Object.keys(patch)) {
    if (!FIELDS.includes(key)) throw new ServiceError('invalid', `unknown field "${key}"`);
  }
  if (typeof patch.enabled !== 'boolean') throw new ServiceError('invalid', 'enabled must be a boolean');
  if (!Array.isArray(patch.models)) throw new ServiceError('invalid', 'models must be an array');
  if (patch.models.length > MAX_MODELS) throw new ServiceError('invalid', `at most ${MAX_MODELS} models can be listed`);

  const seen = new Set();
  const models = patch.models.map((item, index) => {
    if (item === null || typeof item !== 'object') throw new ServiceError('invalid', `models[${index}] must be an object`);
    const { provider, model, reasoningEffort } = item;
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
      throw new ServiceError('invalid', `models[${index}] needs a provider and a model`);
    }
    const hasEffort = reasoningEffort !== undefined && reasoningEffort !== null && reasoningEffort !== '';
    if (hasEffort && typeof reasoningEffort !== 'string') {
      throw new ServiceError('invalid', `models[${index}].reasoningEffort must be a string`);
    }
    const key = routeKey(item);
    if (seen.has(key)) throw new ServiceError('invalid', `${routeOf(item)} is listed twice`);
    seen.add(key);
    return hasEffort ? { provider, model, reasoningEffort } : { provider, model };
  });

  const instructions = patch.instructions ?? '';
  if (typeof instructions !== 'string') throw new ServiceError('invalid', 'instructions must be a string');
  if (instructions.length > INSTRUCTIONS_MAX) {
    throw new ServiceError('invalid', `instructions is over ${INSTRUCTIONS_MAX} characters`);
  }
  if (patch.enabled && models.length === 0) throw new ServiceError('invalid', 'add a model before enabling');
  if (patch.maxParallel !== undefined && !validParallel(patch.maxParallel)) {
    throw new ServiceError('invalid', `maxParallel must be an integer from 1 to ${MAX_PARALLEL}`);
  }
  return {
    enabled: patch.enabled,
    models,
    instructions,
    ...(patch.maxParallel === undefined ? {} : { maxParallel: patch.maxParallel }),
  };
}

// 同一个文件在进程内只有一份存储。「设为默认」会让插件重载，重载前后的实例共用这一份，
// 会话设置不会对不上，最近一次检索的记录也不随重载丢失
const stores = new Map();

export function createStore({ file }) {
  const existing = stores.get(file);
  if (existing !== undefined) return existing;
  const store = openStore(file);
  stores.set(file, store);
  // 读取失败的实例不留用，下次加载重新读
  store.ready.catch(() => stores.delete(file));
  return store;
}

function openStore(file) {
  let data = { version: 2, sessions: {} };
  const lastRuns = new Map();

  const ready = (async () => {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') {
        const sessions = {};
        for (const [sessionId, raw] of Object.entries(parsed.sessions)) {
          const override = overrideOf(raw);
          if (override !== undefined) sessions[sessionId] = override;
        }
        data = { version: 2, sessions };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  })();

  // 写文件排队执行：改了就生效之后，连续两次保存可能同时到达，共用的临时文件不能并发写
  let writing = Promise.resolve();
  const write = async () => {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, file);
  };
  const save = () => {
    const done = writing.then(write);
    writing = done.catch(() => {});
    return done;
  };

  const overrideFor = (sessionId) => data.sessions[sessionId];

  // 会话覆盖叠加全局默认
  const effectiveFor = (sessionId, defaults) => ({ ...defaultsOf(defaults), ...(data.sessions[sessionId] ?? {}) });

  const update = async (sessionId, patch) => {
    data.sessions[sessionId] = patch;
    await save();
    return patch;
  };

  const reset = async (sessionId) => {
    if (!Object.hasOwn(data.sessions, sessionId)) return;
    delete data.sessions[sessionId];
    await save();
  };

  const recordRun = (sessionId, summary) => {
    lastRuns.set(sessionId, { ...summary, at: Date.now() });
  };
  const lastRunOf = (sessionId) => lastRuns.get(sessionId);

  return { ready, overrideFor, effectiveFor, update, reset, recordRun, lastRunOf };
}
