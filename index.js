/**
 * dsh-query-scout Host 入口
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createRunner } from './lib/run.js';
import { GUIDANCE, TOOL_NAME, createTool } from './lib/tool.js';
import { DEFAULT_PARALLEL, MAX_PARALLEL, createStore } from './lib/store.js';
import { createService } from './lib/service.js';
import { API_PATH, createApiHandler } from './lib/routes.js';

export const name = 'query-scout';
export const inject = ['tools', 'subagents', 'llm', 'systemPrompt', 'webServer', 'connection'];

export const Config = z.object({
  subagentProvider: z.string().default('spawn').description('子代理提供方'),
  agentPreset: z.string().default('query-scout').description('子代理预设 ID'),
  globalToolAllow: z.array(z.string()).default([]).description('子代理保留的全局工具'),
  defaults: z.object({
    enabled: z.boolean().default(false).description('是否启用'),
    models: z
      .array(
        z.object({
          provider: z.string().required().description('模型提供方'),
          model: z.string().required().description('模型 ID'),
          reasoningEffort: z.string().description('推理强度'),
        }),
      )
      .default([])
      .description('按顺序尝试的模型，前一个失败时换下一个；最多 3 个，多出的忽略'),
    // 0.3 及更早的单模型字段：models 为空时读作列表的第一项
    provider: z.string().hidden().description('旧版字段：模型提供方'),
    model: z.string().hidden().description('旧版字段：模型 ID'),
    reasoningEffort: z.string().hidden().description('旧版字段：推理强度'),
    instructions: z.string().description('附加提示词'),
    maxOutputChars: z.natural().default(8000).description('报告字数上限'),
    timeoutSec: z.natural().default(300).description('一次检索的总时限（秒），列表里的模型共用'),
    cooldownSec: z.natural().default(120).description('模型失败后的冷却秒数，冷却期内排到最后再试；0 为不冷却'),
    maxParallel: z
      .natural()
      .min(1)
      .max(MAX_PARALLEL)
      .default(DEFAULT_PARALLEL)
      .description(`一个会话同时运行的检索数上限，超出的排队等待；1 到 ${MAX_PARALLEL}`),
  }),
});

export function apply(ctx, config) {
  // 读 Agent 预设
  const presetOf = (agent) => {
    const presets = ctx.get('agentPresets');
    return presets?.composedPreset(agent.ctx) ?? presets?.presetForSession(agent.session);
  };

  // 收窄子代理全局工具
  const lifts = new Map();
  ctx.on('agent/created', ({ agent }) => {
    if (presetOf(agent) !== config.agentPreset) return;
    // 根上下文注册的可见工具
    const deny = ctx.tools
      .definitions(scopeOf(agent.ctx))
      .filter(
        (definition) =>
          definition.name !== 'run_code' &&
          ctx.tools.get(definition.name) === definition &&
          !config.globalToolAllow.includes(definition.name),
      )
      .map((definition) => definition.name);
    if (deny.length === 0) return;
    const dispose = agent.ctx.effect(() => {
      const lift = agent.ctx.tools.restrict({ deny });
      return () => {
        lift();
        lifts.delete(agent.id);
      };
    }, 'query-scout: restrict scout tools');
    lifts.set(agent.id, dispose);
  });
  ctx.effect(() => () => {
    for (const dispose of [...lifts.values()]) dispose();
  }, 'query-scout: restrictions');

  // 会话配置与面板服务
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const store = createStore({ file: join(dshHome, 'dsh-query-scout', 'sessions.json') });
  const service = createService({ ctx, config, store });

  const fence = (req) => ctx.connection.requestRejection(req) === undefined;
  const handler = createApiHandler({ service, fence, logger: ctx.logger });
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: API_PATH, handler }), 'query-scout: api route');

  // 注册检索工具
  const run = createRunner({ ctx, config, presetOf, store });
  const definition = createTool(defineTool, run);
  ctx.effect(() => ctx.tools.register(definition), 'query-scout: tool');

  // 委派指引：全局默认启用且工具可见时进入系统提示，文本固定
  ctx.systemPrompt.section({
    name: `tool:${TOOL_NAME}`,
    order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT'),
    interpolate: false,
    text: (context) => (config.defaults.enabled && ctx.tools.get(TOOL_NAME, context.scope) === definition ? GUIDANCE : ''),
  });
}
