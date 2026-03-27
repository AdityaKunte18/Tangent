import { CfgMethodDraft, DiscoveredMethod } from '../cfg/schema.js'

export const discoveryInstruction = `
You extract function and method definitions from a source file.

Return JSON only. Do not include markdown, comments, explanations, or code fences.

Requirements:
- Identify every function or method defined in the file.
- Preserve each method's source as a standalone code snippet in the original language.
- Preserve indentation and formatting in the source field.
- Infer the return type when it is implicit.
- If no methods exist, return an empty methods array.
- The language field should be your best guess such as "python", "c++", or "java".
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

export function buildDiscoveryPrompt(source: string, filename: string): string {
    return `
Analyze the following source file and extract every function or method definition.

Filename: ${filename}

Source file:
\`\`\`
${source}
\`\`\`
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
