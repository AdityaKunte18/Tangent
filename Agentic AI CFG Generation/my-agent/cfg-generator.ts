import 'dotenv/config'
import path from 'node:path'
import { InMemorySessionService, LlmAgent, Runner } from '@google/adk'
import { z } from 'zod'
import { exportCfgDocument } from './cfg/export.js'
import {
    cfgDraftSchema,
    CfgMethodDraft,
    discoveryResultSchema,
    DiscoveryResult,
    DiscoveredMethod
} from './cfg/schema.js'
import { finalizeDocument } from './cfg/finalize.js'
import { normalizeDraft } from './cfg/normalize.js'
import { validateMethodDraft } from './cfg/validate.js'
import { discoverMethodsLocally } from './discovery/local-discovery.js'
import {
    buildDiscoveryPrompt,
    buildGenerationPrompt,
    buildRepairPrompt,
    cfgGenerationInstruction,
    discoveryInstruction
} from './instructions/instructions.js'
import { exportfile, Export, File, readfiles, readFileAtPath } from './tools/tooling.js'

const APP_NAME = 'CFG_GENERATION'
const USER_ID = 'user_1'
const MODEL_NAME = 'gemini-2.5-flash'
const MAX_CFG_ATTEMPTS = 4
const MODEL_OUTPUT_KEY = 'structured_output'
const REQUEST_TIMEOUT_MS = 90_000
const MODEL_CALL_MAX_ATTEMPTS = 3
const MODEL_CALL_RETRY_BASE_DELAY_MS = 1_500
const DISCOVERY_CHUNK_LINES = Number(process.env.CFG_DISCOVERY_CHUNK_LINES ?? '40')
const DISCOVERY_CHUNK_OVERLAP_LINES = Number(process.env.CFG_DISCOVERY_CHUNK_OVERLAP_LINES ?? '10')
const MIN_DISCOVERY_CHUNK_LINES = Number(process.env.CFG_MIN_DISCOVERY_CHUNK_LINES ?? '12')

let sessionCounter = 0

export interface GenerateCfgFromSourceInput {
    filename: string
    contents: string
    extention?: string
    language?: string
}

export interface BatchRunResult {
    processedFiles: string[]
    failedFiles: string[]
}

interface DiscoveryChunk {
    startLine: number
    endLine: number
    numberedSource: string
}

interface ChunkDiscoveryResult {
    chunk: DiscoveryChunk
    discovery: DiscoveryResult
}

function createSessionId(prefix: string): string {
    sessionCounter += 1
    return `${prefix}_${String(sessionCounter).padStart(4, '0')}`
}

export function inferLanguageFromExtension(extention: string): string {
    switch (extention) {
        case '.py':
            return 'python'
        case '.c':
            return 'c'
        case '.cpp':
            return 'c++'
        case '.java':
            return 'java'
        default:
            return 'unknown'
    }
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
        'unavailable',
        'internal error',
        'internal server error',
        'network',
        'socket',
        'fetch failed',
        'connection reset',
        'econnreset',
        'etimedout',
        'eai_again',
        'empty response',
        'unable to parse json',
        'unexpected token',
        'json',
        'parse'
    ].some((token) => message.includes(token))
}

function splitLines(source: string): string[] {
    return source.split('\n')
}

function createChunk(lines: string[], startLine: number, endLine: number): DiscoveryChunk {
    const boundedStartLine = Math.max(1, startLine)
    const boundedEndLine = Math.min(lines.length, endLine)
    const numberedSource = lines
        .slice(boundedStartLine - 1, boundedEndLine)
        .map((line, index) => `${boundedStartLine + index}: ${line}`)
        .join('\n')

    return {
        startLine: boundedStartLine,
        endLine: boundedEndLine,
        numberedSource
    }
}

function createDiscoveryChunks(source: string): DiscoveryChunk[] {
    const lines = splitLines(source)
    const chunkSize = Math.max(1, DISCOVERY_CHUNK_LINES)
    const overlap = Math.max(0, Math.min(DISCOVERY_CHUNK_OVERLAP_LINES, chunkSize - 1))
    const step = Math.max(1, chunkSize - overlap)
    const chunks: DiscoveryChunk[] = []

    for (let startIndex = 0; startIndex < lines.length; startIndex += step) {
        const endIndex = Math.min(lines.length, startIndex + chunkSize)
        chunks.push(createChunk(lines, startIndex + 1, endIndex))

        if (endIndex >= lines.length) {
            break
        }
    }

    return chunks
}

function extractSourceByLineRange(source: string, startLine: number, endLine: number): string {
    const lines = splitLines(source)

    if (startLine < 1 || endLine < startLine || endLine > lines.length) {
        throw new Error(`Invalid method line range ${startLine}-${endLine}.`)
    }

    return lines.slice(startLine - 1, endLine).join('\n').trimEnd()
}

function inferDominantLanguage(results: DiscoveryResult[], fallbackLanguage: string): string {
    const counts = new Map<string, number>()

    for (const result of results) {
        const language = result.language.trim().toLowerCase()
        if (language.length === 0) {
            continue
        }

        counts.set(language, (counts.get(language) ?? 0) + 1)
    }

    const dominantLanguage = [...counts.entries()]
        .sort((left, right) => right[1] - left[1])[0]?.[0]

    return dominantLanguage ?? fallbackLanguage
}

function chunkLineCount(chunk: DiscoveryChunk): number {
    return chunk.endLine - chunk.startLine + 1
}

function splitDiscoveryChunk(lines: string[], chunk: DiscoveryChunk): DiscoveryChunk[] {
    const size = chunkLineCount(chunk)
    if (size <= 1) {
        return [chunk]
    }

    const midpoint = Math.floor((chunk.startLine + chunk.endLine) / 2)
    const splitOverlap = Math.max(2, Math.min(DISCOVERY_CHUNK_OVERLAP_LINES, Math.floor(size / 4)))
    const left = createChunk(lines, chunk.startLine, Math.min(lines.length, midpoint + splitOverlap))
    const right = createChunk(lines, Math.max(chunk.startLine + 1, midpoint - splitOverlap + 1), chunk.endLine)

    if (
        left.startLine === chunk.startLine &&
        left.endLine === chunk.endLine &&
        right.startLine === chunk.startLine &&
        right.endLine === chunk.endLine
    ) {
        return [chunk]
    }

    if (left.startLine === right.startLine && left.endLine === right.endLine) {
        return [left]
    }

    return [left, right]
}

async function discoverChunkWithFallback(
    file: File,
    lines: string[],
    chunk: DiscoveryChunk
): Promise<ChunkDiscoveryResult[]> {
    try {
        const discovery = await runStructuredAgentWithRetries(
            discoveryRunner,
            discoveryAgent.name,
            buildDiscoveryPrompt(chunk.numberedSource, file.filepath, chunk.startLine, chunk.endLine),
            discoveryResultSchema,
            'discover',
            MODEL_CALL_MAX_ATTEMPTS
        )

        return [{ chunk, discovery }]
    } catch (error) {
        const size = chunkLineCount(chunk)
        const canSplit = size > Math.max(1, MIN_DISCOVERY_CHUNK_LINES)

        if (!canSplit || !isRetriableModelError(error)) {
            throw error
        }

        console.warn(
            `Discovery failed for ${file.filepath} chunk ${chunk.startLine}-${chunk.endLine}: ${getErrorMessage(error)}. Splitting chunk.`
        )

        const splitChunks = splitDiscoveryChunk(lines, chunk)
        if (splitChunks.length <= 1) {
            throw error
        }

        const nestedResults: ChunkDiscoveryResult[] = []
        for (const splitChunk of splitChunks) {
            const results = await discoverChunkWithFallback(file, lines, splitChunk)
            nestedResults.push(...results)
        }

        return nestedResults
    }
}

async function discoverMethods(file: File): Promise<{
    language: string
    methods: DiscoveredMethod[]
}> {
    const localDiscovery = discoverMethodsLocally(file)
    if (localDiscovery.methods.length > 0) {
        return localDiscovery
    }

    const lines = splitLines(file.contents)
    const chunks = createDiscoveryChunks(file.contents)
    const chunkResults: DiscoveryResult[] = []
    const discoveredMethodMap = new Map<string, DiscoveredMethod>()

    for (const chunk of chunks) {
        const discoveries = await discoverChunkWithFallback(file, lines, chunk)

        for (const { chunk: resolvedChunk, discovery } of discoveries) {
            chunkResults.push(discovery)

            for (const method of discovery.methods) {
                if (method.startLine < resolvedChunk.startLine || method.startLine > resolvedChunk.endLine) {
                    continue
                }

                if (method.endLine > resolvedChunk.endLine || method.endLine < method.startLine) {
                    continue
                }

                const key = `${method.name}|${method.startLine}|${method.endLine}`
                if (discoveredMethodMap.has(key)) {
                    continue
                }

                try {
                    discoveredMethodMap.set(key, {
                        ...method,
                        source: extractSourceByLineRange(file.contents, method.startLine, method.endLine)
                    })
                } catch (error) {
                    console.warn(
                        `Skipping invalid discovered method '${method.name}' in ${file.filepath}: ${getErrorMessage(error)}`
                    )
                }
            }
        }
    }

    const methods = [...discoveredMethodMap.values()]
        .sort((left, right) => left.startLine - right.startLine)

    return {
        language: inferDominantLanguage(chunkResults, inferLanguageFromExtension(file.extention)),
        methods
    }
}

const discoveryAgent = new LlmAgent({
    name: 'CFG_Discovery_Agent',
    model: MODEL_NAME,
    description: 'Discovers functions and methods inside a source file.',
    instruction: discoveryInstruction,
    includeContents: 'none',
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    outputSchema: discoveryResultSchema,
    outputKey: MODEL_OUTPUT_KEY,
    generateContentConfig: {
        temperature: 0
    }
})

const cfgAgent = new LlmAgent({
    name: 'CFG_Generation_Agent',
    model: MODEL_NAME,
    description: 'Generates validated CFG drafts for one method at a time.',
    instruction: cfgGenerationInstruction,
    includeContents: 'none',
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    outputSchema: cfgDraftSchema,
    outputKey: MODEL_OUTPUT_KEY,
    generateContentConfig: {
        temperature: 0
    }
})

const sessionService = new InMemorySessionService()

const discoveryRunner = new Runner({
    agent: discoveryAgent,
    appName: APP_NAME,
    sessionService
})

const cfgRunner = new Runner({
    agent: cfgAgent,
    appName: APP_NAME,
    sessionService
})

async function runStructuredAgent<T>(runner: Runner, agentName: string, prompt: string, schema: z.ZodSchema<T>, sessionPrefix: string): Promise<T> {
    const sessionId = createSessionId(sessionPrefix)
    await sessionService.createSession({
        appName: APP_NAME,
        userId: USER_ID,
        sessionId
    })

    const collectResponse = async (): Promise<T> => {
        let rawText = ''
        let streamedStructuredOutput: unknown
        let agentError: Error | null = null

        const stream = runner.runAsync({
            userId: USER_ID,
            sessionId,
            newMessage: {
                role: 'user',
                parts: [
                    {
                        text: prompt
                    }
                ]
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
        const parsedValue = structuredState ?? extractJsonFromText(rawText)
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
    runner: Runner,
    agentName: string,
    prompt: string,
    schema: z.ZodSchema<T>,
    sessionPrefix: string,
    maxAttempts: number
): Promise<T> {
    let lastError: unknown

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await runStructuredAgent(runner, agentName, prompt, schema, sessionPrefix)
        } catch (error) {
            lastError = error

            if (!isRetriableModelError(error) || attempt === maxAttempts) {
                throw error
            }

            const retryDelayMs = MODEL_CALL_RETRY_BASE_DELAY_MS * attempt
            console.warn(
                `${agentName} call attempt ${attempt}/${maxAttempts} failed with a retriable error: ${getErrorMessage(error)}`
            )
            console.warn(`Retrying ${agentName} in ${retryDelayMs}ms...`)
            await sleep(retryDelayMs)
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error(`Unable to complete ${agentName} request after ${maxAttempts} attempts.`)
}

async function generateValidatedCfg(method: DiscoveredMethod, language: string): Promise<CfgMethodDraft> {
    let prompt = buildGenerationPrompt(method, language)
    let previousDraft: CfgMethodDraft | null = null

    for (let attempt = 1; attempt <= MAX_CFG_ATTEMPTS; attempt++) {
        const draft = normalizeDraft(method, await runStructuredAgentWithRetries(
            cfgRunner,
            cfgAgent.name,
            prompt,
            cfgDraftSchema,
            'cfg',
            MODEL_CALL_MAX_ATTEMPTS
        ))

        const validation = validateMethodDraft(draft)
        if (validation.valid) {
            return draft
        }

        previousDraft = draft
        prompt = buildRepairPrompt(method, language, draft, validation.errors)
        console.warn(`Attempt ${attempt} for method '${method.name}' failed validation: ${validation.errors.join(' | ')}`)
    }

    throw new Error(`Failed to generate a valid CFG for method '${method.name}' after ${MAX_CFG_ATTEMPTS} attempts. Last draft: ${JSON.stringify(previousDraft, null, 2)}`)
}

export async function generateCfgForFile(file: File, languageOverride?: string): Promise<string> {
    const discovery = await discoverMethods(file)

    const language = languageOverride?.trim().length
        ? languageOverride
        : (discovery.language.trim().length > 0
            ? discovery.language
            : inferLanguageFromExtension(file.extention))

    const drafts: CfgMethodDraft[] = []

    for (const [index, method] of discovery.methods.entries()) {
        console.log(`Generating CFG for ${file.filepath} :: ${method.name} (${index + 1}/${discovery.methods.length})`)
        const draft = await generateValidatedCfg(method, language)
        drafts.push(draft)
    }

    return exportCfgDocument(finalizeDocument(drafts))
}

export async function generateCfgFromSource(input: GenerateCfgFromSourceInput): Promise<string> {
    const extention = input.extention?.toLocaleLowerCase()
        ?? path.extname(input.filename).toLocaleLowerCase()

    const file: File = {
        filepath: path.basename(input.filename),
        extention,
        contents: input.contents.replace(/\r\n?/g, '\n')
    }

    return generateCfgForFile(file, input.language)
}

export async function generateCfgForPath(filepath: string, languageOverride?: string): Promise<string> {
    return generateCfgForFile(readFileAtPath(filepath), languageOverride)
}

export async function runBatchFromInputDirectory(): Promise<BatchRunResult> {
    console.log('starting program')
    const files = readfiles()
    console.log('files read')
    console.log(files.length)
    const processedFiles: string[] = []
    const failedFiles: string[] = []

    for (const file of files) {
        console.log(`Processing ${file.filepath} (${file.contents.length} chars)...`)

        try {
            const output = await generateCfgForFile(file)
            console.log('Processing complete')
            console.log('Saving results')

            const exportData: Export = {
                name: file.filepath,
                data: output
            }
            exportfile(exportData)
            processedFiles.push(file.filepath)
        } catch (error) {
            failedFiles.push(file.filepath)
            console.error(`Failed to process ${file.filepath}`)
            console.error(error)
        }
    }

    return {
        processedFiles,
        failedFiles
    }
}
