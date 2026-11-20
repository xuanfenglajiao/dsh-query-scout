/**
 * query_scout 工具定义与委派指引
 */

export const TOOL_NAME = 'query_scout';

const DESCRIPTION =
  'Delegate a lookup to the retrieval helper: a separate agent on the model the user picked for lookups, with read-only tools ' +
  '(read, glob, grep, web_search, web_fetch). It returns one report with path:line references, URLs and short excerpts. ' +
  'Only the report enters this conversation; the helper does not see this conversation. ' +
  'The call waits for the report. Independent calls can run in parallel.';

// 系统提示中的委派指引
export const GUIDANCE = [
  'Delegate retrieval work to `query_scout` when it is broad or large, whatever its kind: web searches, reading code, reading documentation, or a mix. The helper usually runs on a cheaper model than yours, and its searches and reads stay out of your context: you receive only its report.',
  '- Delegate when the work needs more than about three searches, file reads or page fetches, or covers many files, directories, repositories or web pages. This includes reading code to understand it before you review, explain or change it, and it applies to shell commands (rg, grep, find, cat, Select-String, Get-ChildItem, Get-Content) as much as to the read, grep, glob, web_search and web_fetch tools.',
  '- Do the retrieval yourself only when one or two reads or searches are enough.',
  '- Write each task as a self-contained question with the paths, names and URLs you know, and state the form of the answer you need. Split broad work into independent tasks and start them in parallel.',
  '- Treat the report as leads. Before you edit code, read the exact lines you will change yourself.',
  '- If a call fails, do that retrieval yourself.',
].join('\n');

export function createTool(defineTool, run) {
  return defineTool({
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      task: {
        type: 'string',
        required: true,
        description:
          'A self-contained question: what to find and the form of the answer, for example "file paths with line numbers and the key excerpt".',
      },
      context: {
        type: 'string',
        description: 'Known leads: repositories, directories, file and symbol names, URLs, and directions already ruled out.',
      },
      cwd: {
        type: 'string',
        description: 'Initial helper directory. Relative paths use your current directory; omitted inherits it.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          report: { type: 'string', required: true },
          route: { type: 'string', required: true },
          seconds: { type: 'number', required: true },
          truncated: { type: 'boolean', required: true },
          // 排在前面但没有给出报告的模型及原因；没有时为空串
          fallback: { type: 'string', required: true },
          // 排队等待秒数
          waited: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            `${value.report}\n\n[query_scout: ${value.route}, ${value.seconds}s` +
            `${value.waited >= 1 ? `, queued ${value.waited}s` : ''}` +
            `${value.truncated ? ', report truncated' : ''}${value.fallback ? `; ${value.fallback}` : ''}]`,
        },
      ],
    },
    isConcurrencySafe: () => true,
    execute: (args, exec) => run(args, exec),
  });
}
