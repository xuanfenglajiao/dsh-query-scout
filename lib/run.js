/**
 * 检索子代理执行
 *
 * 按配置顺序尝试模型：模型请求失败就换下一个，从头重跑这次检索；所有模型共用一个总时限。
 * 刚失败过的模型进入冷却，冷却期内排到最后，前面的模型都失败时才再试它。
 * 每个会话同时运行的检索不超过 maxParallel，超出的排队。
 */

import { routeKey, routeOf } from './store.js';

const LOG = '[queryScout:run]';

// 子代理显示名长度
const LABEL_MAX = 40;
// 失败详情长度
const ERROR_MAX = 400;
// 成功结果的标注里每条失败原因的长度
const NOTE_MAX = 160;
// 剩余时间少于此值时不再启动下一个模型：来不及完成一次检索，只会白付一次请求
const MIN_ATTEMPT_MS = 15_000;

// 不属于模型故障的结束原因。换模型不解决问题，这次检索到此为止
const STOPPED = {
  aborted: { code: 'ABORTED', message: 'the helper was stopped before it finished' },
  'max-tokens': { code: 'MAX_TOKENS', message: 'the helper reached its output-token limit' },
  refusal: { code: 'BLOCKED', message: 'the task was rejected before the helper ran it' },
};

export function createRunner({ ctx, config, presetOf, store }) {
  // 冷却中的模型：路由键 -> { until, code }。按模型记，所有会话共用
  const cooldowns = new Map();

  // 各会话的并行槽位：会话 ID -> { running, waiting }
  const lanes = new Map();

  // 按当前上限放行排队的检索；上限在面板上随时可改，每次放行都重读
  const drain = (sessionId) => {
    const lane = lanes.get(sessionId);
    if (lane === undefined) return;
    const limit = store.effectiveFor(sessionId, config.defaults).maxParallel;
    while (lane.waiting.length > 0 && lane.running < limit) {
      lane.running += 1;
      lane.waiting.shift().admit();
    }
    if (lane.running === 0 && lane.waiting.length === 0) lanes.delete(sessionId);
  };

  // 占一个并行槽位；已满时排队，用户中断时退出队列
  const acquire = (sessionId, signal) =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const lane = lanes.get(sessionId) ?? { running: 0, waiting: [] };
      lanes.set(sessionId, lane);
      const onAbort = () => {
        lane.waiting.splice(lane.waiting.indexOf(entry), 1);
        drain(sessionId);
        reject(signal.reason);
      };
      const entry = {
        admit: () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
      };
      signal.addEventListener('abort', onAbort, { once: true });
      lane.waiting.push(entry);
      drain(sessionId);
    });

  const release = (sessionId) => {
    lanes.get(sessionId).running -= 1;
    drain(sessionId);
  };

  // 读子会话最后一次轮次错误
  const failureOf = async (childId) => {
    const query = ctx.get('sessionQuery');
    if (query === undefined) return undefined;
    try {
      return await query.inspectSession(childId, (session) => {
        const events = session.ownEvents();
        for (let i = events.length - 1; i >= 0; i -= 1) {
          if (events[i].type !== 'turn/end') continue;
          const reason = events[i].data.reason;
          if (reason.kind !== 'error') return undefined;
          return { code: String(reason.error.code), message: clip(String(reason.error.message), ERROR_MAX) };
        }
        return undefined;
      });
    } catch (error) {
      ctx.logger.warn(`${LOG} 读取子会话失败原因出错：${error?.message ?? error}`);
      return undefined;
    }
  };

  /**
   * 用一个模型完整跑一次检索。
   * 返回 status：completed 完成；failed 模型故障，可换下一个；stopped 与模型无关的结束；
   * interrupted 被中断或总时限打断，由调用方区分。
   */
  const runOnce = async ({ model, args, parent, settings, signal }) => {
    const route = routeOf(model);
    const reasoningEffort = model.reasoningEffort || undefined;

    // 预检模型路由
    try {
      await ctx.llm.resolveCallConfig(
        {
          provider: model.provider,
          model: model.model,
          ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        },
        signal,
      );
    } catch (error) {
      if (signal.aborted) return { status: 'interrupted', text: '' };
      return { status: 'failed', failure: failureFrom(error, 'ROUTE_UNAVAILABLE'), text: '' };
    }

    // 启动子代理
    const depth = Math.max(parent.session.header.delegationDepth ?? 0, parent.options.subagentDepth ?? 0);
    let activation;
    try {
      activation = await ctx.subagents.startActivation({
        provider: config.subagentProvider,
        label: labelOf(args.task),
        name: `lookup-${Math.random().toString(36).slice(2, 8)}`,
        prompt: [{ type: 'text', text: promptOf(args, settings) }],
        parent,
        ...(args.cwd ? { cwd: args.cwd } : {}),
        agentPreset: config.agentPreset,
        agentOptions: { provider: model.provider, model: model.model, reasoningEffort },
        maxDepth: depth + 1,
        signal,
        delivery: 'caller',
      });
    } catch (error) {
      if (signal.aborted) return { status: 'interrupted', text: '' };
      // 子代理服务自身拒绝启动（并发上限、预设缺失等）与所选模型无关
      const status = error?.name === 'SubagentError' ? 'stopped' : 'failed';
      return { status, failure: failureFrom(error, 'START_FAILED'), text: '' };
    }
    ctx.logger.info(`${LOG} 启动子代理 ${activation.name}，模型 ${route}`);

    // 等待报告；用户中断或总时限到达时停止子代理
    const stop = () => {
      activation.dispose().catch((error) => ctx.logger.warn(`${LOG} 停止子代理失败：${error?.message ?? error}`));
    };
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
    let result;
    try {
      result = await activation.result;
    } catch (error) {
      if (signal.aborted) return { status: 'interrupted', text: '' };
      return { status: 'failed', failure: failureFrom(error, 'RESULT_UNAVAILABLE'), text: '' };
    } finally {
      signal.removeEventListener('abort', stop);
    }

    const text = textOf(result.output);
    if (result.stopReason === 'completed') return { status: 'completed', text };
    if (signal.aborted) return { status: 'interrupted', text };
    if (result.stopReason === 'error') {
      const failure = (await failureOf(activation.childId)) ?? { code: 'ERROR', message: 'the helper ended with an error' };
      return { status: 'failed', failure, text };
    }
    const failure = STOPPED[result.stopReason] ?? { code: String(result.stopReason), message: 'the helper did not finish' };
    return { status: 'stopped', failure, text };
  };

  // 按列表顺序跑一次检索
  const runWithModels = async ({ sessionId, parent, args, exec, settings }) => {
    // 所有模型共用的总时限
    const startedAt = Date.now();
    const budgetMs = settings.timeoutSec * 1000;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), budgetMs);
    const signal = AbortSignal.any([exec.signal, deadline.signal]);

    // 冷却中的模型排到最后；全部在冷却时就是配置顺序
    const isCooling = (model) => (cooldowns.get(routeKey(model))?.until ?? 0) > startedAt;
    const queue = [...settings.models.filter((model) => !isCooling(model)), ...settings.models.filter(isCooling)];

    const attempts = [];
    let winner;
    // 最近一次未完成的尝试留下的报告片段
    let partial;
    let outOfTime = false;
    try {
      for (const model of queue) {
        if (attempts.length > 0 && budgetMs - (Date.now() - startedAt) < MIN_ATTEMPT_MS) {
          outOfTime = true;
          break;
        }
        const route = routeOf(model);
        const attemptAt = Date.now();
        const result = await runOnce({ model, args, parent, settings, signal });
        // 用户中断：立即结束，不换模型
        exec.signal.throwIfAborted();
        const seconds = secondsSince(attemptAt);

        if (result.status === 'completed') {
          cooldowns.delete(routeKey(model));
          attempts.push({ route, status: 'completed', seconds });
          winner = { model, route, text: result.text };
          ctx.logger.info(`${LOG} ${route} 完成，${seconds}s`);
          break;
        }

        const timedOut = result.status === 'interrupted';
        const failure = timedOut
          ? { code: 'TIMEOUT', message: `the shared ${settings.timeoutSec}s time budget ran out` }
          : result.failure;
        attempts.push({ route, status: 'failed', code: failure.code, message: failure.message, seconds });
        if (result.text) partial = { route, text: result.text };
        ctx.logger.info(`${LOG} ${route} 未完成，${seconds}s，${failure.code} ${failure.message}`);
        if (timedOut) outOfTime = true;
        // 冷却：模型故障，或独占了一半以上的时限仍没有交出报告
        const slow = timedOut && Date.now() - attemptAt >= budgetMs / 2;
        if ((result.status === 'failed' || slow) && settings.cooldownSec > 0) {
          cooldowns.set(routeKey(model), { until: Date.now() + settings.cooldownSec * 1000, code: failure.code });
        }
        if (result.status !== 'failed') break;
      }
    } finally {
      clearTimeout(timer);
    }
    const seconds = secondsSince(startedAt);
    const untried = queue.slice(attempts.length);

    if (winner !== undefined) {
      // 配置顺序排在前面、因冷却而没有试的模型
      const skipped = settings.models
        .slice(0, settings.models.indexOf(winner.model))
        .filter((model) => untried.includes(model))
        .map((model) => ({ route: routeOf(model), status: 'skipped', code: cooldowns.get(routeKey(model))?.code ?? '' }));
      const failed = attempts.filter((attempt) => attempt.status === 'failed');
      store.recordRun(sessionId, { ok: true, route: winner.route, seconds, attempts: [...failed, ...skipped] });

      const notes = [
        ...failed.map((attempt) => `${attempt.route} failed: ${clip(detailOf(attempt), NOTE_MAX)}`),
        ...skipped.map((attempt) => `${attempt.route} skipped: cooling down after ${attempt.code || 'a failure'}`),
      ];
      const truncated = winner.text.length > settings.maxOutputChars;
      const report = truncated ? winner.text.slice(0, settings.maxOutputChars) : winner.text;
      return {
        report: report || '(The helper returned no report.)',
        route: winner.route,
        seconds,
        truncated,
        fallback: notes.join('; '),
      };
    }

    // 没有模型给出报告
    const last = attempts[attempts.length - 1];
    store.recordRun(sessionId, { ok: false, route: last.route, seconds, attempts });
    const lines = attempts.map((attempt) => `- ${attempt.route}: ${detailOf(attempt)}`);
    // 未尝试的模型及原因
    const notTried = outOfTime
      ? `the ${settings.timeoutSec}s time budget was used up`
      : `${last.code} is not a model failure, so other models were not tried`;
    for (const model of untried) lines.push(`- ${routeOf(model)}: not tried, ${notTried}`);
    let message =
      lines.length === 1
        ? `The retrieval helper (${last.route}) failed: ${detailOf(last)}. Do this lookup yourself.`
        : `The retrieval helper failed on every model it tried. Do this lookup yourself.\n${lines.join('\n')}`;
    if (partial !== undefined) {
      message += `\n\nPartial report (${partial.route}):\n${partial.text.slice(0, settings.maxOutputChars)}`;
    }
    throw new Error(message);
  };

  // 读本会话设置；未启用或没有模型时报错
  const usableSettings = (sessionId) => {
    const settings = store.effectiveFor(sessionId, config.defaults);
    if (!settings.enabled) {
      throw new Error(
        'The retrieval helper is off for this session. Do this lookup yourself, and do not call query_scout again in this session unless the user turns the helper on.',
      );
    }
    if (settings.models.length === 0) {
      throw new Error('The retrieval helper has no model configured. Do this lookup yourself.');
    }
    return settings;
  };

  return async function run(args, exec) {
    const parent = exec.agent;
    if (parent === undefined) throw new Error('query_scout requires a calling agent');
    if (presetOf(parent) === config.agentPreset) {
      throw new Error('The retrieval helper cannot delegate to another helper; do the lookup directly.');
    }
    const sessionId = parent.session.header.id;
    usableSettings(sessionId);

    // 超出同时检索上限时排队；排队时间不计入总时限
    const queuedAt = Date.now();
    await acquire(sessionId, exec.signal);
    const waited = secondsSince(queuedAt);
    try {
      // 排队期间设置可能已改，重读一次
      const result = await runWithModels({ sessionId, parent, args, exec, settings: usableSettings(sessionId) });
      return { ...result, waited };
    } finally {
      release(sessionId);
    }
  };
}

// 距某时刻的秒数，保留一位小数
function secondsSince(from) {
  return Math.round((Date.now() - from) / 100) / 10;
}

// 截断过长文本
function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// 把抛出的错误整理成失败记录
function failureFrom(error, fallbackCode) {
  return {
    code: String(error?.code ?? fallbackCode),
    message: clip(String(error?.message ?? error), ERROR_MAX),
  };
}

// 失败记录的文本形式
function detailOf(attempt) {
  return attempt.message ? `${attempt.code}: ${attempt.message}` : attempt.code;
}

// 取任务首行
function labelOf(task) {
  const line = task.trim().split('\n')[0];
  return line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX - 1)}…` : line;
}

// 拼子代理提示词
function promptOf(args, settings) {
  const parts = [];
  if (settings.instructions) parts.push(`Standing instructions from the user:\n${settings.instructions}`);
  parts.push(`Task:\n${args.task}`);
  if (args.context) parts.push(`Known context:\n${args.context}`);
  parts.push(`Keep the report under ${settings.maxOutputChars} characters.`);
  return parts.join('\n\n');
}

// 取文本块
function textOf(blocks) {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}
