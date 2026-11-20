/**
 * 面板操作实现
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  INSTRUCTIONS_MAX,
  MAX_MODELS,
  MAX_PARALLEL,
  ServiceError,
  cleanPatch,
  defaultsOf,
  entryKey,
  overrideFrom,
  routeOf,
} from './store.js';

export function createService({ ctx, config, store }) {
  const entry = ctx.fiber.entry;

  // 读生效配置
  const state = (sessionId) => ({
    defaults: defaultsOf(config.defaults),
    override: store.overrideFor(sessionId) ?? null,
    effective: store.effectiveFor(sessionId, config.defaults),
    lastRun: store.lastRunOf(sessionId) ?? null,
    limits: { maxModels: MAX_MODELS, instructionsMax: INSTRUCTIONS_MAX, maxParallel: MAX_PARALLEL },
  });

  // 预检新增或改过推理强度的模型
  const preflight = async (models, previous) => {
    const known = new Set(previous.map(entryKey));
    await Promise.all(
      models.filter((model) => !known.has(entryKey(model))).map((model) =>
        ctx.llm
          .resolveCallConfig({
            provider: model.provider,
            model: model.model,
            ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
          })
          .catch((error) => {
            throw new ServiceError('invalid', `model route unavailable (${routeOf(model)}): ${error?.message ?? error}`);
          }),
      ),
    );
  };

  // 启停时通知主模型
  const notify = (sessionId, before, after) => {
    if (before.enabled === after.enabled) return;
    const agent = ctx.get('agents')?.get(sessionId);
    if (!agent) return;
    const text = after.enabled
      ? '[query-scout] 本会话已启用检索助手：范围大或量大的检索，不论是网页搜索、读代码还是读文档，用 query_scout 交给它，只取回结论和出处。'
      : '[query-scout] 本会话已停用检索助手：不要再调用 query_scout，检索由你自己完成。';
    try {
      agent.inject(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin:dsh-query-scout', form: 'notice' },
        }),
      );
    } catch (error) {
      ctx.logger.warn(`[queryScout:notify] 注入失败：${error?.message ?? error}`);
    }
  };

  const update = async (sessionId, rawPatch) => {
    const patch = cleanPatch(rawPatch);
    const before = store.effectiveFor(sessionId, config.defaults);
    await preflight(patch.models, before.models);
    // 只存与默认值不同的字段
    const override = overrideFrom(patch, defaultsOf(config.defaults));
    if (Object.keys(override).length === 0) await store.reset(sessionId);
    else await store.update(sessionId, override);
    const after = store.effectiveFor(sessionId, config.defaults);
    notify(sessionId, before, after);
    return state(sessionId);
  };

  const reset = async (sessionId) => {
    const before = store.effectiveFor(sessionId, config.defaults);
    await store.reset(sessionId);
    const after = store.effectiveFor(sessionId, config.defaults);
    notify(sessionId, before, after);
    return state(sessionId);
  };

  // 把面板内容写成全局默认值，发起的会话随即改为跟随默认值
  const saveDefaults = async (sessionId, rawPatch) => {
    const patch = cleanPatch(rawPatch);
    const base = sessionId === undefined ? defaultsOf(config.defaults) : store.effectiveFor(sessionId, config.defaults);
    await preflight(patch.models, base.models);
    const editor = ctx.get('configEditor');
    if (entry === undefined || editor === undefined) {
      throw new ServiceError('unavailable', 'Configuration cannot be saved in this profile');
    }
    // 写配置会让插件按新默认值重载。先清掉本会话的单独设置再写，重载后看到的就是跟随默认值的状态；
    // 写失败再放回去
    const previous = sessionId === undefined ? undefined : store.overrideFor(sessionId);
    if (previous !== undefined) await store.reset(sessionId);
    try {
      await editor.edit(entry, (current) => {
        // 去掉旧版单模型字段。不留值为 undefined 的键：配置编辑器按深比较校验写回的结果
        const { provider, model, reasoningEffort, instructions, ...rest } = current.defaults ?? {};
        return {
          ...current,
          defaults: {
            ...rest,
            enabled: patch.enabled,
            models: structuredClone(patch.models),
            ...(patch.instructions ? { instructions: patch.instructions } : {}),
            ...(patch.maxParallel === undefined ? {} : { maxParallel: patch.maxParallel }),
          },
        };
      });
    } catch (error) {
      if (previous !== undefined) await store.update(sessionId, previous);
      throw error;
    }
    // 此时插件已按新配置重载，本闭包里的 config 是旧值，由面板重新读取状态
    return { saved: true };
  };

  return { ready: store.ready, ServiceError, state, update, reset, saveDefaults };
}
