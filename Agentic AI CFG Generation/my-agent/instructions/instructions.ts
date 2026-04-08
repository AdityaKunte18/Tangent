import { DiscoveredMethod, MethodPlan } from '../cfg/schema.js'

export const discoveryInstruction = `
You extract function and method definitions from a numbered chunk of a source file.

Return JSON only. Do not include markdown, comments, explanations, or code fences.

Requirements:
- Return an object with exactly two top-level fields: "language" and "methods".
- Every method object must include "name", "returnType", "parameters", "startLine", and "endLine".
- Parameters must always be an array, even when the method takes no arguments.
- The source file may be syntactically imperfect. Work best-effort.
- Identify every function or method whose definition starts in the provided chunk.
- The numbered prefix is metadata. It is not part of the source code.
- Use the absolute line numbers shown in the numbered source.
- Return startLine and endLine for each discovered method in the original file.
- Only include methods that are fully visible in the provided chunk.
- Infer the return type when it is implicit. Use "void" when nothing is returned and "unknown" only when you truly cannot infer it.
- If no methods exist, return an empty methods array.
- The language field should be your best guess such as "python", "c++", or "java".

Example:
{
  "language": "python",
  "methods": [
    {
      "name": "basic",
      "returnType": "void",
      "parameters": [],
      "startLine": 10,
      "endLine": 13
    }
  ]
}
`.trim()

export const cfgPlanningInstruction = `
You generate a compact control-flow plan for a single method or function.

Return JSON only. Do not include markdown, comments, explanations, or code fences.

Core rules:
- Return an object with exactly four top-level fields: "name", "returnType", "parameters", and "body".
- The "body" field is an ordered array of control-flow steps.
- Use "block" steps for ordinary straight-line statements only.
- Do not place return, break, or continue statements inside block steps.
- Use "return" for return statements, "break" for loop breaks, and "continue" for loop continues.
- Use "if" for conditionals with nested "then" and "else" arrays.
- Use "loop" for loops with nested "body" arrays.
- For loops, set "loopType" to one of "for", "while", "do-while", "foreach", or "unknown".
- Every "if" and "loop" step must include a non-empty "condition" field.
- Preserve source-language syntax exactly for boolean literals and loop conditions. For example, use "true" in C++/Java and "True" in Python when that is what the source uses.
- Preserve source-language syntax in statements, conditions, iteratorStart, and iteratorUpdate.
- Do not invent helper nodes, node ids, predicate ids, joins, exits, or synthetic return variables. Deterministic CFG compilation happens outside the model.
- Keep the plan minimal. Group consecutive straight-line statements into one block when practical.

Example for a void straight-line method:
{
  "name": "basic",
  "returnType": "void",
  "parameters": [],
  "body": [
    {
      "kind": "block",
      "statements": ["x = 1", "print(x)"]
    }
  ]
}
`.trim()

function numberMethodSource(methodSource: string): string {
    return methodSource
        .split('\n')
        .map((line, index) => `${index + 1}: ${line}`)
        .join('\n')
}

export function buildDiscoveryPrompt(
    numberedChunkSource: string,
    filename: string,
    startLine: number,
    endLine: number
): string {
    return `
Analyze the following source file chunk and extract every function or method whose definition starts inside this chunk.

Filename: ${filename}
Chunk line range: ${startLine}-${endLine}

Each source line is prefixed as "<absoluteLineNumber>: ". The numeric prefix is metadata and is not part of the code.

Numbered source chunk:
${numberedChunkSource}

Return the methods using absolute line numbers from the numbered source.
`.trim()
}

export function buildPlanPrompt(method: DiscoveredMethod, language: string): string {
    return `
Generate a control-flow plan for this single method.

Language: ${language}
Method name: ${method.name}
Declared return type: ${method.returnType}
Parameters: ${JSON.stringify(method.parameters, null, 2)}

Numbered method source:
\`\`\`
${numberMethodSource(method.source)}
\`\`\`

Focus only on this method's control flow. Do not reproduce surrounding file structure, imports, class wrappers, or unrelated methods.
`.trim()
}

export function buildPlanRepairPrompt(method: DiscoveredMethod, language: string, previousPlan: MethodPlan, errors: string[]): string {
    return `
Repair the control-flow plan for this method.

Language: ${language}
Method name: ${method.name}
Declared return type: ${method.returnType}
Parameters: ${JSON.stringify(method.parameters, null, 2)}

Numbered method source:
\`\`\`
${numberMethodSource(method.source)}
\`\`\`

Previous control-flow plan:
\`\`\`json
${JSON.stringify(previousPlan, null, 2)}
\`\`\`

Validation errors:
${errors.map((error, index) => `${index + 1}. ${error}`).join('\n')}

Return a corrected control-flow plan that satisfies all validation errors and all core rules.
Do not restate the method source or add unrelated surrounding-file context, CFG node ids, or synthetic return variables.
`.trim()
}
