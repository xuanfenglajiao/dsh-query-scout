/**
 * dsh-query-scout 浏览器端
 *
 * 在输入框工具栏（conversation.input.right）放「检索助手」按钮，弹出面板
 * 配置本会话的检索子代理：开关、按顺序尝试的模型列表、每个模型的推理强度、附加提示词。
 * 面板上的改动立即保存，没有单独的保存按钮。
 * 模型目录只读，不调用其 select()（那会切换主模型）。
 * 与 Host 的通信走 POST /query-scout/api。
 * 视觉沿用宿主模型菜单：13px 字号、34px 行高、4px 卡片内边距。
 */

window.__ModuleLoader__.load({
  id: 'dsh-query-scout',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    const NS = 'query-scout';
    // 提示词停止输入多久后保存
    const DRAFT_DELAY_MS = 700;
    // 模型数超过此值时显示搜索框，与宿主模型菜单一致
    const SEARCH_ABOVE = 4;
    const PANEL_WIDTH = 320;

    const zh = {
      'trigger.aria': '检索助手设置',
      'trigger.disabled': '未启用',
      'panel.title': '检索助手',
      'panel.back': '返回',
      'panel.enable': '本会话启用',
      'panel.loading': '加载中…',
      'panel.stale': '面板已更新，Host 还是旧版本。重启 DeepSeek Harness 后生效。',
      'models.heading': '模型（按顺序尝试）',
      'models.add': '添加备用模型',
      'models.addFirst': '添加模型',
      'models.change': '更换模型：{model}',
      'models.effort': '推理：{level}',
      'models.up': '上移 {model}',
      'models.down': '下移 {model}',
      'models.remove': '移除 {model}',
      'models.missing': '不可用',
      'effort.title': '推理强度',
      'effort.default': '默认',
      'pick.addTitle': '添加备用模型',
      'pick.firstTitle': '选择模型',
      'pick.replaceTitle': '更换模型',
      'pick.search': '搜索模型',
      'pick.used': '已在列表中',
      'pick.loading': '正在加载模型列表',
      'pick.empty': '暂无可用模型',
      'pick.noMatch': '没有匹配的模型',
      'instructions.label': '附加提示词',
      'instructions.unset': '未设置',
      'instructions.placeholder': '例如：只看 src 与 docs，结论附文件路径',
      'parallel.label': '同时检索上限',
      'parallel.value': '{n} 个',
      'parallel.note': '主模型一次发出的检索超过这个数时，多出的排队等待，不会失败。数值越大越快，同时消耗的费用也越多。',
      'scope.session': '本会话单独设置',
      'scope.default': '使用默认设置',
      'scope.reset': '恢复默认',
      'scope.saveDefaults': '设为默认',
      'scope.saveDefaultsHint': '把当前设置存为默认值，没有单独设置的会话都按它执行',
      'status.reset': '已恢复默认',
      'status.savedDefaults': '已设为默认',
      'run.ok': '最近：{model} 完成，{seconds}s',
      'run.okAfter': '最近：{model} 完成（{notes}），{seconds}s',
      'run.failed': '最近失败：{notes}',
      'run.note': '{model} {reason}',
      'run.skipped': '{model} 冷却中',
      'run.separator': '；',
      'reason.rateLimit': '限流',
      'reason.quota': '额度用完',
      'reason.server': '服务端错误',
      'reason.auth': '鉴权失败',
      'reason.timeout': '超时',
      'reason.network': '网络错误',
      'reason.empty': '空回复',
      'reason.unavailable': '模型不可用',
      'reason.context': '上下文超限',
      'reason.maxTokens': '输出超限',
      'reason.aborted': '已停止',
      'reason.blocked': '任务被拒绝',
      'error.generic': '操作失败：{message}',
    };

    const en = {
      'trigger.aria': 'Retrieval helper settings',
      'trigger.disabled': 'Off',
      'panel.title': 'Retrieval helper',
      'panel.back': 'Back',
      'panel.enable': 'Enable here',
      'panel.loading': 'Loading…',
      'panel.stale': 'The panel was updated but the Host is still the old version. Restart DeepSeek Harness to use it.',
      'models.heading': 'Models (tried in order)',
      'models.add': 'Add a fallback model',
      'models.addFirst': 'Add a model',
      'models.change': 'Change model: {model}',
      'models.effort': 'Effort: {level}',
      'models.up': 'Move {model} up',
      'models.down': 'Move {model} down',
      'models.remove': 'Remove {model}',
      'models.missing': 'Unavailable',
      'effort.title': 'Reasoning effort',
      'effort.default': 'Default',
      'pick.addTitle': 'Add a fallback model',
      'pick.firstTitle': 'Choose a model',
      'pick.replaceTitle': 'Change model',
      'pick.search': 'Search models',
      'pick.used': 'In the list',
      'pick.loading': 'Loading models',
      'pick.empty': 'No models available',
      'pick.noMatch': 'No matching models',
      'instructions.label': 'Extra instructions',
      'instructions.unset': 'Not set',
      'instructions.placeholder': 'e.g. only look in src and docs; cite file paths',
      'parallel.label': 'Lookups at once',
      'parallel.value': '{n}',
      'parallel.note': 'When the main model starts more lookups than this, the rest wait in a queue instead of failing. A higher number is faster and spends more at the same time.',
      'scope.session': 'Set for this session',
      'scope.default': 'Using the default',
      'scope.reset': 'Reset',
      'scope.saveDefaults': 'Set as default',
      'scope.saveDefaultsHint': 'Save these settings as the default for every session without its own',
      'status.reset': 'Reset to default',
      'status.savedDefaults': 'Saved as default',
      'run.ok': 'Last: {model} done, {seconds}s',
      'run.okAfter': 'Last: {model} done ({notes}), {seconds}s',
      'run.failed': 'Last run failed: {notes}',
      'run.note': '{model} {reason}',
      'run.skipped': '{model} cooling down',
      'run.separator': '; ',
      'reason.rateLimit': 'rate limited',
      'reason.quota': 'out of quota',
      'reason.server': 'server error',
      'reason.auth': 'auth failed',
      'reason.timeout': 'timed out',
      'reason.network': 'network error',
      'reason.empty': 'empty reply',
      'reason.unavailable': 'model unavailable',
      'reason.context': 'context too long',
      'reason.maxTokens': 'output limit reached',
      'reason.aborted': 'stopped',
      'reason.blocked': 'task rejected',
      'error.generic': 'Action failed: {message}',
    };

    // Host 失败码到简短原因的映射；不在表里的显示服务商原文
    const REASON_KEYS = {
      RATE_LIMIT: 'reason.rateLimit',
      QUOTA: 'reason.quota',
      ACCOUNT_QUOTA: 'reason.quota',
      SERVER: 'reason.server',
      AUTH: 'reason.auth',
      MISSING_CREDENTIAL: 'reason.auth',
      INVALID_CREDENTIAL: 'reason.auth',
      ACCOUNT_TOKEN_INVALID: 'reason.auth',
      ACCOUNT_SIGN_IN_REQUIRED: 'reason.auth',
      TIMEOUT: 'reason.timeout',
      TRANSPORT: 'reason.network',
      STREAM_CLOSED: 'reason.network',
      EMPTY_RESPONSE: 'reason.empty',
      UNKNOWN_MODEL: 'reason.unavailable',
      NO_ADAPTER: 'reason.unavailable',
      MODEL_UNSUPPORTED: 'reason.unavailable',
      CONTEXT_WINDOW_EXCEEDED: 'reason.context',
      MAX_TOKENS: 'reason.maxTokens',
      ABORTED: 'reason.aborted',
      BLOCKED: 'reason.blocked',
    };

    const CSS = `
.qs-trigger{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:400;cursor:pointer;white-space:nowrap}
.qs-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.qs-trigger.qs-on{color:var(--dsw-alias-brand-primary)}
.qs-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary))}
.qs-panel{box-sizing:border-box;position:fixed;z-index:1100;display:flex;flex-direction:column;width:${PANEL_WIDTH}px;max-width:calc(100vw - 16px);padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-overlay));box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.45));color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow:hidden}
.qs-panel:focus{outline:none}
.qs-body{min-height:0;overflow-x:hidden;overflow-y:auto}
.qs-head{flex:0 0 auto;display:flex;align-items:center;gap:6px;min-height:34px;padding:0 4px 0 8px}
.qs-headMain{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:4px}
.qs-title{font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qs-back{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-left:-4px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.qs-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.qs-switch{flex:0 0 auto;display:inline-flex;padding:0;border:none;border-radius:9px;background:transparent;cursor:pointer}
.qs-switchTrack{position:relative;width:32px;height:18px;border-radius:9px;background:var(--dsw-alias-border-l2);transition:background 120ms ease}
.qs-switchOn .qs-switchTrack{background:var(--dsw-alias-brand-primary)}
.qs-switchThumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform 120ms ease}
.qs-switchOn .qs-switchThumb{transform:translateX(14px);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-overlay))}
.qs-section{padding:4px 8px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-weight:500}
.qs-model{display:flex;align-items:center;gap:2px;min-height:44px;padding:2px 4px 2px 8px}
.qs-index{flex:0 0 14px;display:inline-flex;align-items:center;justify-content:center;margin-right:4px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.qs-modelMain{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;align-items:flex-start}
.qs-modelName{display:inline-flex;align-items:center;gap:2px;max-width:100%;margin-left:-4px;padding:0 2px 0 4px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.qs-modelName:hover{background:var(--dsw-alias-interactive-bg-hover)}
.qs-modelNameText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qs-modelMeta{display:flex;align-items:center;gap:4px;max-width:100%;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;white-space:nowrap}
.qs-modelProvider{min-width:0;overflow:hidden;text-overflow:ellipsis}
.qs-modelMissing{flex:0 0 auto;color:var(--dsw-alias-state-error-primary)}
.qs-modelEffort{flex:0 0 auto;display:inline-flex;align-items:center;gap:2px;padding:0 3px;border:none;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer}
.qs-modelEffort:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.qs-modelEffort:disabled{cursor:default}
.qs-iconBtn{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer}
.qs-iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.qs-iconBtn:disabled{color:var(--dsw-alias-label-dimmed);opacity:.5;cursor:default}
.qs-switch:focus-visible,.qs-modelName:focus-visible,.qs-modelEffort:focus-visible,.qs-iconBtn:focus-visible,.qs-back:focus-visible,.qs-link:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary))}
.qs-cell{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;height:34px;padding:0 8px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:left;cursor:pointer;outline:none}
.qs-cell:hover,.qs-cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.qs-cellAdd{gap:2px;color:var(--dsw-alias-label-secondary)}
.qs-cellLabel{flex:0 0 auto;white-space:nowrap}
.qs-cellValue{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-tertiary)}
.qs-chevron{flex:0 0 auto;width:12px;height:12px;color:var(--dsw-alias-menu-icon,var(--dsw-alias-label-caption))}
.qs-search{flex:0 0 auto;display:flex;align-items:center;gap:6px;margin:2px 0 3px;padding:5px 7px}
.qs-searchIcon{flex:0 0 auto;width:13px;height:13px;color:var(--dsw-alias-label-caption)}
.qs-searchInput{flex:1 1 auto;min-width:0;padding:0;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:18px}
.qs-searchInput::placeholder{color:var(--dsw-alias-label-caption)}
.qs-list{max-height:300px;overflow-x:hidden;overflow-y:auto}
.qs-group{padding:6px 8px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-weight:500}
.qs-option{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:5px 7px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;text-align:left;cursor:pointer;outline:none}
.qs-option:hover:not(:disabled),.qs-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.qs-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.qs-optionName{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qs-optionHint{flex:0 0 auto;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.qs-check{display:grid;place-items:center;flex:0 0 14px;width:14px;height:14px;color:var(--dsw-alias-label-primary)}
.qs-divider{height:1px;margin:3px 8px;background:var(--dsw-alias-border-l1)}
.qs-field{padding:4px 8px}
.qs-label{display:block;margin-bottom:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.qs-text{display:block;box-sizing:border-box;width:100%;min-height:54px;max-height:132px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:18px;resize:vertical;outline:none}
.qs-text:focus{border-color:var(--dsw-alias-brand-primary)}
.qs-text::placeholder{color:var(--dsw-alias-label-caption)}
.qs-foot{display:flex;align-items:center;gap:4px;min-height:28px;padding:0 8px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.qs-footMain{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden}
.qs-link{flex:0 0 auto;padding:2px 4px;border:none;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;white-space:nowrap;cursor:pointer}
.qs-link:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.qs-line{padding:0 8px 4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.qs-lineClamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.qs-lineOk{color:var(--dsw-alias-state-success-primary)}
.qs-lineErr{color:var(--dsw-alias-state-error-primary)}
.qs-note{padding:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
`;

    class ApiError extends Error {
      constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
      }
    }

    // 相对页面 base 解析；前导斜杠会逃出桌面壳的源
    function endpoint() {
      const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://dsh.internal/';
      return new URL('query-scout/api', base).toString();
    }

    async function api(op, args) {
      let response;
      try {
        response = await fetch(endpoint(), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, ...(args ?? {}) }),
        });
      } catch (error) {
        throw new ApiError('network', String(error && error.message ? error.message : error));
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new ApiError('bad-response', `HTTP ${response.status}`);
      }
      if (!body || body.ok !== true) {
        const failure = body && body.error ? body.error : { code: 'http', message: `HTTP ${response.status}` };
        throw new ApiError(failure.code, failure.message, failure.details);
      }
      return body.value;
    }

    // 雷达：圆盘、扫描线、内圈弧；启用时多一个实心回波点
    function Icon({ on }) {
      const stroke = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, fill: 'none' },
        h('circle', { cx: 8, cy: 8, r: 6.2, ...stroke }),
        h('path', { d: 'M8 8L12.4 3.6', ...stroke }),
        h('path', { d: 'M8 4.8A3.2 3.2 0 0 0 4.8 8', ...stroke }),
        on ? h('circle', { cx: 6.2, cy: 10.4, r: 1.2, fill: 'currentColor' }) : null,
      );
    }

    // 12px 线条图标
    function Glyph({ d, size = 12, className, width = 1.4 }) {
      return h(
        'svg',
        { className, viewBox: '0 0 12 12', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('path', { d, stroke: 'currentColor', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    const PATHS = {
      plus: 'M6 2.5v7M2.5 6h7',
      right: 'M4.5 2.5L8 6l-3.5 3.5',
      left: 'M7.5 2.5L4 6l3.5 3.5',
      down: 'M3 4.5L6 7.5l3-3',
      up: 'M6 9.5v-7M3 5.5l3-3 3 3',
      lower: 'M6 2.5v7M3 6.5l3 3 3-3',
      close: 'M3.2 3.2l5.6 5.6M8.8 3.2L3.2 8.8',
      search: 'M8 8l2.5 2.5M9 5.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z',
    };

    function Check() {
      return h(
        'svg',
        { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true, fill: 'none' },
        h('path', { d: 'M2.5 7.5l3 3 6-6.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    // 模型 ID 末段：目录里的显示名带路由后缀，会把有用的部分挤掉
    function shortModel(model) {
      const text = String(model ?? '');
      const at = text.lastIndexOf('/');
      return at < 0 ? text : text.slice(at + 1);
    }

    // 模型 ID 末段之前的部分，用来区分同名模型的不同路由
    function modelPrefix(model) {
      const text = String(model ?? '');
      const at = text.lastIndexOf('/');
      return at < 0 ? '' : text.slice(0, at);
    }

    function keyOf(provider, model) {
      return JSON.stringify([provider, model]);
    }

    // 与宿主模型菜单相同的提供方顺序
    function orderGroups(groups) {
      const rank = (group) => (group.id === 'deepseek-account' ? 0 : group.id === 'deepseek-official' ? 1 : 2);
      return [...groups].sort((left, right) => rank(left) - rank(right));
    }

    function formOf(effective) {
      // 旧版 Host 返回单模型字段
      const listed = Array.isArray(effective.models)
        ? effective.models
        : effective.provider && effective.model
          ? [{ provider: effective.provider, model: effective.model, reasoningEffort: effective.reasoningEffort }]
          : [];
      return {
        enabled: effective.enabled === true,
        models: listed.map((item) => ({
          provider: item.provider,
          model: item.model,
          reasoningEffort: item.reasoningEffort || '',
        })),
        instructions: effective.instructions || '',
        maxParallel: Number.isInteger(effective.maxParallel) ? effective.maxParallel : 2,
      };
    }

    function patchOf(form) {
      return {
        enabled: form.enabled,
        models: form.models.map((item) =>
          item.reasoningEffort
            ? { provider: item.provider, model: item.model, reasoningEffort: item.reasoningEffort }
            : { provider: item.provider, model: item.model },
        ),
        instructions: form.instructions,
        maxParallel: form.maxParallel,
      };
    }

    // 失败原因的简短说法
    function reasonText(attempt, t) {
      const key = REASON_KEYS[attempt.code];
      if (key) return t(key);
      const message = String(attempt.message || '').trim();
      if (!message) return attempt.code;
      return message.length > 48 ? `${message.slice(0, 47)}…` : message;
    }

    // 最近一次检索的一行摘要
    function runSummary(run, t) {
      const others = (run.attempts || []).filter((attempt) => attempt.status !== 'completed');
      const notes = others
        .map((attempt) =>
          attempt.status === 'skipped'
            ? t('run.skipped', { model: shortModel(attempt.route) })
            : t('run.note', { model: shortModel(attempt.route), reason: reasonText(attempt, t) }),
        )
        .join(t('run.separator'));
      const title = others
        .map((attempt) => `${attempt.route}: ${[attempt.status, attempt.code, attempt.message].filter(Boolean).join(' ')}`)
        .join('\n');
      if (!run.ok) return { failed: true, text: t('run.failed', { notes }), title };
      const model = shortModel(run.route);
      return {
        failed: false,
        text: notes ? t('run.okAfter', { model, notes, seconds: run.seconds }) : t('run.ok', { model, seconds: run.seconds }),
        title,
      };
    }

    function Toggle({ on, label, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': on,
          'aria-label': label,
          className: `qs-switch${on ? ' qs-switchOn' : ''}`,
          onClick: () => onChange(!on),
        },
        h('span', { className: 'qs-switchTrack' }, h('span', { className: 'qs-switchThumb' })),
      );
    }

    function Option({ name, hint, title, selected, disabled, onPick }) {
      return h(
        'button',
        { type: 'button', role: 'menuitemradio', 'aria-checked': selected === true, className: 'qs-option', title, disabled, onClick: onPick },
        h('span', { className: 'qs-optionName' }, name),
        hint ? h('span', { className: 'qs-optionHint' }, hint) : null,
        h('span', { className: 'qs-check' }, selected ? h(Check) : null),
      );
    }

    function ScoutControl(props) {
      const { t, sessionId, models: modelDirectories, sessions } = props;
      const [open, setOpen] = React.useState(false);
      // root 根视图；pick 选模型；effort 选推理强度
      const [view, setView] = React.useState('root');
      // 正在编辑的行；null 表示新增一行
      const [slot, setSlot] = React.useState(null);
      const [query, setQuery] = React.useState('');
      const [enableOnPick, setEnableOnPick] = React.useState(false);
      const [status, setStatus] = React.useState(null);
      const [lastRun, setLastRun] = React.useState(null);
      const [hasOverride, setHasOverride] = React.useState(false);
      // Host 返回的上限
      const [limits, setLimits] = React.useState({ maxModels: 3, instructionsMax: 4000, maxParallel: 8 });
      const [stale, setStale] = React.useState(false);
      const [form, setForm] = React.useState(null);
      const [pos, setPos] = React.useState(null);
      const [showInstr, setShowInstr] = React.useState(false);
      const triggerRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const live = React.useRef(false);
      const sessionRef = React.useRef(sessionId);
      // 还没提交的提示词编辑
      const draft = React.useRef(null);
      const draftTimer = React.useRef(null);
      // 保存队列：一次只发一个请求；连续的修改只留最新一个，恢复默认与设为默认不被合并
      const saver = React.useRef({ saving: false, pending: [] });
      const flushRef = React.useRef(() => {});

      const directory = React.useMemo(() => (sessionId ? modelDirectories.directoryFor(sessionId) : null), [sessionId]);
      const dirStore = directory ? directory.store : null;
      const dirState = React.useSyncExternalStore(
        (callback) => (dirStore ? dirStore.subscribe(callback) : () => {}),
        () => (dirStore ? dirStore.getSnapshot() : null),
      );
      const groups = (dirState && dirState.groups) || [];
      const catalogReady = dirState !== null && (dirState.status === 'ready' || dirState.status === 'selecting');

      const idle = () => !saver.current.saving && saver.current.pending.length === 0 && draft.current === null;

      // 用 Host 返回的状态刷新面板；keepForm 时不动正在编辑的内容
      const applyState = (value, keepForm) => {
        if (!value || !value.effective) return;
        if (!Array.isArray(value.effective.models)) {
          // Host 还是旧版本：只取启停状态给工具栏图标，面板提示重启
          setStale(true);
          setForm(formOf(value.effective));
          return;
        }
        setStale(false);
        if (!keepForm) setForm(formOf(value.effective));
        setLastRun(value.lastRun);
        setHasOverride(value.override !== null);
        if (value.limits) setLimits(value.limits);
      };

      const reload = (id) =>
        api('state', { sessionId: id }).then((value) => {
          if (live.current && sessionRef.current === id) applyState(value, !idle());
        });

      const pump = () => {
        const queue = saver.current;
        if (queue.saving || queue.pending.length === 0) return;
        const job = queue.pending.shift();
        queue.saving = true;
        const current = () => live.current && sessionRef.current === job.sessionId;
        const request =
          job.op === 'reset'
            ? api('reset', { sessionId: job.sessionId })
            : job.op === 'saveDefaults'
              ? api('saveDefaults', { sessionId: job.sessionId, patch: patchOf(job.form) }).then(() =>
                  api('state', { sessionId: job.sessionId }),
                )
              : api('update', { sessionId: job.sessionId, patch: patchOf(job.form) });
        request
          .then((value) => {
            if (!current()) return;
            applyState(value, queue.pending.length > 0 || draft.current !== null);
            if (job.op !== 'update') setStatus({ kind: 'ok', text: t(job.op === 'reset' ? 'status.reset' : 'status.savedDefaults') });
          })
          .catch((error) => {
            // 丢弃后续修改，回到 Host 状态
            queue.pending = [];
            if (!current()) return undefined;
            setStatus({ kind: 'err', text: t('error.generic', { message: error.message }) });
            return api('state', { sessionId: job.sessionId })
              .then((value) => {
                if (current()) applyState(value, draft.current !== null);
              })
              .catch(() => {});
          })
          .finally(() => {
            queue.saving = false;
            pump();
          });
      };

      const enqueue = (job) => {
        const pending = saver.current.pending;
        const last = pending[pending.length - 1];
        // 合并连续修改
        if (job.op === 'update' && last !== undefined && last.op === 'update') pending[pending.length - 1] = job;
        else pending.push(job);
        pump();
      };

      const dropDraft = () => {
        clearTimeout(draftTimer.current);
        draftTimer.current = null;
        draft.current = null;
      };

      const flushDraft = () => {
        const job = draft.current;
        dropDraft();
        if (job !== null) enqueue(job);
      };
      flushRef.current = flushDraft;

      // 改了就生效：先改界面，再保存到本会话
      const commit = (next) => {
        dropDraft();
        setStatus(null);
        setForm(next);
        enqueue({ op: 'update', sessionId, form: next });
      };

      React.useEffect(() => {
        live.current = true;
        return () => {
          live.current = false;
        };
      }, []);

      // 读会话状态，工具栏图标据此显示启停；离开会话时提交还没保存的提示词
      React.useEffect(() => {
        sessionRef.current = sessionId;
        setOpen(false);
        setForm(null);
        setLastRun(null);
        setHasOverride(false);
        setStatus(null);
        if (!sessionId) return undefined;
        reload(sessionId).catch(() => {});
        return () => flushRef.current();
      }, [sessionId]);

      const backToRoot = () => {
        setView('root');
        setEnableOnPick(false);
      };

      const openPanel = () => {
        const rect = triggerRef.current ? triggerRef.current.getBoundingClientRect() : null;
        if (rect) {
          setPos({
            bottom: window.innerHeight - rect.top + 8,
            right: Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - PANEL_WIDTH - 8)),
          });
        }
        backToRoot();
        setSlot(null);
        setQuery('');
        setStatus(null);
        setShowInstr(false);
        setOpen(true);
        if (directory) directory.load().catch(() => {});
        if (idle()) {
          reload(sessionId).catch((error) => setStatus({ kind: 'err', text: t('error.generic', { message: error.message }) }));
        }
      };
      const closePanel = () => {
        flushDraft();
        setOpen(false);
      };

      React.useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
          if (event.key !== 'Escape' || event.isComposing) return;
          if (view === 'root') closePanel();
          else backToRoot();
        };
        const onPointer = (event) => {
          if (panelRef.current && panelRef.current.contains(event.target)) return;
          if (triggerRef.current && triggerRef.current.contains(event.target)) return;
          closePanel();
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointer, true);
        return () => {
          document.removeEventListener('keydown', onKey);
          document.removeEventListener('pointerdown', onPointer, true);
        };
      }, [open, view]);

      // 切换视图会卸载原先聚焦的按钮：把焦点留在面板内，方向键和 Tab 才能继续用
      const viewBefore = React.useRef('root');
      React.useEffect(() => {
        const from = viewBefore.current;
        viewBefore.current = open ? view : 'root';
        const panelEl = panelRef.current;
        if (!open || !panelEl || view === from) return;
        if (panelEl.contains(document.activeElement)) return;
        const target =
          view === 'root'
            ? null
            : panelEl.querySelector('.qs-option[aria-checked="true"]:not(:disabled)') || panelEl.querySelector('.qs-option:not(:disabled)');
        (target || panelEl).focus({ preventScroll: true });
      }, [open, view]);

      if (sessionId === undefined || sessionId === null) return null;
      if (sessions.subagentAddress(sessionId) !== undefined) return null;

      const groupOf = (provider) => groups.find((group) => group.id === provider) || null;
      const entryOf = (item) => {
        const group = groupOf(item.provider);
        return group ? (group.models || []).find((entry) => entry.id === item.model) || null : null;
      };
      const providerLabel = (provider) => {
        const group = groupOf(provider);
        return group ? group.name || group.displayName || group.id : provider;
      };
      const effortsOf = (item) => {
        const entry = entryOf(item);
        return entry && entry.reasoning && Array.isArray(entry.reasoning.efforts) ? entry.reasoning.efforts : [];
      };
      const effortLabel = (item) =>
        item.reasoningEffort
          ? (effortsOf(item).find((level) => level.id === item.reasoningEffort) || {}).name || item.reasoningEffort
          : t('effort.default');

      const openPick = (index) => {
        setSlot(index);
        setQuery('');
        setView('pick');
      };
      const openEffort = (index) => {
        setSlot(index);
        setView('effort');
      };

      const toggle = (next) => {
        // 没有模型时先选一个，选好后再启用
        if (next && form.models.length === 0) {
          setEnableOnPick(true);
          openPick(null);
          return;
        }
        commit({ ...form, enabled: next });
      };

      const pick = (provider, model) => {
        const current = slot === null ? null : form.models[slot];
        setView('root');
        setEnableOnPick(false);
        if (current && current.provider === provider && current.model === model) return;
        // 各模型的推理档位不同，换模型后回到默认档
        const chosen = { provider, model, reasoningEffort: '' };
        const nextModels = slot === null ? [...form.models, chosen] : form.models.map((item, index) => (index === slot ? chosen : item));
        commit({ ...form, models: nextModels, enabled: form.enabled || enableOnPick });
      };

      const pickParallel = (n) => {
        setView('root');
        if (n !== form.maxParallel) commit({ ...form, maxParallel: n });
      };

      const pickEffort = (level) => {
        setView('root');
        commit({ ...form, models: form.models.map((item, index) => (index === slot ? { ...item, reasoningEffort: level } : item)) });
      };

      const move = (index, delta) => {
        const target = index + delta;
        if (target < 0 || target >= form.models.length) return;
        const next = form.models.slice();
        [next[index], next[target]] = [next[target], next[index]];
        commit({ ...form, models: next });
      };

      const remove = (index) => {
        if (form.models.length <= 1) return;
        commit({ ...form, models: form.models.filter((_, at) => at !== index) });
      };

      const editInstructions = (text) => {
        const next = { ...form, instructions: text };
        setShowInstr(true);
        setForm(next);
        draft.current = { op: 'update', sessionId, form: next };
        clearTimeout(draftTimer.current);
        draftTimer.current = setTimeout(flushDraft, DRAFT_DELAY_MS);
      };

      const resetSession = () => {
        dropDraft();
        setStatus(null);
        enqueue({ op: 'reset', sessionId });
      };

      const saveDefaults = () => {
        dropDraft();
        setStatus(null);
        enqueue({ op: 'saveDefaults', sessionId, form });
      };

      // 列表视图里用方向键移动，搜索框里回车选第一项
      const onPanelKey = (event) => {
        if (view === 'root' || event.nativeEvent.isComposing) return;
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
        const items = panelRef.current ? Array.from(panelRef.current.querySelectorAll('.qs-option:not(:disabled)')) : [];
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement);
        if (event.key === 'Enter') {
          if (at < 0 && event.target.tagName === 'INPUT') {
            event.preventDefault();
            items[0].click();
          }
          return;
        }
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
        items[next].focus();
      };

      const enabledNow = form !== null && form.enabled;
      const activeNames = enabledNow ? form.models.map((item) => shortModel(item.model)) : [];
      const triggerLabel =
        activeNames.length === 0
          ? t('trigger.disabled')
          : activeNames.length === 1
            ? activeNames[0]
            : `${activeNames[0]} +${activeNames.length - 1}`;

      // 状态刷新后行号可能失效，回到根视图
      const slotValid = form !== null && (slot === null ? view !== 'effort' : slot < form.models.length);
      const shown = stale || form === null || !slotValid ? 'root' : view;

      const head = (title, onBack) =>
        h(
          'div',
          { className: 'qs-head' },
          h(
            'div',
            { className: 'qs-headMain' },
            onBack
              ? h(
                  'button',
                  { type: 'button', className: 'qs-back', 'aria-label': t('panel.back'), onClick: onBack },
                  h(Glyph, { d: PATHS.left }),
                )
              : null,
            h('span', { className: 'qs-title' }, title),
          ),
          onBack || stale || form === null ? null : h(Toggle, { on: enabledNow, label: t('panel.enable'), onChange: toggle }),
        );

      const statusLine = status
        ? h('div', { className: `qs-line ${status.kind === 'ok' ? 'qs-lineOk' : status.kind === 'err' ? 'qs-lineErr' : ''}` }, status.text)
        : null;

      const modelRow = (item, index) => {
        const name = shortModel(item.model);
        const efforts = effortsOf(item);
        const missing = catalogReady && entryOf(item) === null;
        return h(
          'div',
          { key: keyOf(item.provider, item.model), className: 'qs-model' },
          h('span', { className: 'qs-index' }, index + 1),
          h(
            'div',
            { className: 'qs-modelMain' },
            h(
              'button',
              {
                type: 'button',
                className: 'qs-modelName',
                title: `${item.provider}/${item.model}`,
                'aria-label': t('models.change', { model: name }),
                onClick: () => openPick(index),
              },
              h('span', { className: 'qs-modelNameText' }, name),
              h(Glyph, { d: PATHS.right, size: 10, className: 'qs-chevron' }),
            ),
            h(
              'div',
              { className: 'qs-modelMeta' },
              h('span', { className: 'qs-modelProvider' }, providerLabel(item.provider)),
              missing ? h('span', { className: 'qs-modelMissing' }, t('models.missing')) : null,
              efforts.length > 0 || item.reasoningEffort ? h('span', { 'aria-hidden': true }, '·') : null,
              efforts.length > 0 || item.reasoningEffort
                ? h(
                    'button',
                    { type: 'button', className: 'qs-modelEffort', disabled: efforts.length === 0, onClick: () => openEffort(index) },
                    t('models.effort', { level: effortLabel(item) }),
                    efforts.length > 0 ? h(Glyph, { d: PATHS.down, size: 9 }) : null,
                  )
                : null,
            ),
          ),
          h(
            'button',
            { type: 'button', className: 'qs-iconBtn', disabled: index === 0, 'aria-label': t('models.up', { model: name }), title: t('models.up', { model: name }), onClick: () => move(index, -1) },
            h(Glyph, { d: PATHS.up }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'qs-iconBtn',
              disabled: index === form.models.length - 1,
              'aria-label': t('models.down', { model: name }),
              title: t('models.down', { model: name }),
              onClick: () => move(index, 1),
            },
            h(Glyph, { d: PATHS.lower }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'qs-iconBtn',
              disabled: form.models.length <= 1,
              'aria-label': t('models.remove', { model: name }),
              title: t('models.remove', { model: name }),
              onClick: () => remove(index),
            },
            h(Glyph, { d: PATHS.close }),
          ),
        );
      };

      const rootView = () => {
        const summary = lastRun ? runSummary(lastRun, t) : null;
        return h(
          React.Fragment,
          null,
          h('div', { className: 'qs-section' }, t('models.heading')),
          form.models.map(modelRow),
          form.models.length < limits.maxModels
            ? h(
                'button',
                { type: 'button', className: 'qs-cell qs-cellAdd', onClick: () => openPick(null) },
                h('span', { className: 'qs-index' }, h(Glyph, { d: PATHS.plus })),
                h('span', { className: 'qs-cellLabel' }, t(form.models.length === 0 ? 'models.addFirst' : 'models.add')),
              )
            : null,
          h('div', { className: 'qs-divider' }),
          showInstr || form.instructions
            ? h(
                'div',
                { className: 'qs-field' },
                h('span', { className: 'qs-label' }, t('instructions.label')),
                h('textarea', {
                  className: 'qs-text',
                  value: form.instructions,
                  maxLength: limits.instructionsMax,
                  placeholder: t('instructions.placeholder'),
                  autoFocus: showInstr,
                  onChange: (event) => editInstructions(event.target.value),
                  onBlur: flushDraft,
                }),
              )
            : h(
                'button',
                { type: 'button', className: 'qs-cell', onClick: () => setShowInstr(true) },
                h('span', { className: 'qs-cellLabel' }, t('instructions.label')),
                h('span', { className: 'qs-cellValue' }, t('instructions.unset')),
                h(Glyph, { d: PATHS.plus, className: 'qs-chevron' }),
              ),
          h(
            'button',
            { type: 'button', className: 'qs-cell', onClick: () => setView('parallel') },
            h('span', { className: 'qs-cellLabel' }, t('parallel.label')),
            h('span', { className: 'qs-cellValue' }, t('parallel.value', { n: form.maxParallel })),
            h(Glyph, { d: PATHS.right, className: 'qs-chevron' }),
          ),
          h('div', { className: 'qs-divider' }),
          h(
            'div',
            { className: 'qs-foot' },
            h(
              'div',
              { className: 'qs-footMain' },
              h('span', null, t(hasOverride ? 'scope.session' : 'scope.default')),
              hasOverride ? h('span', { 'aria-hidden': true }, '·') : null,
              hasOverride ? h('button', { type: 'button', className: 'qs-link', onClick: resetSession }, t('scope.reset')) : null,
            ),
            hasOverride
              ? h('button', { type: 'button', className: 'qs-link', title: t('scope.saveDefaultsHint'), onClick: saveDefaults }, t('scope.saveDefaults'))
              : null,
          ),
          statusLine,
          summary
            ? h('div', { className: `qs-line qs-lineClamp${summary.failed ? ' qs-lineErr' : ''}`, title: summary.title || undefined }, summary.text)
            : null,
        );
      };

      const pickView = () => {
        const current = slot === null ? null : form.models[slot];
        const taken = new Set(form.models.map((item) => keyOf(item.provider, item.model)));
        const total = groups.reduce((sum, group) => sum + (group.models || []).length, 0);
        const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const matches = (group, entry) => {
          const text = `${entry.id} ${entry.name || ''} ${group.name || ''}`.toLowerCase();
          return terms.every((term) => text.includes(term));
        };
        const visible = orderGroups(groups)
          .map((group) => ({ group, entries: (group.models || []).filter((entry) => matches(group, entry)) }))
          .filter((item) => item.entries.length > 0);
        return h(
          React.Fragment,
          null,
          total > SEARCH_ABOVE
            ? h(
                'div',
                { className: 'qs-search' },
                h(Glyph, { d: PATHS.search, className: 'qs-searchIcon', size: 13, width: 1.2 }),
                h('input', {
                  className: 'qs-searchInput',
                  type: 'text',
                  role: 'searchbox',
                  autoFocus: true,
                  value: query,
                  placeholder: t('pick.search'),
                  'aria-label': t('pick.search'),
                  onChange: (event) => setQuery(event.target.value),
                }),
              )
            : null,
          dirState && dirState.error ? h('div', { className: 'qs-line qs-lineErr' }, t('error.generic', { message: dirState.error })) : null,
          visible.length === 0
            ? h('div', { className: 'qs-note' }, t(total > 0 ? 'pick.noMatch' : catalogReady ? 'pick.empty' : 'pick.loading'))
            : h(
                'div',
                { className: 'qs-list', role: 'menu', 'aria-label': t('pick.search') },
                visible.map(({ group, entries }) =>
                  h(
                    'div',
                    { key: group.id, role: 'group', 'aria-label': group.name || group.id },
                    h('div', { className: 'qs-group' }, group.name || group.displayName || group.id),
                    entries.map((entry) => {
                      const isCurrent = current !== null && current.provider === group.id && current.model === entry.id;
                      const used = !isCurrent && taken.has(keyOf(group.id, entry.id));
                      return h(Option, {
                        key: entry.id,
                        name: shortModel(entry.id),
                        hint: used ? t('pick.used') : modelPrefix(entry.id),
                        title: `${entry.name || entry.id}\n${group.id}/${entry.id}`,
                        selected: isCurrent,
                        disabled: used,
                        onPick: () => pick(group.id, entry.id),
                      });
                    }),
                  ),
                ),
              ),
          statusLine,
        );
      };

      const effortView = () => {
        const item = form.models[slot];
        const entry = entryOf(item);
        const efforts = effortsOf(item);
        const fallback = entry && entry.reasoning ? entry.reasoning.defaultEffort : undefined;
        const fallbackName = fallback ? (efforts.find((level) => level.id === fallback) || {}).name || fallback : '';
        return h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'qs-list', role: 'menu', 'aria-label': t('effort.title') },
            h(Option, {
              name: t('effort.default'),
              hint: fallbackName,
              selected: !item.reasoningEffort,
              onPick: () => pickEffort(''),
            }),
            efforts.map((level) =>
              h(Option, {
                key: level.id,
                name: level.name || level.id,
                selected: item.reasoningEffort === level.id,
                onPick: () => pickEffort(level.id),
              }),
            ),
          ),
          statusLine,
        );
      };

      const parallelView = () =>
        h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'qs-list', role: 'menu', 'aria-label': t('parallel.label') },
            Array.from({ length: limits.maxParallel }, (_, at) => at + 1).map((n) =>
              h(Option, {
                key: n,
                name: t('parallel.value', { n }),
                selected: form.maxParallel === n,
                onPick: () => pickParallel(n),
              }),
            ),
          ),
          h('div', { className: 'qs-line' }, t('parallel.note')),
          statusLine,
        );

      const titleOf =
        shown === 'parallel'
          ? t('parallel.label')
          : shown === 'pick'
            ? t(slot !== null ? 'pick.replaceTitle' : form.models.length === 0 ? 'pick.firstTitle' : 'pick.addTitle')
            : shown === 'effort'
              ? `${t('effort.title')} · ${shortModel(form.models[slot].model)}`
              : t('panel.title');

      const body = stale
        ? h('div', { className: 'qs-note' }, t('panel.stale'))
        : form === null
          ? h('div', { className: 'qs-note' }, t('panel.loading'))
          : shown === 'parallel'
            ? parallelView()
            : shown === 'pick'
              ? pickView()
              : shown === 'effort'
                ? effortView()
                : rootView();

      const panel =
        open &&
        pos &&
        ReactDOM.createPortal(
          h(
            'div',
            {
              ref: panelRef,
              className: 'qs-panel',
              style: { bottom: pos.bottom, right: pos.right, maxHeight: Math.max(200, window.innerHeight - pos.bottom - 12) },
              role: 'dialog',
              tabIndex: -1,
              'aria-label': t('trigger.aria'),
              onKeyDown: onPanelKey,
            },
            head(titleOf, shown === 'root' ? null : backToRoot),
            h('div', { className: 'qs-body' }, body),
          ),
          document.body,
        );

      return h(
        React.Fragment,
        null,
        h('style', null, CSS),
        h(
          'button',
          {
            ref: triggerRef,
            type: 'button',
            className: `qs-trigger${enabledNow ? ' qs-on' : ''}`,
            'aria-label': t('trigger.aria'),
            'aria-expanded': open,
            title: `${t('panel.title')} · ${triggerLabel}`,
            onClick: () => (open ? closePanel() : openPanel()),
          },
          h(Icon, { on: enabledNow }),
        ),
        panel,
      );
    }

    return {
      inject: ['locale', 'slots', 'modelDirectories', 'sessions'],
      apply(ctx) {
        ctx.inject(['locale', 'slots', 'modelDirectories', 'sessions'], (scope) => {
          scope.effect(() => scope.locale.register(NS, { zh, en }), 'query-scout: dictionaries');
          scope.slots.inject('conversation.input.right', () =>
            scope.slots.register(
              {
                name: 'conversation.input.right',
                id: 'query-scout',
                order: 40,
                locale: NS,
                inject: (sessionId) => ({
                  sessionId,
                  models: scope.modelDirectories,
                  sessions: scope.sessions,
                }),
              },
              ScoutControl,
            ),
          );
        });
      },
    };
  },
});
