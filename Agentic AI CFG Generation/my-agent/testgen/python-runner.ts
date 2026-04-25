import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CandidateValidationResult } from './schema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const helperPath = path.join(__dirname, '../scripts/python_testgen_helper.py')

function resolvePythonExecutable(): string {
    if (process.env.TESTGEN_PYTHON_EXECUTABLE) {
        return process.env.TESTGEN_PYTHON_EXECUTABLE
    }

    const localUnixVenv = path.join(__dirname, '../.venv/bin/python')
    if (fs.existsSync(localUnixVenv)) {
        return localUnixVenv
    }

    const localWindowsVenv = path.join(__dirname, '../.venv/Scripts/python.exe')
    if (fs.existsSync(localWindowsVenv)) {
        return localWindowsVenv
    }

    return 'python3'
}

const pythonExecutable = resolvePythonExecutable()

interface PythonEnvironmentStatus {
    python: string
    pythonVersion: string
    coverageAvailable: boolean
    pytestAvailable: boolean
    errors: string[]
}

export interface PythonSuiteRunResult {
    ok: boolean
    exitCode: number
    stdout: string
    stderr: string
    coverageStdout: string
    coverageStderr: string
    coverageJsonPath: string
    rawCoverage: unknown
}

async function runPythonHelper<T>(command: string, payload: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const child = spawn(pythonExecutable, [helperPath, command], {
            stdio: ['pipe', 'pipe', 'pipe']
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
            if (code !== 0) {
                reject(new Error(`Python helper '${command}' failed with exit code ${code}: ${stderr || stdout}`))
                return
            }

            try {
                resolve(JSON.parse(stdout) as T)
            } catch (error) {
                reject(new Error(`Failed to parse Python helper response for '${command}': ${String(error)}\n${stdout}\n${stderr}`))
            }
        })

        child.stdin.write(JSON.stringify(payload))
        child.stdin.end()
    })
}

export async function ensurePythonTestEnvironment(): Promise<PythonEnvironmentStatus> {
    const status = await runPythonHelper<PythonEnvironmentStatus>('check_environment', {})

    if (!status.coverageAvailable || !status.pytestAvailable) {
        throw new Error(`Python test-generation environment is missing required tools: ${status.errors.join(' | ')}`)
    }

    return status
}

export async function validatePythonTestCandidate(code: string, targetMethod: string): Promise<CandidateValidationResult> {
    return runPythonHelper<CandidateValidationResult>('validate_candidate', {
        code,
        target_method: targetMethod
    })
}

export async function runPythonCoverageSuite(input: {
    testFilePath: string
    coverageJsonPath: string
    workingDir: string
}): Promise<PythonSuiteRunResult> {
    return runPythonHelper<PythonSuiteRunResult>('run_suite', {
        test_file_path: input.testFilePath,
        coverage_json_path: input.coverageJsonPath,
        working_dir: input.workingDir
    })
}
