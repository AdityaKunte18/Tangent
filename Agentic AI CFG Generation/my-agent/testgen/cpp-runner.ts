import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CandidateValidationResult } from './schema.js'

const cppCompiler = process.env.TESTGEN_CPP_COMPILER ?? 'clang++'

interface CommandResult {
    exitCode: number
    stdout: string
    stderr: string
}

interface CppToolchain {
    compiler: string
    llvmProfdata: string
    llvmCov: string
}

interface CppEnvironmentStatus extends CppToolchain {
    compilerVersion: string
    llvmCovAvailable: boolean
    llvmProfdataAvailable: boolean
    errors: string[]
}

export interface CppSuiteRunResult {
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

async function resolveLlvmTool(envName: 'TESTGEN_LLVM_PROFDATA' | 'TESTGEN_LLVM_COV', toolName: string): Promise<string> {
    const configured = process.env[envName]
    if (configured) {
        return configured
    }

    if (process.platform === 'darwin') {
        const xcrun = await runCommand('xcrun', ['--find', toolName])
        const resolved = xcrun.stdout.trim()
        if (xcrun.exitCode === 0 && resolved.length > 0) {
            return resolved
        }
    }

    return toolName
}

async function resolveCppToolchain(): Promise<CppToolchain> {
    return {
        compiler: cppCompiler,
        llvmProfdata: await resolveLlvmTool('TESTGEN_LLVM_PROFDATA', 'llvm-profdata'),
        llvmCov: await resolveLlvmTool('TESTGEN_LLVM_COV', 'llvm-cov')
    }
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
        .replace(/\bvoid\s+test_[A-Za-z_]\w*\s*\(/, 'void test_candidate(')
        .replace(/\s+/g, ' ')
        .trim()
}

function countAssertions(code: string): number {
    return [...code.matchAll(/\bassert\s*\(/g)].length
}

function validateCppCandidateSafety(code: string): string[] {
    const checks: Array<{ pattern: RegExp; message: string }> = [
        {
            pattern: /^\s*#/m,
            message: 'Preprocessor directives are not allowed inside generated C++ candidates.'
        },
        {
            pattern: /\bmain\s*\(/,
            message: 'Generated C++ candidates must not define main().'
        },
        {
            pattern: /\b(?:std::)?(?:system|popen|fork|remove|rename)\s*\(/,
            message: 'Process and filesystem mutation calls are not allowed.'
        },
        {
            pattern: /\b(?:execl|execle|execlp|execv|execve|execvp)\s*\(/,
            message: 'Process execution calls are not allowed.'
        },
        {
            pattern: /\b(?:std::)?(?:ifstream|ofstream|fstream|filesystem)\b/,
            message: 'File I/O APIs are not allowed.'
        },
        {
            pattern: /\b(?:socket|connect|curl|pthread|thread)\b/,
            message: 'Network and threading APIs are not allowed.'
        }
    ]

    return checks
        .filter((check) => check.pattern.test(code))
        .map((check) => check.message)
}

export async function ensureCppTestEnvironment(): Promise<CppEnvironmentStatus> {
    const toolchain = await resolveCppToolchain()
    const errors: string[] = []
    let compilerVersion = ''
    let llvmProfdataAvailable = true
    let llvmCovAvailable = true

    try {
        const compilerCheck = await runCommand(toolchain.compiler, ['--version'])
        compilerVersion = compilerCheck.stdout || compilerCheck.stderr
        if (compilerCheck.exitCode !== 0) {
            errors.push(`C++ compiler check failed: ${compilerCheck.stderr || compilerCheck.stdout}`)
        }
    } catch (error) {
        errors.push(`C++ compiler '${toolchain.compiler}' failed: ${String(error)}`)
    }

    try {
        const profdataCheck = await runCommand(toolchain.llvmProfdata, ['show', '--version'])
        llvmProfdataAvailable = profdataCheck.exitCode === 0
        if (!llvmProfdataAvailable) {
            errors.push(`llvm-profdata check failed: ${profdataCheck.stderr || profdataCheck.stdout}`)
        }
    } catch (error) {
        llvmProfdataAvailable = false
        errors.push(`llvm-profdata '${toolchain.llvmProfdata}' failed: ${String(error)}`)
    }

    try {
        const covCheck = await runCommand(toolchain.llvmCov, ['--version'])
        llvmCovAvailable = covCheck.exitCode === 0
        if (!llvmCovAvailable) {
            errors.push(`llvm-cov check failed: ${covCheck.stderr || covCheck.stdout}`)
        }
    } catch (error) {
        llvmCovAvailable = false
        errors.push(`llvm-cov '${toolchain.llvmCov}' failed: ${String(error)}`)
    }

    const status = {
        ...toolchain,
        compilerVersion,
        llvmCovAvailable,
        llvmProfdataAvailable,
        errors
    }

    if (errors.length > 0 || !llvmCovAvailable || !llvmProfdataAvailable) {
        throw new Error(`C++ test-generation environment is missing required tools: ${errors.join(' | ')}`)
    }

    return status
}

export async function validateCppTestCandidate(code: string, targetMethod: string): Promise<CandidateValidationResult> {
    const errors = validateCppCandidateSafety(code)
    const functionMatch = code.match(/^\s*void\s+(test_[A-Za-z_]\w*)\s*\(\s*\)\s*\{/)

    if (!functionMatch || functionMatch.index == null) {
        errors.push('Candidate must contain exactly one C++ test function with signature void test_<name>().')
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
        errors.push('Candidate test function has unbalanced braces.')
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
        errors.push('Candidate must contain exactly one C++ test function and no top-level statements.')
    }

    const targetPattern = new RegExp(`\\b${escapeRegExp(targetMethod)}\\s*\\(`)
    const calledTargets = targetPattern.test(code) ? [targetMethod] : []
    if (targetMethod && calledTargets.length === 0) {
        errors.push(`Candidate must call ${targetMethod}(...) at least once.`)
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

function normalizeComparablePath(value: string): string {
    return path.normalize(path.resolve(value))
}

function isExecutedCount(countText: string): boolean {
    const trimmed = countText.trim().replace(/,/g, '').toLowerCase()
    if (trimmed.length === 0 || trimmed === '0' || /^0+(?:\.0+)?$/.test(trimmed)) {
        return false
    }

    return !trimmed.startsWith('#')
}

function extractExecutedLinesFromLlvmShow(showOutput: string): number[] {
    const executedLines = new Set<number>()

    for (const line of showOutput.split('\n')) {
        const match = line.match(/^\s*(\d+)\|\s*([^|]*)\|/)
        if (!match) {
            continue
        }

        const lineNumber = Number(match[1])
        if (Number.isFinite(lineNumber) && isExecutedCount(match[2])) {
            executedLines.add(lineNumber)
        }
    }

    return [...executedLines].sort((left, right) => left - right)
}

function extractBranchOutcomesFromLlvmExport(rawLlvmCoverage: unknown, sourcePath: string): Array<{
    line: number
    trueCount: number
    falseCount: number
}> {
    const normalizedSourcePath = normalizeComparablePath(sourcePath)
    const dataEntries = (rawLlvmCoverage as { data?: Array<{ files?: unknown[] }> })?.data ?? []

    for (const dataEntry of dataEntries) {
        for (const filePayload of dataEntry.files ?? []) {
            const file = filePayload as {
                filename?: string
                branches?: unknown[]
            }

            if (!file.filename || normalizeComparablePath(file.filename) !== normalizedSourcePath) {
                continue
            }

            return (file.branches ?? [])
                .map((branch) => {
                    if (!Array.isArray(branch) || branch.length < 6) {
                        return null
                    }

                    const line = Number(branch[0])
                    const trueCount = Number(branch[4])
                    const falseCount = Number(branch[5])
                    if (!Number.isFinite(line) || !Number.isFinite(trueCount) || !Number.isFinite(falseCount)) {
                        return null
                    }

                    return {
                        line,
                        trueCount,
                        falseCount
                    }
                })
                .filter((branch): branch is { line: number; trueCount: number; falseCount: number } => branch != null)
        }
    }

    return []
}

function normalizeLlvmCoverage(rawLlvmCoverage: unknown, showOutput: string, sourcePath: string): unknown {
    return {
        tool: 'llvm-cov',
        files: {
            [path.resolve(sourcePath)]: {
                executed_lines: extractExecutedLinesFromLlvmShow(showOutput),
                executed_branches: [],
                executed_branch_outcomes: extractBranchOutcomesFromLlvmExport(rawLlvmCoverage, sourcePath)
            }
        },
        raw: rawLlvmCoverage
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
}): CppSuiteRunResult {
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

export async function runCppCoverageSuite(input: {
    sourcePath: string
    testFilePath: string
    coverageJsonPath: string
    workingDir: string
}): Promise<CppSuiteRunResult> {
    const toolchain = await resolveCppToolchain()
    const workingDir = path.resolve(input.workingDir)
    fs.mkdirSync(workingDir, { recursive: true })

    const executablePath = path.join(workingDir, `${path.basename(input.testFilePath, path.extname(input.testFilePath))}_bin`)
    const profileRawPath = path.join(workingDir, `${path.basename(input.testFilePath, path.extname(input.testFilePath))}.profraw`)
    const profileDataPath = path.join(workingDir, `${path.basename(input.testFilePath, path.extname(input.testFilePath))}.profdata`)

    const compileResult = await runCommand(toolchain.compiler, [
        '-std=c++20',
        '-fprofile-instr-generate',
        '-fcoverage-mapping',
        input.testFilePath,
        '-o',
        executablePath
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

    const runResult = await runCommand(executablePath, [], {
        cwd: workingDir,
        env: {
            ...process.env,
            LLVM_PROFILE_FILE: profileRawPath
        }
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

    const mergeResult = await runCommand(toolchain.llvmProfdata, [
        'merge',
        '-sparse',
        profileRawPath,
        '-o',
        profileDataPath
    ], {
        cwd: workingDir
    })

    if (mergeResult.exitCode !== 0) {
        return failureResult({
            exitCode: mergeResult.exitCode,
            stdout: runResult.stdout,
            stderr: mergeResult.stderr,
            compileStdout: compileResult.stdout,
            compileStderr: compileResult.stderr,
            coverageStdout: mergeResult.stdout,
            coverageStderr: mergeResult.stderr,
            coverageJsonPath: input.coverageJsonPath
        })
    }

    const showResult = await runCommand(toolchain.llvmCov, [
        'show',
        '-format=text',
        executablePath,
        `-instr-profile=${profileDataPath}`,
        path.resolve(input.sourcePath)
    ], {
        cwd: workingDir
    })

    if (showResult.exitCode !== 0) {
        return failureResult({
            exitCode: showResult.exitCode,
            stdout: runResult.stdout,
            stderr: showResult.stderr,
            compileStdout: compileResult.stdout,
            compileStderr: compileResult.stderr,
            coverageStdout: showResult.stdout,
            coverageStderr: showResult.stderr,
            coverageJsonPath: input.coverageJsonPath
        })
    }

    const exportResult = await runCommand(toolchain.llvmCov, [
        'export',
        '-format=text',
        executablePath,
        `-instr-profile=${profileDataPath}`,
        path.resolve(input.sourcePath)
    ], {
        cwd: workingDir
    })

    if (exportResult.exitCode !== 0) {
        return failureResult({
            exitCode: exportResult.exitCode,
            stdout: runResult.stdout,
            stderr: exportResult.stderr,
            compileStdout: compileResult.stdout,
            compileStderr: compileResult.stderr,
            coverageStdout: exportResult.stdout,
            coverageStderr: exportResult.stderr,
            coverageJsonPath: input.coverageJsonPath
        })
    }

    let rawLlvmCoverage: unknown
    try {
        rawLlvmCoverage = JSON.parse(exportResult.stdout)
    } catch (error) {
        return failureResult({
            exitCode: 1,
            stdout: runResult.stdout,
            stderr: `Failed to parse llvm-cov export JSON: ${String(error)}`,
            compileStdout: compileResult.stdout,
            compileStderr: compileResult.stderr,
            coverageStdout: exportResult.stdout,
            coverageStderr: exportResult.stderr,
            coverageJsonPath: input.coverageJsonPath
        })
    }

    const normalizedCoverage = normalizeLlvmCoverage(rawLlvmCoverage, showResult.stdout, input.sourcePath)
    fs.writeFileSync(input.coverageJsonPath, JSON.stringify(normalizedCoverage, null, 2), 'utf-8')

    return {
        ok: true,
        exitCode: 0,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        compileStdout: compileResult.stdout,
        compileStderr: compileResult.stderr,
        coverageStdout: exportResult.stdout,
        coverageStderr: exportResult.stderr,
        coverageJsonPath: input.coverageJsonPath,
        rawCoverage: normalizedCoverage
    }
}
