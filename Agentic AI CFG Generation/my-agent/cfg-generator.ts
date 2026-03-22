import 'dotenv/config'
import path from 'node:path'
import { InMemorySessionService, LlmAgent, Runner } from '@google/adk'
import { z } from 'zod'
import { exportCfgDocument } from './cfg/export.js'
import {
    cfgDraftSchema,
    CfgMethodDraft,
    discoveryResultSchema,
    DiscoveredMethod
} from './cfg/schema.js'
import { finalizeDocument } from './cfg/finalize.js'
import { normalizeDraft } from './cfg/normalize.js'
import { validateMethodDraft } from './cfg/validate.js'
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
        case '.java':
            return 'java'
        default:
            return 'unknown'
    }
}

function extractJsonFromText(raw: string): unknown {
    const trimmed = raw.trim()

    if (trimmed.length === 0) {
        throw new Error('Model returned an empty response.')
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
        'eai_again'
    ].some((token) => message.includes(token))
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
            if (event.author !== agentName || !event.content?.parts) {
                continue
            }

            for (const part of event.content.parts) {
                if (part.text) {
                    rawText += part.text
                }
            }
        }

        const session = await sessionService.getSession({
            appName: APP_NAME,
            userId: USER_ID,
            sessionId
        })

        const structuredState = session?.state[MODEL_OUTPUT_KEY]
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
    const discovery = await runStructuredAgentWithRetries(
        discoveryRunner,
        discoveryAgent.name,
        buildDiscoveryPrompt(file.contents, file.filepath),
        discoveryResultSchema,
        'discover',
        MODEL_CALL_MAX_ATTEMPTS
    )

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
    const processedFiles: string[] = []
    const failedFiles: string[] = []

    for (const file of files) {
        console.log(`Processing ${file.filepath}...`)

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
