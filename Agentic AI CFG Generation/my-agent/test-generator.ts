import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { InMemorySessionService, LlmAgent, Runner } from '@google/adk'
import { z } from 'zod'
import { readFileAtPath } from './tools/tooling.js'
import { discoverMethodsLocally } from './discovery/local-discovery.js'
import {
    FinalCfgDocument,
    FinalMethod,
    GenerateTestsForDocumentOptions,
    GenerateTestsForPathOptions,
    IterationHistoryEntry,
    ModuleCoverageSummary,
    TestGenerationLanguage,
    TestGenerationReport,
    TestGenerationResult,
    pytestCandidateSchema
} from './testgen/schema.js'
import {
    buildCppCandidatePrompt,
    buildJavaCandidatePrompt,
    buildPytestCandidatePrompt,
    cppGenerationInstruction,
    javaGenerationInstruction,
    pytestGenerationInstruction
} from './testgen/instructions.js'
import { augmentCfgDocumentWithSourceSpans, loadCfgDocumentFromPath, loadCfgDocumentFromString } from './testgen/cfg-loader.js'
import { enumerateCoverageObjectives, summarizeObjectiveCoverage } from './testgen/objectives.js'
import { createBaselineCoverageStatuses, summarizeCoverageFromRaw } from './testgen/coverage.js'
import { ensurePythonTestEnvironment, runPythonCoverageSuite, validatePythonTestCandidate } from './testgen/python-runner.js'
import { ensureCppTestEnvironment, runCppCoverageSuite, validateCppTestCandidate } from './testgen/cpp-runner.js'
import {
    ensureJavaTestEnvironment,
    getJavaGeneratedClassName,
    getJavaSourceClassName,
    runJavaCoverageSuite,
    validateJavaTestCandidate
} from './testgen/java-runner.js'
import { finalCfgDocumentSchema } from './cfg/schema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const defaultGeneratedTestsDir = path.join(__dirname, 'generated-tests')

const APP_NAME = 'CFG_TEST_GENERATION'
const USER_ID = 'user_1'
const MODEL_NAME = 'gemini-2.5-flash'
const MODEL_OUTPUT_KEY = 'structured_output'
const REQUEST_TIMEOUT_MS = Number(process.env.TESTGEN_REQUEST_TIMEOUT_MS ?? '60000')
const MAX_MODEL_ATTEMPTS = Number(process.env.TESTGEN_MODEL_CALL_MAX_ATTEMPTS ?? '2')
const MODEL_CALL_RETRY_BASE_DELAY_MS = 1_500
const MAX_CANDIDATES_PER_ROUND = Number(process.env.TESTGEN_CANDIDATES_PER_ROUND ?? '3')

const DEFAULT_MAX_ROUNDS = 12
const DEFAULT_MAX_ACCEPTED_TESTS = 20
const DEFAULT_MAX_NO_GAIN_ROUNDS = 3
const DEFAULT_MAX_CANDIDATES = 30

const sessionService = new InMemorySessionService()
interface StructuredAgentConfig {
    runner: Runner
    agentName: string
}

const PYTEST_AGENT_NAME = 'CFG_Python_Test_Generator'
const CPP_AGENT_NAME = 'CFG_Cpp_Test_Generator'
const JAVA_AGENT_NAME = 'CFG_Java_Test_Generator'

function createStructuredRunner(input: {
    agentName: string
    description: string
    instruction: string
}): Runner {
    return new Runner({
        appName: APP_NAME,
        agent: new LlmAgent({
            name: input.agentName,
            model: MODEL_NAME,
            description: input.description,
            instruction: input.instruction,
            includeContents: 'none',
            disallowTransferToParent: true,
            disallowTransferToPeers: true,
            outputSchema: pytestCandidateSchema,
            outputKey: MODEL_OUTPUT_KEY,
            generateContentConfig: {
                temperature: 0.2
            }
        }),
        sessionService
    })
}

const pytestRunner = createStructuredRunner({
    agentName: PYTEST_AGENT_NAME,
    description: 'Generates pytest tests that target a specific CFG coverage objective.',
    instruction: pytestGenerationInstruction
})
const cppRunner = createStructuredRunner({
    agentName: CPP_AGENT_NAME,
    description: 'Generates C++ tests that target a specific CFG coverage objective.',
    instruction: cppGenerationInstruction
})
const javaRunner = createStructuredRunner({
    agentName: JAVA_AGENT_NAME,
    description: 'Generates Java tests that target a specific CFG coverage objective.',
    instruction: javaGenerationInstruction
})

const agentConfigs: Record<TestGenerationLanguage, StructuredAgentConfig> = {
    python: {
        runner: pytestRunner,
        agentName: PYTEST_AGENT_NAME
    },
    'c++': {
        runner: cppRunner,
        agentName: CPP_AGENT_NAME
    },
    java: {
        runner: javaRunner,
        agentName: JAVA_AGENT_NAME
    }
}

let sessionCounter = 0

interface AcceptedTestRecord {
    name: string
    code: string
    objectiveId: string
    fingerprint: string
}

function createSessionId(prefix: string): string {
    sessionCounter += 1
    return `${prefix}_${String(sessionCounter).padStart(4, '0')}`
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    }

    return String(error)
}

function isRetriableModelError(error: unknown): boolean {
    const message = getErrorMessage(error).toLowerCase()
    return [
        'timed out',
        'timeout',
        'deadline',
        '429',
        'rate limit',
        'resource exhausted',
        'temporarily unavailable',
        'internal error',
        'fetch failed',
        'connection reset',
        'socket',
        'network',
        'empty response',
        'json',
        'parse'
    ].some((token) => message.includes(token))
}

function extractJsonFromText(raw: string): unknown {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
        throw new Error('empty response')
    }

    const withoutFence = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()

    try {
        return JSON.parse(withoutFence)
    } catch {
        const firstBrace = withoutFence.indexOf('{')
        const lastBrace = withoutFence.lastIndexOf('}')
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1))
        }
    }

    throw new Error(`Unable to parse JSON from model response: ${raw}`)
}

async function runStructuredAgent<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    sessionPrefix: string,
    agentConfig: StructuredAgentConfig
): Promise<T> {
    const sessionId = createSessionId(sessionPrefix)
    await sessionService.createSession({
        appName: APP_NAME,
        userId: USER_ID,
        sessionId
    })

    const agentName = agentConfig.agentName
    const collectResponse = async (): Promise<T> => {
        let rawText = ''
        let streamedStructuredOutput: unknown
        let agentError: Error | null = null

        const stream = agentConfig.runner.runAsync({
            userId: USER_ID,
            sessionId,
            newMessage: {
                role: 'user',
                parts: [{ text: prompt }]
            }
        })

        for await (const event of stream) {
            if (event.errorMessage) {
                const code = event.errorCode ? `${event.errorCode}: ` : ''
                agentError = new Error(`${code}${event.errorMessage}`)
            }

            const stateDelta = event.actions?.stateDelta
            if (stateDelta && MODEL_OUTPUT_KEY in stateDelta) {
                streamedStructuredOutput = stateDelta[MODEL_OUTPUT_KEY]
            }

            if (event.author !== agentName || !event.content?.parts) {
                continue
            }

            for (const part of event.content.parts) {
                if (part.text) {
                    rawText += part.text
                }
            }
        }

        if (agentError) {
            throw agentError
        }

        const session = await sessionService.getSession({
            appName: APP_NAME,
            userId: USER_ID,
            sessionId
        })
        const structuredState = streamedStructuredOutput ?? session?.state[MODEL_OUTPUT_KEY]
        const parsedValue = structuredState == null
            ? extractJsonFromText(rawText)
            : (typeof structuredState === 'string'
                ? extractJsonFromText(structuredState)
                : structuredState)
        return schema.parse(parsedValue)
    }

    let timeoutHandle: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms while waiting for ${agentName} (${sessionId}).`))
        }, REQUEST_TIMEOUT_MS)
    })

    try {
        return await Promise.race([collectResponse(), timeoutPromise])
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle)
        }
    }
}

async function runStructuredAgentWithRetries<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    sessionPrefix: string,
    agentConfig: StructuredAgentConfig
): Promise<T> {
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
        try {
            return await runStructuredAgent(prompt, schema, sessionPrefix, agentConfig)
        } catch (error) {
            lastError = error

            if (!isRetriableModelError(error) || attempt >= MAX_MODEL_ATTEMPTS) {
                throw error
            }

            await sleep(MODEL_CALL_RETRY_BASE_DELAY_MS * attempt)
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('Unable to generate a pytest candidate.')
}

function loadCfgDocument(options: GenerateTestsForDocumentOptions | GenerateTestsForPathOptions): FinalCfgDocument {
    if ('cfgPath' in options) {
        return loadCfgDocumentFromPath(options.cfgPath, options.sourcePath)
    }

    if (typeof options.cfgDocument === 'string') {
        return loadCfgDocumentFromString(options.cfgDocument, options.sourcePath)
    }

    return augmentCfgDocumentWithSourceSpans(finalCfgDocumentSchema.parse(options.cfgDocument), options.sourcePath)
}

function getSourceMethodMap(
    sourcePath: string,
    language: TestGenerationLanguage
): Map<string, ReturnType<typeof discoverMethodsLocally>['methods'][number]> {
    const sourceFile = readFileAtPath(sourcePath)
    const discovery = discoverMethodsLocally(sourceFile)

    if (discovery.language !== language) {
        throw new Error(`Test generation requested '${language}', but '${sourcePath}' resolved to language '${discovery.language}'.`)
    }

    return new Map(discovery.methods.map((method) => [method.name, method]))
}

function buildGeneratedPythonTestModule(sourcePath: string, acceptedTests: AcceptedTestRecord[]): string {
    const placeholder = acceptedTests.length === 0
        ? '\n\ndef test_generated_placeholder():\n    assert True\n'
        : `\n\n${acceptedTests.map((test) => test.code.trim()).join('\n\n')}\n`

    return `import importlib.util
import pathlib
import sys
import pytest

SOURCE_PATH = pathlib.Path(r"${sourcePath}")
MODULE_NAME = SOURCE_PATH.stem + "_under_test"
_spec = importlib.util.spec_from_file_location(MODULE_NAME, SOURCE_PATH)
assert _spec is not None and _spec.loader is not None
module = importlib.util.module_from_spec(_spec)
sys.modules[MODULE_NAME] = module
_spec.loader.exec_module(module)${placeholder}`
}

function buildGeneratedCppTestModule(sourcePath: string, acceptedTests: AcceptedTestRecord[]): string {
    const tests = acceptedTests.length === 0
        ? ''
        : `\n\n${acceptedTests.map((test) => test.code.trim()).join('\n\n')}\n`
    const calls = acceptedTests.map((test) => `    ${test.name}();`).join('\n')

    return `#include <cassert>
#include <cmath>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#define main __cfg_source_main
#include ${JSON.stringify(sourcePath)}
#undef main${tests}

int main() {
${calls}
    return 0;
}
`
}

function buildGeneratedJavaTestModule(testFilePath: string, acceptedTests: AcceptedTestRecord[]): string {
    const className = getJavaGeneratedClassName(testFilePath)
    const tests = acceptedTests.length === 0
        ? ''
        : `\n\n${acceptedTests.map((test) => test.code.trim()).join('\n\n')}\n`
    const calls = acceptedTests.map((test) => `        ${test.name}();`).join('\n')

    return `import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class ${className} {${tests}

    public static void main(String[] args) throws Exception {
${calls}
    }
}
`
}

function buildGeneratedTestModule(
    testFilePath: string,
    sourcePath: string,
    acceptedTests: AcceptedTestRecord[],
    language: TestGenerationLanguage
): string {
    if (language === 'python') {
        return buildGeneratedPythonTestModule(sourcePath, acceptedTests)
    }

    if (language === 'java') {
        return buildGeneratedJavaTestModule(testFilePath, acceptedTests)
    }

    return buildGeneratedCppTestModule(sourcePath, acceptedTests)
}

function writeGeneratedTestModule(
    testFilePath: string,
    sourcePath: string,
    acceptedTests: AcceptedTestRecord[],
    language: TestGenerationLanguage
): void {
    fs.mkdirSync(path.dirname(testFilePath), { recursive: true })
    fs.writeFileSync(testFilePath, buildGeneratedTestModule(testFilePath, sourcePath, acceptedTests, language), 'utf-8')
}

function coverageImproved(before: ModuleCoverageSummary, after: ModuleCoverageSummary): boolean {
    if (after.coveredObjectiveIds.length !== before.coveredObjectiveIds.length) {
        return after.coveredObjectiveIds.length > before.coveredObjectiveIds.length
    }

    if (after.branchCoverage.covered !== before.branchCoverage.covered) {
        return after.branchCoverage.covered > before.branchCoverage.covered
    }

    return after.statementCoverage.covered > before.statementCoverage.covered
}

function selectNextObjective(objectives: ReturnType<typeof enumerateCoverageObjectives>, currentSummary: ModuleCoverageSummary) {
    const uncovered = new Set(currentSummary.uncoveredObjectiveIds)
    return objectives.find((objective) => objective.attributable && uncovered.has(objective.id)) ?? null
}

function sanitizeBaseName(filepath: string): string {
    return path.basename(filepath, path.extname(filepath)).replace(/[^A-Za-z0-9_]+/g, '_')
}

function getGeneratedTestExtension(language: TestGenerationLanguage): string {
    switch (language) {
        case 'python':
            return 'py'
        case 'java':
            return 'java'
        case 'c++':
            return 'cpp'
    }
}

function summarizeCoverageFromStatuses(
    methods: FinalMethod[],
    objectives: ReturnType<typeof enumerateCoverageObjectives>,
    statuses: ReturnType<typeof createBaselineCoverageStatuses>
): ModuleCoverageSummary {
    return summarizeObjectiveCoverage(methods, objectives, statuses)
}

async function ensureTestEnvironment(language: TestGenerationLanguage): Promise<void> {
    if (language === 'python') {
        await ensurePythonTestEnvironment()
        return
    }

    if (language === 'java') {
        await ensureJavaTestEnvironment()
        return
    }

    await ensureCppTestEnvironment()
}

function buildCandidatePrompt(input: {
    language: TestGenerationLanguage
    sourceClassName: string | null
    methodName: string
    methodSource: string
    parameters: ReturnType<typeof discoverMethodsLocally>['methods'][number]['parameters']
    returnType: string
    objective: ReturnType<typeof enumerateCoverageObjectives>[number]
    cfgMethodSlice: FinalMethod
    acceptedTests: Array<{ name: string; objectiveId: string }>
    recentFailures: string[]
}): string {
    const promptInput = {
        methodName: input.methodName,
        methodSource: input.methodSource,
        parameters: input.parameters,
        returnType: input.returnType,
        objective: input.objective,
        cfgMethodSlice: input.cfgMethodSlice,
        acceptedTests: input.acceptedTests,
        recentFailures: input.recentFailures
    }

    if (input.language === 'python') {
        return buildPytestCandidatePrompt(promptInput)
    }

    if (input.language === 'java') {
        if (!input.sourceClassName) {
            throw new Error('Java test generation requires a source class name.')
        }

        return buildJavaCandidatePrompt({
            ...promptInput,
            sourceClassName: input.sourceClassName
        })
    }

    return buildCppCandidatePrompt(promptInput)
}

async function validateTestCandidate(
    language: TestGenerationLanguage,
    code: string,
    targetMethod: string,
    sourceClassName: string | null
) {
    if (language === 'python') {
        return validatePythonTestCandidate(code, targetMethod)
    }

    if (language === 'java') {
        if (!sourceClassName) {
            throw new Error('Java candidate validation requires a source class name.')
        }

        return validateJavaTestCandidate(code, targetMethod, sourceClassName)
    }

    return validateCppTestCandidate(code, targetMethod)
}

async function runCoverageSuite(input: {
    language: TestGenerationLanguage
    sourcePath: string
    testFilePath: string
    coverageJsonPath: string
    workingDir: string
    objectives: ReturnType<typeof enumerateCoverageObjectives>
}) {
    if (input.language === 'python') {
        return runPythonCoverageSuite({
            testFilePath: input.testFilePath,
            coverageJsonPath: input.coverageJsonPath,
            workingDir: input.workingDir
        })
    }

    if (input.language === 'java') {
        return runJavaCoverageSuite({
            sourcePath: input.sourcePath,
            testFilePath: input.testFilePath,
            coverageJsonPath: input.coverageJsonPath,
            workingDir: input.workingDir,
            objectives: input.objectives
        })
    }

    return runCppCoverageSuite({
            sourcePath: input.sourcePath,
            testFilePath: input.testFilePath,
            coverageJsonPath: input.coverageJsonPath,
            workingDir: input.workingDir
        })
}

function formatSuiteFailure(runResult: Awaited<ReturnType<typeof runCoverageSuite>>): string {
    const compileStderr = 'compileStderr' in runResult && typeof runResult.compileStderr === 'string'
        ? runResult.compileStderr
        : ''
    return [
        runResult.stderr,
        compileStderr,
        runResult.coverageStderr
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? ''
}

export async function generateTestsForDocument(options: GenerateTestsForDocumentOptions): Promise<TestGenerationResult> {
    await ensureTestEnvironment(options.language)

    const resolvedSourcePath = path.resolve(options.sourcePath)
    const document = loadCfgDocument(options)
    const methods = document.methods.map((envelope) => envelope.method)
    const objectives = methods.flatMap((method) => enumerateCoverageObjectives(method))
    const baselineStatuses = createBaselineCoverageStatuses(objectives)
    let currentSummary = summarizeCoverageFromStatuses(methods, objectives, baselineStatuses)
    const coverageBefore = currentSummary
    let currentCoverageRaw: unknown = { files: {} }

    const outDir = path.resolve(options.outDir ?? defaultGeneratedTestsDir)
    const baseName = sanitizeBaseName(resolvedSourcePath)
    const generatedTestPath = path.join(outDir, `${baseName}_generated_test.${getGeneratedTestExtension(options.language)}`)
    const rawCoveragePath = path.join(outDir, `${baseName}_coverage.json`)
    const reportPath = path.join(outDir, `${baseName}_report.json`)
    const methodMap = getSourceMethodMap(resolvedSourcePath, options.language)
    const sourceClassName = options.language === 'java'
        ? getJavaSourceClassName(readFileAtPath(resolvedSourcePath).contents, path.basename(resolvedSourcePath, path.extname(resolvedSourcePath)))
        : null
    const acceptedTests: AcceptedTestRecord[] = []
    const rejectedCandidateReasons: string[] = []
    const iterationHistory: IterationHistoryEntry[] = []
    const seenFingerprints = new Set<string>()

    const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS
    const maxAcceptedTests = options.maxAcceptedTests ?? DEFAULT_MAX_ACCEPTED_TESTS
    const maxNoGainRounds = options.maxNoGainRounds ?? DEFAULT_MAX_NO_GAIN_ROUNDS
    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES

    let noGainRounds = 0
    let totalCandidates = 0

    for (let round = 1; round <= maxRounds; round += 1) {
        if (acceptedTests.length >= maxAcceptedTests || totalCandidates >= maxCandidates) {
            break
        }

        const targetObjective = selectNextObjective(objectives, currentSummary)
        if (!targetObjective) {
            break
        }

        const method = methods.find((candidate) => candidate.id === targetObjective.methodId)
        const discoveredMethod = methodMap.get(targetObjective.methodName)
        if (!method || !discoveredMethod) {
            throw new Error(`Unable to locate source method '${targetObjective.methodName}' for CFG objective '${targetObjective.id}'.`)
        }

        let acceptedThisRound = false

        for (let candidateIndex = 0; candidateIndex < MAX_CANDIDATES_PER_ROUND; candidateIndex += 1) {
            if (totalCandidates >= maxCandidates) {
                break
            }

            totalCandidates += 1

            const candidate = await runStructuredAgentWithRetries(
                buildCandidatePrompt({
                    language: options.language,
                    sourceClassName,
                    methodName: discoveredMethod.name,
                    methodSource: discoveredMethod.source,
                    parameters: discoveredMethod.parameters,
                    returnType: discoveredMethod.returnType,
                    objective: targetObjective,
                    cfgMethodSlice: method,
                    acceptedTests: acceptedTests.map((test) => ({
                        name: test.name,
                        objectiveId: test.objectiveId
                    })),
                    recentFailures: rejectedCandidateReasons.slice(-5)
                }),
                pytestCandidateSchema,
                options.language === 'python' ? 'pytest' : options.language,
                agentConfigs[options.language]
            )

            const validation = await validateTestCandidate(options.language, candidate.code, discoveredMethod.name, sourceClassName)

            if (!validation.valid) {
                const reason = `Rejected ${candidate.testName}: ${validation.errors.join(' | ')}`
                rejectedCandidateReasons.push(reason)
                iterationHistory.push({
                    round,
                    targetObjectiveId: targetObjective.id,
                    targetMethodName: targetObjective.methodName,
                    candidateName: candidate.testName,
                    accepted: false,
                    reason
                })
                continue
            }

            if (validation.fingerprint && seenFingerprints.has(validation.fingerprint)) {
                const reason = `Rejected ${candidate.testName}: duplicate candidate fingerprint.`
                rejectedCandidateReasons.push(reason)
                iterationHistory.push({
                    round,
                    targetObjectiveId: targetObjective.id,
                    targetMethodName: targetObjective.methodName,
                    candidateName: candidate.testName,
                    accepted: false,
                    reason
                })
                continue
            }

            const pendingAcceptedTests = [
                ...acceptedTests,
                {
                    name: candidate.testName,
                    code: candidate.code,
                    objectiveId: targetObjective.id,
                    fingerprint: validation.fingerprint ?? candidate.testName
                }
            ]

            writeGeneratedTestModule(generatedTestPath, resolvedSourcePath, pendingAcceptedTests, options.language)
            const runResult = await runCoverageSuite({
                language: options.language,
                sourcePath: resolvedSourcePath,
                testFilePath: generatedTestPath,
                coverageJsonPath: rawCoveragePath,
                workingDir: outDir,
                objectives
            })

            if (!runResult.ok || !runResult.rawCoverage) {
                const reason = `Rejected ${candidate.testName}: test/coverage execution failed (${runResult.exitCode}). ${formatSuiteFailure(runResult)}`.trim()
                rejectedCandidateReasons.push(reason)
                iterationHistory.push({
                    round,
                    targetObjectiveId: targetObjective.id,
                    targetMethodName: targetObjective.methodName,
                    candidateName: candidate.testName,
                    accepted: false,
                    reason
                })
                continue
            }

            const { statuses, summary } = summarizeCoverageFromRaw(methods, objectives, runResult.rawCoverage, resolvedSourcePath)
            const targetCovered = statuses.get(targetObjective.id)?.covered === true
            const improved = coverageImproved(currentSummary, summary)

            if (!targetCovered && !improved) {
                const reason = `Rejected ${candidate.testName}: test passed but did not improve coverage or cover ${targetObjective.id}.`
                rejectedCandidateReasons.push(reason)
                iterationHistory.push({
                    round,
                    targetObjectiveId: targetObjective.id,
                    targetMethodName: targetObjective.methodName,
                    candidateName: candidate.testName,
                    accepted: false,
                    reason
                })
                continue
            }

            acceptedTests.push({
                name: candidate.testName,
                code: candidate.code,
                objectiveId: targetObjective.id,
                fingerprint: validation.fingerprint ?? candidate.testName
            })

            if (validation.fingerprint) {
                seenFingerprints.add(validation.fingerprint)
            }

            currentSummary = summary
            currentCoverageRaw = runResult.rawCoverage
            acceptedThisRound = true
            iterationHistory.push({
                round,
                targetObjectiveId: targetObjective.id,
                targetMethodName: targetObjective.methodName,
                candidateName: candidate.testName,
                accepted: true,
                reason: targetCovered
                    ? `Accepted ${candidate.testName}: covered target objective ${targetObjective.id}.`
                    : `Accepted ${candidate.testName}: increased overall coverage.`
            })
            break
        }

        if (acceptedThisRound) {
            noGainRounds = 0
        } else {
            noGainRounds += 1
            if (noGainRounds >= maxNoGainRounds) {
                break
            }
        }
    }

    writeGeneratedTestModule(generatedTestPath, resolvedSourcePath, acceptedTests, options.language)
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(rawCoveragePath, JSON.stringify(currentCoverageRaw, null, 2), 'utf-8')

    const report: TestGenerationReport = {
        sourcePath: resolvedSourcePath,
        generatedTestPath,
        coverageBefore,
        coverageAfter: currentSummary,
        acceptedCandidateCount: acceptedTests.length,
        rejectedCandidateCount: rejectedCandidateReasons.length,
        acceptedTestNames: acceptedTests.map((test) => test.name),
        iterationHistory,
        failedCandidateReasons: rejectedCandidateReasons
    }

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')

    return {
        generatedTestPath,
        reportPath,
        rawCoveragePath,
        coverageBefore,
        coverageAfter: currentSummary,
        perMethod: currentSummary.methods,
        acceptedCandidateCount: acceptedTests.length,
        rejectedCandidateCount: rejectedCandidateReasons.length,
        iterationHistory,
        failedCandidateReasons: rejectedCandidateReasons
    }
}

export async function generateTestsForPath(options: GenerateTestsForPathOptions): Promise<TestGenerationResult> {
    return generateTestsForDocument({
        ...options,
        cfgDocument: loadCfgDocumentFromPath(options.cfgPath, options.sourcePath)
    })
}
