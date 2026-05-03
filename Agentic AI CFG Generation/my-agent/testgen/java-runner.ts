import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CandidateValidationResult, CoverageObjective } from './schema.js'

const javaExecutable = process.env.TESTGEN_JAVA_EXECUTABLE ?? 'java'
const javacExecutable = process.env.TESTGEN_JAVAC_EXECUTABLE ?? 'javac'

interface CommandResult {
    exitCode: number
    stdout: string
    stderr: string
}

interface JavaEnvironmentStatus {
    java: string
    javac: string
    javaVersion: string
    javacVersion: string
    errors: string[]
}

export interface JavaSuiteRunResult {
    ok: boolean
    exitCode: number
    stdout: string
    stderr: string
    compileStdout: string
    compileStderr: string
    coverageStdout: string
    coverageStderr: string
    coverageJsonPath: string
    rawCoverage: unknown
}

function runCommand(command: string, args: string[], options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
} = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['ignore', 'pipe', 'pipe']
        })

        let stdout = ''
        let stderr = ''

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString()
        })

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString()
        })

        child.on('error', (error) => {
            reject(error)
        })

        child.on('close', (code) => {
            resolve({
                exitCode: code ?? 1,
                stdout,
                stderr
            })
        })
    })
}

export function getJavaSourceClassName(source: string, fallback = 'SourceUnderTest'): string {
    const publicClassMatch = source.match(/\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_]\w*)\b/)
    if (publicClassMatch) {
        return publicClassMatch[1]
    }

    const classMatch = source.match(/\bclass\s+([A-Za-z_]\w*)\b/)
    return classMatch?.[1] ?? fallback
}

function sanitizeJavaIdentifier(value: string): string {
    const sanitized = value.replace(/[^A-Za-z0-9_]/g, '_')
    return /^[A-Za-z_]/.test(sanitized) ? sanitized : `Generated_${sanitized}`
}

export function getJavaGeneratedClassName(testFilePath: string): string {
    return sanitizeJavaIdentifier(path.basename(testFilePath, path.extname(testFilePath)))
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripTopLevelTrivia(value: string): string {
    let current = value
    let previous = ''

    while (current !== previous) {
        previous = current
        current = current
            .replace(/^\s+|\s+$/g, '')
            .replace(/^\/\/[^\n]*(?:\n|$)/, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .trim()
    }

    return current
}

function findMatchingBrace(source: string, openBraceIndex: number): number | null {
    let depth = 0
    let inSingleQuote = false
    let inDoubleQuote = false
    let inLineComment = false
    let inBlockComment = false

    for (let index = openBraceIndex; index < source.length; index += 1) {
        const current = source[index]
        const next = source[index + 1]
        const previous = source[index - 1]

        if (inLineComment) {
            if (current === '\n') {
                inLineComment = false
            }
            continue
        }

        if (inBlockComment) {
            if (current === '*' && next === '/') {
                inBlockComment = false
                index += 1
            }
            continue
        }

        if (!inSingleQuote && !inDoubleQuote) {
            if (current === '/' && next === '/') {
                inLineComment = true
                index += 1
                continue
            }

            if (current === '/' && next === '*') {
                inBlockComment = true
                index += 1
                continue
            }
        }

        if (current === '"' && !inSingleQuote && previous !== '\\') {
            inDoubleQuote = !inDoubleQuote
            continue
        }

        if (current === '\'' && !inDoubleQuote && previous !== '\\') {
            inSingleQuote = !inSingleQuote
            continue
        }

        if (inSingleQuote || inDoubleQuote) {
            continue
        }

        if (current === '{') {
            depth += 1
            continue
        }

        if (current === '}') {
            depth -= 1
            if (depth === 0) {
                return index
            }
        }
    }

    return null
}

function normalizeCandidateFingerprint(code: string): string {
    return code
        .replace(/\b(?:public\s+)?static\s+void\s+test_[A-Za-z_]\w*\s*\(/, 'static void test_candidate(')
        .replace(/\s+/g, ' ')
        .trim()
}

function countAssertions(code: string): number {
    return [...code.matchAll(/\b(?:assert|AssertionError)\b/g)].length
}

function validateJavaCandidateSafety(code: string): string[] {
    const checks: Array<{ pattern: RegExp; message: string }> = [
        {
            pattern: /^\s*(?:package|import)\b/m,
            message: 'Package declarations and imports are not allowed inside generated Java candidates.'
        },
        {
            pattern: /\bclass\s+[A-Za-z_]\w*\b/,
            message: 'Generated Java candidates must not define classes.'
        },
        {
            pattern: /\bmain\s*\(/,
            message: 'Generated Java candidates must not define main().'
        },
        {
            pattern: /\bSystem\s*\.\s*(?:exit|setProperty|setSecurityManager)\s*\(/,
            message: 'System mutation calls are not allowed.'
        },
        {
            pattern: /\b(?:Runtime\s*\.\s*getRuntime|ProcessBuilder|Class\s*\.\s*forName)\b/,
            message: 'Process execution and reflection APIs are not allowed.'
        },
        {
            pattern: /\b(?:java\.io|java\.nio\.file|Files\s*\.|File\s*\()/,
            message: 'File I/O APIs are not allowed.'
        },
        {
            pattern: /\b(?:Socket|ServerSocket|Thread|ExecutorService)\b/,
            message: 'Network and threading APIs are not allowed.'
        }
    ]

    return checks
        .filter((check) => check.pattern.test(code))
        .map((check) => check.message)
}

export async function ensureJavaTestEnvironment(): Promise<JavaEnvironmentStatus> {
    const errors: string[] = []
    let javaVersion = ''
    let javacVersion = ''

    try {
        const javaCheck = await runCommand(javaExecutable, ['-version'])
        javaVersion = javaCheck.stdout || javaCheck.stderr
        if (javaCheck.exitCode !== 0) {
            errors.push(`java check failed: ${javaCheck.stderr || javaCheck.stdout}`)
        }
    } catch (error) {
        errors.push(`java '${javaExecutable}' failed: ${String(error)}`)
    }

    try {
        const javacCheck = await runCommand(javacExecutable, ['-version'])
        javacVersion = javacCheck.stdout || javacCheck.stderr
        if (javacCheck.exitCode !== 0) {
            errors.push(`javac check failed: ${javacCheck.stderr || javacCheck.stdout}`)
        }
    } catch (error) {
        errors.push(`javac '${javacExecutable}' failed: ${String(error)}`)
    }

    if (errors.length > 0) {
        throw new Error(`Java test-generation environment is missing required tools: ${errors.join(' | ')}`)
    }

    return {
        java: javaExecutable,
        javac: javacExecutable,
        javaVersion,
        javacVersion,
        errors
    }
}

export async function validateJavaTestCandidate(
    code: string,
    targetMethod: string,
    sourceClassName: string
): Promise<CandidateValidationResult> {
    const errors = validateJavaCandidateSafety(code)
    const functionMatch = code.match(/^\s*(?:public\s+)?static\s+void\s+(test_[A-Za-z_]\w*)\s*\(\s*\)(?:\s+throws\s+[^{]+)?\s*\{/)

    if (!functionMatch || functionMatch.index == null) {
        errors.push('Candidate must contain exactly one Java test method with signature static void test_<name>().')
        return {
            valid: false,
            errors,
            functionName: null,
            fingerprint: null,
            calledTargets: [],
            assertionCount: 0,
            usesCapsys: false
        }
    }

    const openBraceIndex = code.indexOf('{', functionMatch.index + functionMatch[0].length - 1)
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex)

    if (openBraceIndex < 0 || closeBraceIndex == null) {
        errors.push('Candidate test method has unbalanced braces.')
        return {
            valid: false,
            errors,
            functionName: functionMatch[1],
            fingerprint: null,
            calledTargets: [],
            assertionCount: 0,
            usesCapsys: false
        }
    }

    const before = stripTopLevelTrivia(code.slice(0, functionMatch.index))
    const after = stripTopLevelTrivia(code.slice(closeBraceIndex + 1))
    if (before.length > 0 || after.length > 0) {
        errors.push('Candidate must contain exactly one Java test method and no top-level statements.')
    }

    const targetPattern = new RegExp(`\\b${escapeRegExp(sourceClassName)}\\s*\\.\\s*${escapeRegExp(targetMethod)}\\s*\\(`)
    const calledTargets = targetPattern.test(code) ? [targetMethod] : []
    if (targetMethod && calledTargets.length === 0) {
        errors.push(`Candidate must call ${sourceClassName}.${targetMethod}(...) at least once.`)
    }

    return {
        valid: errors.length === 0,
        errors,
        functionName: functionMatch[1],
        fingerprint: normalizeCandidateFingerprint(code),
        calledTargets,
        assertionCount: countAssertions(code),
        usesCapsys: false
    }
}

function range(start: number, end: number): number[] {
    const values: number[] = []
    for (let value = start; value <= end; value += 1) {
        values.push(value)
    }
    return values
}

function collectProbeLines(objectives: CoverageObjective[]): Set<number> {
    const lines = new Set<number>()

    for (const objective of objectives) {
        for (const span of [objective.sourceSpan, objective.targetSpan]) {
            if (!span) {
                continue
            }

            for (const line of range(span.startLine, span.endLine)) {
                lines.add(line)
            }
        }
    }

    return lines
}

function canInsertProbeBefore(line: string): boolean {
    const trimmed = line.trim()
    return trimmed.length > 0
        && !trimmed.startsWith('}')
        && !trimmed.startsWith('package ')
        && !trimmed.startsWith('import ')
        && !trimmed.startsWith('@')
        && !/^(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?class\b/.test(trimmed)
        && !/^(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\], ?]+\s+[A-Za-z_]\w*\s*\([^)]*\)\s*\{?\s*$/.test(trimmed)
}

function stripJavaLineForSyntax(line: string): string {
    let result = ''
    let inSingleQuote = false
    let inDoubleQuote = false
    let inBlockComment = false

    for (let index = 0; index < line.length; index += 1) {
        const current = line[index]
        const next = line[index + 1]
        const previous = line[index - 1]

        if (inBlockComment) {
            if (current === '*' && next === '/') {
                inBlockComment = false
                index += 1
            }
            continue
        }

        if (!inSingleQuote && !inDoubleQuote) {
            if (current === '/' && next === '/') {
                break
            }

            if (current === '/' && next === '*') {
                inBlockComment = true
                index += 1
                continue
            }
        }

        if (current === '"' && !inSingleQuote && previous !== '\\') {
            inDoubleQuote = !inDoubleQuote
            result += ' '
            continue
        }

        if (current === '\'' && !inDoubleQuote && previous !== '\\') {
            inSingleQuote = !inSingleQuote
            result += ' '
            continue
        }

        result += (inSingleQuote || inDoubleQuote) ? ' ' : current
    }

    return result
}

function updateParenDepth(line: string, currentDepth: number): number {
    let depth = currentDepth
    for (const character of stripJavaLineForSyntax(line)) {
        if (character === '(') {
            depth += 1
        } else if (character === ')') {
            depth = Math.max(0, depth - 1)
        }
    }
    return depth
}

function isContinuationLine(line: string): boolean {
    return /^(?:[+*/%&|^?:.,=<>!-]|\|\||&&)/.test(line.trim())
}

function lineEndsAtStatementBoundary(line: string): boolean {
    const trimmed = stripJavaLineForSyntax(line).trim()
    return trimmed.length === 0
        || trimmed.endsWith(';')
        || trimmed.endsWith('{')
        || trimmed.endsWith('}')
}

function isUnbracedControlHeader(line: string): boolean {
    const trimmed = stripJavaLineForSyntax(line).trim()
    return /^(?:if|for|while)\s*\(/.test(trimmed)
        && !trimmed.endsWith(';')
        && !trimmed.endsWith('{')
}

function canWrapAsControlBody(line: string): boolean {
    const trimmed = line.trim()
    return trimmed.length > 0
        && !trimmed.startsWith('{')
        && !trimmed.startsWith('}')
        && !/^(?:else|catch|finally)\b/.test(trimmed)
}

function instrumentJavaSource(source: string, probeLines: Set<number>): string {
    const output: string[] = []
    const lines = source.split('\n')
    let parenDepth = 0
    let previousSignificantLine: string | null = null

    for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1
        const trimmed = line.trim()
        const previousIsUnbracedControl = previousSignificantLine != null
            && isUnbracedControlHeader(previousSignificantLine)
        const atStatementBoundary = previousSignificantLine == null
            || lineEndsAtStatementBoundary(previousSignificantLine)
        const probeBeforeLine = probeLines.has(lineNumber)
            && canInsertProbeBefore(line)
            && parenDepth === 0
            && !isContinuationLine(line)
            && atStatementBoundary
        const wrapControlBody = probeLines.has(lineNumber)
            && canInsertProbeBefore(line)
            && parenDepth === 0
            && previousIsUnbracedControl
            && canWrapAsControlBody(line)

        const indent = line.match(/^\s*/)?.[0] ?? ''
        if (probeBeforeLine) {
            output.push(`${indent}__CfgCoverageRecorder.line(${lineNumber});`)
            output.push(line)
        } else if (wrapControlBody) {
            output.push(`${indent}{`)
            output.push(`${indent}    __CfgCoverageRecorder.line(${lineNumber});`)
            output.push(`${indent}    ${trimmed}`)
            output.push(`${indent}}`)
        } else {
            output.push(line)
        }

        parenDepth = updateParenDepth(line, parenDepth)
        if (trimmed.length > 0 && !trimmed.startsWith('//')) {
            previousSignificantLine = line
        }
    }

    return output.join('\n')
}

function buildCoverageRecorderSource(): string {
    return `import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.Set;
import java.util.TreeSet;

final class __CfgCoverageRecorder {
    private static final Set<Integer> executedLines = new TreeSet<>();

    static {
        Runtime.getRuntime().addShutdownHook(new Thread(__CfgCoverageRecorder::write));
    }

    static synchronized void line(int line) {
        executedLines.add(line);
    }

    private static synchronized void write() {
        String outputPath = System.getProperty("cfg.coverage.path");
        if (outputPath == null || outputPath.isEmpty()) {
            return;
        }

        try (PrintWriter writer = new PrintWriter(new FileWriter(outputPath))) {
            writer.print("{\\"executed_lines\\":[");
            boolean first = true;
            for (Integer line : executedLines) {
                if (!first) {
                    writer.print(",");
                }
                writer.print(line);
                first = false;
            }
            writer.print("]}");
        } catch (Exception ignored) {
        }
    }
}
`
}

function readExecutedLines(linesJsonPath: string): number[] {
    if (!fs.existsSync(linesJsonPath)) {
        return []
    }

    const parsed = JSON.parse(fs.readFileSync(linesJsonPath, 'utf-8')) as { executed_lines?: unknown[] }
    return [...new Set((parsed.executed_lines ?? [])
        .map((line) => Number(line))
        .filter(Number.isFinite))]
        .sort((left, right) => left - right)
}

function spanWasExecuted(executedLines: Set<number>, span: CoverageObjective['targetSpan']): boolean {
    if (!span) {
        return false
    }

    return range(span.startLine, span.endLine).some((line) => executedLines.has(line))
}

function addSpanLines(lines: Set<number>, span: CoverageObjective['sourceSpan']): boolean {
    if (!span) {
        return false
    }

    let changed = false
    for (const line of range(span.startLine, span.endLine)) {
        if (lines.has(line)) {
            continue
        }

        lines.add(line)
        changed = true
    }
    return changed
}

function expandEvaluatedLineSet(objectives: CoverageObjective[], executedLines: number[]): Set<number> {
    const evaluatedLines = new Set(executedLines)
    let changed = true

    while (changed) {
        changed = false

        for (const objective of objectives) {
            if (objective.kind === 'statement' || !objective.sourceSpan || !spanWasExecuted(evaluatedLines, objective.targetSpan)) {
                continue
            }

            changed = addSpanLines(evaluatedLines, objective.sourceSpan) || changed
        }
    }

    return evaluatedLines
}

function deriveBranchOutcomes(
    objectives: CoverageObjective[],
    executedLineSet: Set<number>
): Array<{ line: number; trueCount: number; falseCount: number }> {
    const outcomes = new Map<number, { line: number; trueCount: number; falseCount: number }>()

    for (const objective of objectives) {
        if (objective.kind === 'statement' || !objective.sourceSpan || !spanWasExecuted(executedLineSet, objective.targetSpan)) {
            continue
        }

        const line = objective.sourceSpan.startLine
        const existing = outcomes.get(line) ?? {
            line,
            trueCount: 0,
            falseCount: 0
        }

        if (objective.branchOutcome) {
            existing.trueCount += 1
        } else {
            existing.falseCount += 1
        }

        outcomes.set(line, existing)
    }

    return [...outcomes.values()].sort((left, right) => left.line - right.line)
}

function normalizeJavaCoverage(sourcePath: string, objectives: CoverageObjective[], executedLines: number[]): unknown {
    const evaluatedLineSet = expandEvaluatedLineSet(objectives, executedLines)
    const evaluatedLines = [...evaluatedLineSet].sort((left, right) => left - right)

    return {
        tool: 'java-source-instrumentation',
        files: {
            [path.resolve(sourcePath)]: {
                executed_lines: evaluatedLines,
                executed_branches: [],
                executed_branch_outcomes: deriveBranchOutcomes(objectives, evaluatedLineSet)
            }
        }
    }
}

function failureResult(input: {
    exitCode: number
    stdout?: string
    stderr?: string
    compileStdout?: string
    compileStderr?: string
    coverageStdout?: string
    coverageStderr?: string
    coverageJsonPath: string
}): JavaSuiteRunResult {
    return {
        ok: false,
        exitCode: input.exitCode,
        stdout: input.stdout ?? '',
        stderr: input.stderr ?? input.compileStderr ?? input.coverageStderr ?? '',
        compileStdout: input.compileStdout ?? '',
        compileStderr: input.compileStderr ?? '',
        coverageStdout: input.coverageStdout ?? '',
        coverageStderr: input.coverageStderr ?? '',
        coverageJsonPath: input.coverageJsonPath,
        rawCoverage: null
    }
}

export async function runJavaCoverageSuite(input: {
    sourcePath: string
    testFilePath: string
    coverageJsonPath: string
    workingDir: string
    objectives: CoverageObjective[]
}): Promise<JavaSuiteRunResult> {
    const workingDir = path.resolve(input.workingDir)
    const instrumentedDir = path.join(workingDir, 'java-instrumented-src')
    const classesDir = path.join(workingDir, 'java-classes')
    fs.mkdirSync(instrumentedDir, { recursive: true })
    fs.mkdirSync(classesDir, { recursive: true })

    const sourceText = fs.readFileSync(input.sourcePath, 'utf-8')
    const sourceClassName = getJavaSourceClassName(sourceText, path.basename(input.sourcePath, path.extname(input.sourcePath)))
    const instrumentedSourcePath = path.join(instrumentedDir, `${sourceClassName}.java`)
    const recorderSourcePath = path.join(instrumentedDir, '__CfgCoverageRecorder.java')
    const linesJsonPath = path.join(workingDir, `${path.basename(input.testFilePath, path.extname(input.testFilePath))}_lines.json`)

    fs.writeFileSync(instrumentedSourcePath, instrumentJavaSource(sourceText, collectProbeLines(input.objectives)), 'utf-8')
    fs.writeFileSync(recorderSourcePath, buildCoverageRecorderSource(), 'utf-8')

    const compileResult = await runCommand(javacExecutable, [
        '-d',
        classesDir,
        instrumentedSourcePath,
        recorderSourcePath,
        input.testFilePath
    ], {
        cwd: workingDir
    })

    if (compileResult.exitCode !== 0) {
        return failureResult({
            exitCode: compileResult.exitCode,
            compileStdout: compileResult.stdout,
            compileStderr: compileResult.stderr,
            coverageJsonPath: input.coverageJsonPath
        })
    }

    const generatedClassName = getJavaGeneratedClassName(input.testFilePath)
    const runResult = await runCommand(javaExecutable, [
        '-ea',
        `-Dcfg.coverage.path=${linesJsonPath}`,
        '-cp',
        classesDir,
        generatedClassName
    ], {
        cwd: workingDir
    })

    if (runResult.exitCode !== 0) {
        return failureResult({
            exitCode: runResult.exitCode,
            stdout: runResult.stdout,
            stderr: runResult.stderr,
            compileStdout: compileResult.stdout,
            compileStderr: compileResult.stderr,
            coverageJsonPath: input.coverageJsonPath
        })
    }

    const executedLines = readExecutedLines(linesJsonPath)
    const normalizedCoverage = normalizeJavaCoverage(input.sourcePath, input.objectives, executedLines)
    fs.writeFileSync(input.coverageJsonPath, JSON.stringify(normalizedCoverage, null, 2), 'utf-8')

    return {
        ok: true,
        exitCode: 0,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        compileStdout: compileResult.stdout,
        compileStderr: compileResult.stderr,
        coverageStdout: '',
        coverageStderr: '',
        coverageJsonPath: input.coverageJsonPath,
        rawCoverage: normalizedCoverage
    }
}
