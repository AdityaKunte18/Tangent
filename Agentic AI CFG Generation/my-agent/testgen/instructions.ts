import { CoverageObjective, PytestCandidate } from './schema.js'
import { Parameter } from '../cfg/schema.js'

export const pytestGenerationInstruction = `
You generate exactly one pytest test function that targets a specific control-flow objective in a Python method.

Return JSON only. Do not include markdown, comments, explanations, or code fences.

Rules:
- Return an object with exactly two fields: "testName" and "code".
- "testName" must begin with "test_".
- "code" must contain exactly one pytest test function definition and no imports.
- The source module is already imported as the variable "module".
- You may use standard pytest asserts and the pytest fixture "capsys".
- Do not use file I/O, subprocesses, sockets, requests, pathlib writes, or environment mutation.
- Call the target method through "module.<methodName>(...)".
- Prefer exact assertions on return values or printed output when you can infer them confidently.
- If exact behavior is not inferable, create a coverage-driving execution test that still exercises the requested path without unexpected exceptions.
`.trim()

export const cppGenerationInstruction = `
You generate exactly one C++ test function that targets a specific control-flow objective in a C++ function.

Return JSON only. Do not include markdown, comments, explanations, or code fences.

Rules:
- Return an object with exactly two fields: "testName" and "code".
- "testName" must begin with "test_".
- "code" must contain exactly one C++ function with signature void test_<name>() and no includes.
- The source file is already included before the test function, so target functions are directly in scope.
- A generated main function will call your test function; do not define main().
- You may use assert(...), std::string, std::vector, std::ostringstream, and std::cout redirection for output checks.
- Do not use file I/O, subprocesses, sockets, threads, environment mutation, preprocessor directives, or filesystem APIs.
- Call the target function directly as <methodName>(...).
- Prefer exact assertions on return values or printed output when you can infer them confidently.
- If exact behavior is not inferable, create a coverage-driving execution test that still exercises the requested path without unexpected failures.
`.trim()

export const javaGenerationInstruction = `
You generate exactly one Java test method that targets a specific control-flow objective in a Java static method.

Return JSON only. Do not include markdown, comments, explanations, or code fences.

Rules:
- Return an object with exactly two fields: "testName" and "code".
- "testName" must begin with "test_".
- "code" must contain exactly one Java method with signature static void test_<name>() and no imports or class declaration.
- A generated main method will call your test method; do not define main().
- The source class is already compiled and available. Call the target method as <sourceClassName>.<methodName>(...).
- You may use Java assert statements, AssertionError, java.util collections, and fully-qualified standard library names.
- Do not use file I/O, subprocesses, sockets, threads, reflection, environment mutation, package declarations, or imports.
- Prefer exact assertions on return values or printed output when you can infer them confidently.
- If exact behavior is not inferable, create a coverage-driving execution test that still exercises the requested path without unexpected failures.
`.trim()

function formatParameters(parameters: Parameter[]): string {
    if (parameters.length === 0) {
        return '[]'
    }

    return JSON.stringify(parameters, null, 2)
}

function formatAcceptedTests(acceptedTests: Array<{ name: string; objectiveId: string }>): string {
    if (acceptedTests.length === 0) {
        return '[]'
    }

    return JSON.stringify(acceptedTests, null, 2)
}

function formatFailures(failures: string[]): string {
    if (failures.length === 0) {
        return '[]'
    }

    return JSON.stringify(failures, null, 2)
}

export function buildPytestCandidatePrompt(input: {
    methodName: string
    methodSource: string
    parameters: Parameter[]
    returnType: string
    objective: CoverageObjective
    cfgMethodSlice: unknown
    acceptedTests: Array<{ name: string; objectiveId: string }>
    recentFailures: string[]
}): string {
    return `
Generate one pytest candidate for a single uncovered control-flow objective.

Target method: ${input.methodName}
Return type: ${input.returnType}
Parameters: ${formatParameters(input.parameters)}

Target objective:
${JSON.stringify({
        id: input.objective.id,
        kind: input.objective.kind,
        branchOutcome: input.objective.branchOutcome ?? null,
        pathSketch: input.objective.pathSketch.summary
    }, null, 2)}

CFG method slice:
${JSON.stringify(input.cfgMethodSlice, null, 2)}

Current accepted tests:
${formatAcceptedTests(input.acceptedTests)}

Recent failed candidates and reasons:
${formatFailures(input.recentFailures)}

Method source:
\`\`\`python
${input.methodSource}
\`\`\`

Return exactly one pytest test function. The module under test is already imported as "module".
`.trim()
}

export function buildCppCandidatePrompt(input: {
    methodName: string
    methodSource: string
    parameters: Parameter[]
    returnType: string
    objective: CoverageObjective
    cfgMethodSlice: unknown
    acceptedTests: Array<{ name: string; objectiveId: string }>
    recentFailures: string[]
}): string {
    return `
Generate one C++ test candidate for a single uncovered control-flow objective.

Target function: ${input.methodName}
Return type: ${input.returnType}
Parameters: ${formatParameters(input.parameters)}

Target objective:
${JSON.stringify({
        id: input.objective.id,
        kind: input.objective.kind,
        branchOutcome: input.objective.branchOutcome ?? null,
        pathSketch: input.objective.pathSketch.summary
    }, null, 2)}

CFG method slice:
${JSON.stringify(input.cfgMethodSlice, null, 2)}

Current accepted tests:
${formatAcceptedTests(input.acceptedTests)}

Recent failed candidates and reasons:
${formatFailures(input.recentFailures)}

Function source:
\`\`\`cpp
${input.methodSource}
\`\`\`

Return exactly one C++ test function. The source file is already included and the target function is directly callable.
`.trim()
}

export function buildJavaCandidatePrompt(input: {
    methodName: string
    methodSource: string
    sourceClassName: string
    parameters: Parameter[]
    returnType: string
    objective: CoverageObjective
    cfgMethodSlice: unknown
    acceptedTests: Array<{ name: string; objectiveId: string }>
    recentFailures: string[]
}): string {
    return `
Generate one Java test candidate for a single uncovered control-flow objective.

Source class: ${input.sourceClassName}
Target method: ${input.methodName}
Return type: ${input.returnType}
Parameters: ${formatParameters(input.parameters)}

Target objective:
${JSON.stringify({
        id: input.objective.id,
        kind: input.objective.kind,
        branchOutcome: input.objective.branchOutcome ?? null,
        pathSketch: input.objective.pathSketch.summary
    }, null, 2)}

CFG method slice:
${JSON.stringify(input.cfgMethodSlice, null, 2)}

Current accepted tests:
${formatAcceptedTests(input.acceptedTests)}

Recent failed candidates and reasons:
${formatFailures(input.recentFailures)}

Method source:
\`\`\`java
${input.methodSource}
\`\`\`

Return exactly one Java test method. The target method must be called as ${input.sourceClassName}.${input.methodName}(...).
`.trim()
}
