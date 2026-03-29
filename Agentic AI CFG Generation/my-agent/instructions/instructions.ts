import { CfgMethodDraft, DiscoveredMethod } from '../cfg/schema.js'

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

export const cfgGenerationInstruction = `
You generate a control-flow graph draft for a single method or function.

Return JSON only. Do not include markdown, comments, explanations, or code fences.

Core rules:
- The draft must have exactly one entry node and exactly one exit node.
- Use temporary node and predicate ids. Final renumbering is handled outside the model.
- All node and predicate references must resolve within the method.
- Every node and predicate must be reachable from the entry node.
- Do not place return, break, or continue statements inside block nodes.
- Use jump nodes only for break and continue.
- For conditional and loop nodes, predicates must be listed in evaluation order.
- Every entry node must include an arguments array, even when it is empty.
- Every block and jump node must include an explicit next field.
- For straight-line methods, the shape should normally be entry -> block -> exit.
- Do not emit disconnected helper blocks. If you create a side-effect block before a return, connect it to the synthetic return block or exit node.
- For for-style loops, either encode initialization/update on the loop node or represent them as normal blocks with explicit next edges. Never leave loop init/update blocks dangling.

Normalization rules:
- For non-void methods with multiple return sites, introduce block nodes that assign a synthetic variable such as "_return_value = ..." and then flow into the single exit node.
- The single exit node of a non-void method must return exactly one variable or literal.
- For void or None-returning methods, the single exit node must return an empty list.
- For "return;" in a void method, flow directly to the exit node instead of storing "return" inside a block.
- Preserve source-language syntax in statements where practical.

Example for a void straight-line method:
{
  "name": "basic",
  "returnType": "void",
  "parameters": [],
  "nodes": [
    {
      "id": "entry",
      "type": "entry",
      "arguments": [],
      "next": "body"
    },
    {
      "id": "body",
      "type": "block",
      "statements": ["x = 1", "print(x)"],
      "next": "exit"
    },
    {
      "id": "exit",
      "type": "exit",
      "returnValues": [],
      "next": null
    }
  ]
}
`.trim()

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

export function buildGenerationPrompt(method: DiscoveredMethod, language: string): string {
    return `
Generate a CFG draft for this single method.

Language: ${language}
Method name: ${method.name}
Declared return type: ${method.returnType}
Parameters: ${JSON.stringify(method.parameters, null, 2)}

Method source:
\`\`\`
${method.source}
\`\`\`

Focus only on this method's control flow. You do not need to reproduce surrounding file structure, imports, or unrelated methods.
`.trim()
}

export function buildRepairPrompt(method: DiscoveredMethod, language: string, previousDraft: CfgMethodDraft, errors: string[]): string {
    return `
Repair the CFG draft for this method.

Language: ${language}
Method name: ${method.name}
Declared return type: ${method.returnType}
Parameters: ${JSON.stringify(method.parameters, null, 2)}

Method source:
\`\`\`
${method.source}
\`\`\`

Previous CFG draft:
\`\`\`json
${JSON.stringify(previousDraft, null, 2)}
\`\`\`

Validation errors:
${errors.map((error, index) => `${index + 1}. ${error}`).join('\n')}

Return a corrected CFG draft that satisfies all validation errors and all core rules.
Do not restate the method source or add unrelated surrounding-file context.
`.trim()
}
