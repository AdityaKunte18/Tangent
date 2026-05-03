import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type BaselineTool = 'pynguin' | 'evosuite' | 'klee'
type BaselineLanguage = 'python' | 'java' | 'c++'
type BaselineStatus = 'passed' | 'failed' | 'skipped'

interface CommandResult {
    exitCode: number
    stdout: string
    stderr: string
    timedOut: boolean
}

interface CoverageMetric {
    covered: number
    total: number
    percent: number
}

interface BaselineResult {
    tool: BaselineTool
    benchmark: string
    language: BaselineLanguage
    status: BaselineStatus
    budgetSeconds: number
    generatedTestCount: number
    coverage?: {
        source: string
        combined?: CoverageMetric
        line?: CoverageMetric
        branch?: CoverageMetric
    }
    paths: {
        caseDir: string
        source?: string
        generatedTests?: string
        coverage?: string
        report?: string
        stdout?: string
        stderr?: string
    }
    notes: string[]
}

interface Benchmark {
    id: string
    name: string
    pythonSource: string
    pythonModule: string
    javaSource: string
    javaFilename: string
    javaNormalizer: 'basic' | 'dfs' | 'none'
    cppSource: string
}

const projectRoot = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const defaultJavaHome = '/Library/Java/JavaVirtualMachines/zulu-8.jdk/Contents/Home'
const defaultKleeImage = 'klee/klee:3.0'

const benchmarks: Benchmark[] = [
    {
        id: 'basic-methods',
        name: 'Basic Methods',
        pythonSource: path.join(projectRoot, 'input/Cross Language Equivilance/Basic Methods/test.py'),
        pythonModule: 'basic_methods',
        javaSource: path.join(projectRoot, 'input/Cross Language Equivilance/Basic Methods/test.java'),
        javaFilename: 'test.java',
        javaNormalizer: 'basic',
        cppSource: path.join(projectRoot, 'input/Cross Language Equivilance/Basic Methods/test.cpp')
    },
    {
        id: 'dfs',
        name: 'Depth First Search',
        pythonSource: path.join(projectRoot, 'input/Real World Sampling/DFS/DFS.py'),
        pythonModule: 'dfs',
        javaSource: path.join(projectRoot, 'input/Real World Sampling/DFS/DFS.java'),
        javaFilename: 'DFS.java',
        javaNormalizer: 'dfs',
        cppSource: path.join(projectRoot, 'input/Real World Sampling/DFS/DFS.cpp')
    },
    {
        id: 'convex-polygon',
        name: 'Convex Polygon',
        pythonSource: path.join(projectRoot, 'input/Real World Sampling/ConvexPoly/PCP.py'),
        pythonModule: 'convex_polygon',
        javaSource: path.join(projectRoot, 'input/Real World Sampling/ConvexPoly/PCP.java'),
        javaFilename: 'PCP.java',
        javaNormalizer: 'none',
        cppSource: path.join(projectRoot, 'input/Real World Sampling/ConvexPoly/PCP.cpp')
    }
]

function parseArgs(): { mode: 'smoke' | 'full'; outDir: string } {
    let mode: 'smoke' | 'full' = 'smoke'
    let configuredOutDir = process.env.BASELINE_OUT_DIR ?? ''

    for (const arg of process.argv.slice(2)) {
        if (arg === '--full' || arg === '--mode=full') {
            mode = 'full'
        } else if (arg === '--smoke' || arg === '--mode=smoke') {
            mode = 'smoke'
        } else if (arg.startsWith('--out-dir=')) {
            configuredOutDir = arg.slice('--out-dir='.length)
        }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outDir = configuredOutDir
        ? path.resolve(configuredOutDir)
        : path.join(projectRoot, 'generated-tests/baselines', `${mode}-${timestamp}`)

    return { mode, outDir }
}

function budgetSecondsFor(mode: 'smoke' | 'full'): number {
    return mode === 'full' ? 120 : 10
}

function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf-8')
}

function relativePath(filePath: string | undefined): string | undefined {
    return filePath ? path.relative(projectRoot, filePath) : undefined
}

function percent(covered: number, total: number): number {
    return total === 0 ? 0 : Number(((covered / total) * 100).toFixed(2))
}

function runCommand(command: string, args: string[], options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
} = {}): Promise<CommandResult> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['ignore', 'pipe', 'pipe']
        })

        let stdout = ''
        let stderr = ''
        let timedOut = false
        const timer = options.timeoutMs
            ? setTimeout(() => {
                timedOut = true
                child.kill('SIGTERM')
            }, options.timeoutMs)
            : null

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString()
        })

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString()
        })

        child.on('error', (error) => {
            if (timer) {
                clearTimeout(timer)
            }
            resolve({
                exitCode: 1,
                stdout,
                stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
                timedOut
            })
        })

        child.on('close', (code) => {
            if (timer) {
                clearTimeout(timer)
            }
            resolve({
                exitCode: timedOut ? 124 : code ?? 1,
                stdout,
                stderr,
                timedOut
            })
        })
    })
}

function appendCommandLogs(caseDir: string, prefix: string, result: CommandResult): { stdout: string; stderr: string } {
    const stdoutPath = path.join(caseDir, `${prefix}.stdout.log`)
    const stderrPath = path.join(caseDir, `${prefix}.stderr.log`)
    writeFile(stdoutPath, result.stdout)
    writeFile(stderrPath, result.stderr)
    return { stdout: stdoutPath, stderr: stderrPath }
}

function listFilesRecursive(root: string): string[] {
    if (!fs.existsSync(root)) {
        return []
    }

    const results: string[] = []
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const fullPath = path.join(root, entry.name)
        if (entry.isDirectory()) {
            results.push(...listFilesRecursive(fullPath))
        } else {
            results.push(fullPath)
        }
    }
    return results
}

function countPattern(filePath: string, pattern: RegExp): number {
    if (!fs.existsSync(filePath)) {
        return 0
    }

    const matches = fs.readFileSync(filePath, 'utf-8').match(pattern)
    return matches?.length ?? 0
}

function parseCoveragePyJson(coveragePath: string): BaselineResult['coverage'] | undefined {
    if (!fs.existsSync(coveragePath)) {
        return undefined
    }

    const parsed = JSON.parse(fs.readFileSync(coveragePath, 'utf-8')) as {
        totals?: {
            covered_lines?: number
            num_statements?: number
            covered_branches?: number
            num_branches?: number
        }
    }
    const totals = parsed.totals
    if (!totals) {
        return undefined
    }

    const lineCovered = Number(totals.covered_lines ?? 0)
    const lineTotal = Number(totals.num_statements ?? 0)
    const branchCovered = Number(totals.covered_branches ?? 0)
    const branchTotal = Number(totals.num_branches ?? 0)

    return {
        source: 'coverage.py',
        line: {
            covered: lineCovered,
            total: lineTotal,
            percent: percent(lineCovered, lineTotal)
        },
        branch: {
            covered: branchCovered,
            total: branchTotal,
            percent: percent(branchCovered, branchTotal)
        }
    }
}

async function runPynguinBaseline(benchmark: Benchmark, outRoot: string, budgetSeconds: number): Promise<BaselineResult> {
    const caseDir = path.join(outRoot, 'pynguin', benchmark.id)
    const fixtureDir = path.join(caseDir, 'fixture')
    const testsDir = path.join(caseDir, 'tests')
    const reportDir = path.join(caseDir, 'pynguin-report')
    fs.mkdirSync(fixtureDir, { recursive: true })
    fs.mkdirSync(testsDir, { recursive: true })
    fs.mkdirSync(reportDir, { recursive: true })

    const sourcePath = path.join(fixtureDir, `${benchmark.pythonModule}.py`)
    fs.copyFileSync(benchmark.pythonSource, sourcePath)

    const pynguinExecutable = process.env.PYNGUIN_EXECUTABLE
        ?? path.join(projectRoot, '.venv/bin/pynguin')
    const pythonExecutable = process.env.TESTGEN_PYTHON_EXECUTABLE
        ?? path.join(projectRoot, '.venv/bin/python')
    const env = {
        ...process.env,
        PYNGUIN_DANGER_AWARE: '1',
        PYTHONPATH: fixtureDir
    }

    const generation = await runCommand(pynguinExecutable, [
        '--no-rich',
        '--project-path', fixtureDir,
        '--module-name', benchmark.pythonModule,
        '--output-path', testsDir,
        '--maximum-search-time', String(budgetSeconds),
        '--seed', '1',
        '--create-coverage-report', 'true',
        '--report-dir', reportDir
    ], {
        cwd: caseDir,
        env,
        timeoutMs: (budgetSeconds + 45) * 1000
    })
    const generationLogs = appendCommandLogs(caseDir, 'pynguin-generate', generation)

    const testFiles = listFilesRecursive(testsDir).filter((filePath) => filePath.endsWith('.py'))
    const generatedTestPath = testFiles[0]
    const coveragePath = path.join(caseDir, 'coverage.json')
    let coverageRun: CommandResult | null = null
    let coverageJson: CommandResult | null = null

    if (generatedTestPath) {
        coverageRun = await runCommand(pythonExecutable, [
            '-m', 'coverage',
            'run',
            '--branch',
            '-m', 'pytest',
            '-q',
            testsDir
        ], {
            cwd: caseDir,
            env: {
                ...env,
                COVERAGE_FILE: path.join(caseDir, '.coverage.pynguin')
            },
            timeoutMs: (budgetSeconds + 45) * 1000
        })
        appendCommandLogs(caseDir, 'pynguin-pytest-coverage', coverageRun)

        coverageJson = await runCommand(pythonExecutable, [
            '-m', 'coverage',
            'json',
            '-o', coveragePath
        ], {
            cwd: caseDir,
            env: {
                ...env,
                COVERAGE_FILE: path.join(caseDir, '.coverage.pynguin')
            },
            timeoutMs: 30_000
        })
        appendCommandLogs(caseDir, 'pynguin-coverage-json', coverageJson)
    }

    const generatedTestCount = generatedTestPath ? countPattern(generatedTestPath, /^\s*def\s+test_/gm) : 0
    const xfailCount = generatedTestPath ? countPattern(generatedTestPath, /pytest\.mark\.xfail/g) : 0
    const notes: string[] = []

    if (generation.exitCode !== 0) {
        notes.push(generation.timedOut ? 'Pynguin generation timed out.' : 'Pynguin generation exited non-zero.')
    }
    if (!generatedTestPath) {
        notes.push('Pynguin did not emit a pytest file.')
    }
    if (coverageRun && coverageRun.exitCode !== 0) {
        notes.push(coverageRun.timedOut ? 'Generated pytest suite timed out under coverage.py.' : 'Generated pytest suite failed under coverage.py.')
    }
    if (coverageJson && coverageJson.exitCode !== 0) {
        notes.push('coverage.py failed to write JSON output.')
    }
    if (xfailCount > 0) {
        notes.push(`${xfailCount}/${generatedTestCount} generated tests are xfail exception-oriented tests.`)
    }

    const status: BaselineStatus = generation.exitCode === 0
        && Boolean(generatedTestPath)
        && (!coverageRun || coverageRun.exitCode === 0)
        && (!coverageJson || coverageJson.exitCode === 0)
        ? 'passed'
        : 'failed'

    return {
        tool: 'pynguin',
        benchmark: benchmark.name,
        language: 'python',
        status,
        budgetSeconds,
        generatedTestCount,
        coverage: parseCoveragePyJson(coveragePath),
        paths: {
            caseDir,
            source: sourcePath,
            generatedTests: generatedTestPath,
            coverage: fs.existsSync(coveragePath) ? coveragePath : undefined,
            report: reportDir,
            stdout: generationLogs.stdout,
            stderr: generationLogs.stderr
        },
        notes
    }
}

function normalizeJavaSource(benchmark: Benchmark, source: string): string {
    if (benchmark.javaNormalizer === 'basic') {
        return source
            .replace(/\bstring\b/g, 'String')
            .replace(
                'return f"The values of x and y are {x} and {y}\\n";',
                'return "The values of x and y are " + x + " and " + y + "\\n";'
            )
            .replace('if (loopCounter % 5) {', 'if (loopCounter % 5 != 0) {')
    }

    if (benchmark.javaNormalizer === 'dfs') {
        return source.replace('static addEdge(', 'static void addEdge(')
    }

    return source
}

function getJavaSourceClassName(source: string, fallback: string): string {
    const publicClassMatch = source.match(/\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_]\w*)\b/)
    if (publicClassMatch) {
        return publicClassMatch[1]
    }

    const classMatch = source.match(/\bclass\s+([A-Za-z_]\w*)\b/)
    return classMatch?.[1] ?? fallback
}

function parseEvoSuiteStats(statsPath: string): BaselineResult['coverage'] | undefined {
    if (!fs.existsSync(statsPath)) {
        return undefined
    }

    const [headerLine, ...rows] = fs.readFileSync(statsPath, 'utf-8').trim().split(/\r?\n/)
    if (!headerLine || rows.length === 0) {
        return undefined
    }

    const headers = headerLine.split(',')
    const criterionIndex = headers.indexOf('criterion')
    const coverageIndex = headers.indexOf('Coverage')
    const totalIndex = headers.indexOf('Total_Goals')
    const coveredIndex = headers.indexOf('Covered_Goals')
    const result: NonNullable<BaselineResult['coverage']> = { source: 'EvoSuite statistics.csv' }

    for (const row of rows) {
        const columns = row.split(',')
        const criterion = columns[criterionIndex]?.toUpperCase()
        const total = Number(columns[totalIndex] ?? 0)
        const covered = Number(columns[coveredIndex] ?? 0)
        const coveragePercent = Number(((Number(columns[coverageIndex] ?? 0)) * 100).toFixed(2))

        if (criterion === 'LINE') {
            result.line = { covered, total, percent: coveragePercent }
        } else if (criterion === 'BRANCH') {
            result.branch = { covered, total, percent: coveragePercent }
        } else if (criterion?.includes('LINE') && criterion.includes('BRANCH')) {
            result.combined = { covered, total, percent: coveragePercent }
        }
    }

    return result.line || result.branch || result.combined ? result : undefined
}

async function runEvoSuiteBaseline(benchmark: Benchmark, outRoot: string, budgetSeconds: number): Promise<BaselineResult> {
    const caseDir = path.join(outRoot, 'evosuite', benchmark.id)
    const fixtureDir = path.join(caseDir, 'fixture')
    const classesDir = path.join(caseDir, 'classes')
    const testClassesDir = path.join(caseDir, 'test-classes')
    const testsDir = path.join(caseDir, 'tests')
    const reportDir = path.join(caseDir, 'evosuite-report')
    const workDir = path.join(caseDir, 'evosuite-work')
    for (const dir of [fixtureDir, classesDir, testClassesDir, testsDir, reportDir, workDir]) {
        fs.mkdirSync(dir, { recursive: true })
    }

    const javaHome = process.env.EVOSUITE_JAVA_HOME ?? defaultJavaHome
    const javaExecutable = path.join(javaHome, 'bin/java')
    const javacExecutable = path.join(javaHome, 'bin/javac')
    const evosuiteJar = process.env.EVOSUITE_JAR ?? path.join(projectRoot, 'tools/evosuite/evosuite-1.0.6.jar')
    const evosuiteRuntimeJar = process.env.EVOSUITE_RUNTIME_JAR
        ?? path.join(projectRoot, 'tools/evosuite/evosuite-standalone-runtime-1.0.6.jar')
    const env = {
        ...process.env,
        JAVA_HOME: javaHome,
        PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`
    }
    const notes: string[] = []
    let missingDependency = false

    for (const requiredPath of [javaExecutable, javacExecutable, evosuiteJar, evosuiteRuntimeJar]) {
        if (!fs.existsSync(requiredPath)) {
            notes.push(`Missing required EvoSuite path: ${requiredPath}`)
            missingDependency = true
        }
    }

    const source = normalizeJavaSource(benchmark, fs.readFileSync(benchmark.javaSource, 'utf-8'))
    const sourcePath = path.join(fixtureDir, benchmark.javaFilename)
    writeFile(sourcePath, source)
    if (benchmark.javaNormalizer !== 'none') {
        notes.push('Used a baseline-only normalized Java copy; original fixture and CFG YAML were not changed.')
    }

    const className = getJavaSourceClassName(source, path.basename(benchmark.javaFilename, '.java'))
    const compileSource = !missingDependency
        ? await runCommand(javacExecutable, ['-d', classesDir, sourcePath], {
            cwd: caseDir,
            env,
            timeoutMs: 30_000
        })
        : { exitCode: 1, stdout: '', stderr: 'Missing EvoSuite dependency.', timedOut: false }
    appendCommandLogs(caseDir, 'evosuite-compile-source', compileSource)

    if (compileSource.exitCode !== 0) {
        notes.push('Java fixture copy failed to compile.')
        return {
            tool: 'evosuite',
            benchmark: benchmark.name,
            language: 'java',
            status: 'failed',
            budgetSeconds,
            generatedTestCount: 0,
            paths: { caseDir, source: sourcePath, report: reportDir },
            notes
        }
    }

    const generation = await runCommand(javaExecutable, [
        '-jar', evosuiteJar,
        '-class', className,
        '-projectCP', classesDir,
        '-base_dir', workDir,
        '-seed', '1',
        '-Dsearch_budget=' + String(budgetSeconds),
        '-Dtest_dir=' + testsDir,
        '-Dreport_dir=' + reportDir,
        '-Dassertion_strategy=ALL',
        '-criterion', 'LINE:BRANCH',
        '-Dstatistics_backend=CSV',
        '-Dshow_progress=false',
        '-Dtools_jar_location=' + path.join(javaHome, 'lib/tools.jar')
    ], {
        cwd: caseDir,
        env,
        timeoutMs: (budgetSeconds + 90) * 1000
    })
    const generationLogs = appendCommandLogs(caseDir, 'evosuite-generate', generation)

    const javaTestFiles = listFilesRecursive(testsDir).filter((filePath) => filePath.endsWith('.java'))
    const generatedTestPath = javaTestFiles.find((filePath) => /_ESTest\.java$/.test(filePath))
    const generatedTestCount = generatedTestPath ? countPattern(generatedTestPath, /@Test\b/g) : 0

    if (generation.exitCode !== 0) {
        notes.push(generation.timedOut ? 'EvoSuite generation timed out.' : 'EvoSuite generation exited non-zero.')
    }
    if (!generatedTestPath) {
        notes.push('EvoSuite did not emit an ESTest Java file.')
    }

    let compileTests: CommandResult | null = null
    let junitRun: CommandResult | null = null
    if (generatedTestPath) {
        compileTests = await runCommand(javacExecutable, [
            '-cp', [classesDir, evosuiteRuntimeJar, evosuiteJar].join(path.delimiter),
            '-d', testClassesDir,
            ...javaTestFiles
        ], {
            cwd: caseDir,
            env,
            timeoutMs: 60_000
        })
        appendCommandLogs(caseDir, 'evosuite-compile-tests', compileTests)
        if (compileTests.exitCode !== 0) {
            notes.push('Generated EvoSuite tests failed to compile.')
        }

        if (compileTests.exitCode === 0) {
            const generatedClassName = path.basename(generatedTestPath, '.java')
            junitRun = await runCommand(javaExecutable, [
                '-cp', [testClassesDir, classesDir, evosuiteRuntimeJar, evosuiteJar].join(path.delimiter),
                'org.junit.runner.JUnitCore',
                generatedClassName
            ], {
                cwd: caseDir,
                env,
                timeoutMs: 60_000
            })
            appendCommandLogs(caseDir, 'evosuite-junit', junitRun)
            if (junitRun.exitCode !== 0) {
                notes.push('Generated EvoSuite JUnit suite failed when executed.')
            }
        }
    }

    const statsPath = path.join(reportDir, 'statistics.csv')
    const status: BaselineStatus = generation.exitCode === 0
        && Boolean(generatedTestPath)
        && (!compileTests || compileTests.exitCode === 0)
        && (!junitRun || junitRun.exitCode === 0)
        ? 'passed'
        : 'failed'

    return {
        tool: 'evosuite',
        benchmark: benchmark.name,
        language: 'java',
        status,
        budgetSeconds,
        generatedTestCount,
        coverage: parseEvoSuiteStats(statsPath),
        paths: {
            caseDir,
            source: sourcePath,
            generatedTests: generatedTestPath,
            coverage: fs.existsSync(statsPath) ? statsPath : undefined,
            report: reportDir,
            stdout: generationLogs.stdout,
            stderr: generationLogs.stderr
        },
        notes
    }
}

function buildKleeBasicHarness(): string {
    return `#include <cstdlib>

#ifdef KLEE
#include <klee/klee.h>
#endif

int method002(int x, int y) {
    if (x + y > 0) {
        return 1;
    }
    return 0;
}

int method005(int x, int y) {
    int loopCounter = 0;
    for (int i = 0; i < y; i += x) {
        loopCounter++;
        if (loopCounter % 5) {
            loopCounter += 2;
        }
    }
    return loopCounter;
}

int method006(int x, int y) {
    int loopCounter = 0;
    if (x > 0 && y > 0) {
        while (loopCounter < (x + y)) {
            loopCounter++;
        }
        return loopCounter;
    }
    return -1;
}

int main(int argc, char** argv) {
    int x = 0;
    int y = 0;

#ifdef KLEE
    klee_make_symbolic(&x, sizeof(x), "x");
    klee_make_symbolic(&y, sizeof(y), "y");
    klee_assume(x >= -5);
    klee_assume(x <= 5);
    klee_assume(y >= -5);
    klee_assume(y <= 5);
#else
    if (argc < 3) {
        return 2;
    }
    x = std::atoi(argv[1]);
    y = std::atoi(argv[2]);
#endif

    int positiveStep = x == 0 ? 1 : x;
    if (positiveStep < 0) {
        positiveStep = -positiveStep;
    }
    int nonNegativeLimit = y < 0 ? -y : y;

    volatile int sink = 0;
    sink += method002(x, y);
    sink += method005(positiveStep, nonNegativeLimit);
    sink += method006(x, y);
    return sink == 1234567 ? 1 : 0;
}
`
}

function parseKtestToolOutput(output: string): Array<Record<string, number>> {
    const decoded: Array<Record<string, number>> = []
    let current: Record<string, number> | null = null
    let currentName: string | null = null

    for (const line of output.split(/\r?\n/)) {
        if (line.startsWith('__KTEST_FILE__:')) {
            current = {}
            decoded.push(current)
            currentName = null
            continue
        }

        const nameMatch = line.match(/object\s+\d+:\s+name:\s+'([^']+)'/)
        if (nameMatch) {
            currentName = nameMatch[1]
            continue
        }

        const intMatch = line.match(/object\s+\d+:\s+int\s+:\s+(-?\d+)/)
        if (intMatch && current && currentName) {
            current[currentName] = Number(intMatch[1])
        }
    }

    return decoded.filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y))
}

async function resolveLlvmTool(envName: string, toolName: string): Promise<string> {
    const configured = process.env[envName]
    if (configured) {
        return configured
    }

    if (process.platform === 'darwin') {
        const xcrun = await runCommand('xcrun', ['--find', toolName], { timeoutMs: 10_000 })
        const resolved = xcrun.stdout.trim()
        if (xcrun.exitCode === 0 && resolved) {
            return resolved
        }
    }

    return toolName
}

function parseLlvmCoverage(coveragePath: string): BaselineResult['coverage'] | undefined {
    if (!fs.existsSync(coveragePath)) {
        return undefined
    }

    const parsed = JSON.parse(fs.readFileSync(coveragePath, 'utf-8')) as {
        data?: Array<{
            totals?: {
                lines?: { count?: number; covered?: number }
                branches?: { count?: number; covered?: number }
            }
        }>
    }
    const totals = parsed.data?.[0]?.totals
    if (!totals) {
        return undefined
    }

    const lineTotal = Number(totals.lines?.count ?? 0)
    const lineCovered = Number(totals.lines?.covered ?? 0)
    const branchTotal = Number(totals.branches?.count ?? 0)
    const branchCovered = Number(totals.branches?.covered ?? 0)

    return {
        source: 'llvm-cov replay over KLEE harness',
        line: {
            covered: lineCovered,
            total: lineTotal,
            percent: percent(lineCovered, lineTotal)
        },
        branch: {
            covered: branchCovered,
            total: branchTotal,
            percent: percent(branchCovered, branchTotal)
        }
    }
}

async function runKleeBaseline(benchmark: Benchmark, outRoot: string, budgetSeconds: number): Promise<BaselineResult> {
    const caseDir = path.join(outRoot, 'klee', benchmark.id)
    fs.mkdirSync(caseDir, { recursive: true })

    if (benchmark.id !== 'basic-methods') {
        return {
            tool: 'klee',
            benchmark: benchmark.name,
            language: 'c++',
            status: 'skipped',
            budgetSeconds,
            generatedTestCount: 0,
            paths: { caseDir, source: benchmark.cppSource },
            notes: ['KLEE baseline is limited to the Basic Methods primitive harness; this C++ fixture requires STL-heavy harnessing or broader manual setup.']
        }
    }

    const image = process.env.KLEE_DOCKER_IMAGE ?? defaultKleeImage
    const harnessPath = path.join(caseDir, 'basic_methods_klee_harness.cpp')
    writeFile(harnessPath, buildKleeBasicHarness())

    const dockerCompileAndRun = await runCommand('docker', [
        'run',
        '--rm',
        '--platform', 'linux/amd64',
        '-v', `${caseDir}:/work`,
        '-w', '/work',
        image,
        'bash',
        '-lc',
        `clang++ -std=c++17 -DKLEE -emit-llvm -c -g -O0 basic_methods_klee_harness.cpp -o harness.bc && timeout ${budgetSeconds}s klee --output-dir=klee-out harness.bc`
    ], {
        cwd: projectRoot,
        timeoutMs: (budgetSeconds + 60) * 1000
    })
    const kleeLogs = appendCommandLogs(caseDir, 'klee-run', dockerCompileAndRun)
    const notes: string[] = ['KLEE result uses a bounded primitive-method harness, not the full Basic Methods C++ source file.']

    if (dockerCompileAndRun.exitCode !== 0) {
        notes.push(dockerCompileAndRun.timedOut ? 'KLEE Docker run timed out.' : 'KLEE Docker run exited non-zero.')
    }

    const ktestFiles = listFilesRecursive(path.join(caseDir, 'klee-out')).filter((filePath) => filePath.endsWith('.ktest'))
    let decodedInputs: Array<Record<string, number>> = []
    if (ktestFiles.length > 0) {
        const decode = await runCommand('docker', [
            'run',
            '--rm',
            '--platform', 'linux/amd64',
            '-v', `${caseDir}:/work`,
            '-w', '/work',
            image,
            'bash',
            '-lc',
            'for f in klee-out/*.ktest; do echo "__KTEST_FILE__:$f"; ktest-tool "$f"; done'
        ], {
            cwd: projectRoot,
            timeoutMs: 60_000
        })
        appendCommandLogs(caseDir, 'klee-decode', decode)
        decodedInputs = parseKtestToolOutput(decode.stdout)
        writeFile(path.join(caseDir, 'decoded-inputs.json'), JSON.stringify(decodedInputs, null, 2))
        if (decodedInputs.length === 0) {
            notes.push('KLEE emitted .ktest files, but decoded integer inputs were unavailable.')
        }
    } else {
        notes.push('KLEE did not emit .ktest files.')
    }

    const coveragePath = path.join(caseDir, 'llvm-coverage.json')
    if (decodedInputs.length > 0) {
        const compiler = process.env.TESTGEN_CPP_COMPILER ?? 'clang++'
        const llvmProfdata = await resolveLlvmTool('TESTGEN_LLVM_PROFDATA', 'llvm-profdata')
        const llvmCov = await resolveLlvmTool('TESTGEN_LLVM_COV', 'llvm-cov')
        const binaryPath = path.join(caseDir, 'basic_methods_klee_replay')
        const compileReplay = await runCommand(compiler, [
            '-std=c++20',
            '-fprofile-instr-generate',
            '-fcoverage-mapping',
            harnessPath,
            '-o',
            binaryPath
        ], {
            cwd: caseDir,
            timeoutMs: 60_000
        })
        appendCommandLogs(caseDir, 'klee-replay-compile', compileReplay)

        if (compileReplay.exitCode === 0) {
            const profrawFiles: string[] = []
            for (let index = 0; index < decodedInputs.length; index += 1) {
                const input = decodedInputs[index]
                const profrawPath = path.join(caseDir, `replay-${index}.profraw`)
                profrawFiles.push(profrawPath)
                const replay = await runCommand(binaryPath, [String(input.x), String(input.y)], {
                    cwd: caseDir,
                    env: {
                        ...process.env,
                        LLVM_PROFILE_FILE: profrawPath
                    },
                    timeoutMs: 10_000
                })
                appendCommandLogs(caseDir, `klee-replay-${index}`, replay)
                if (replay.exitCode !== 0) {
                    notes.push(`Replay ${index} exited non-zero.`)
                }
            }

            const profdataPath = path.join(caseDir, 'merged.profdata')
            const merge = await runCommand(llvmProfdata, ['merge', '-sparse', ...profrawFiles, '-o', profdataPath], {
                cwd: caseDir,
                timeoutMs: 60_000
            })
            appendCommandLogs(caseDir, 'klee-coverage-merge', merge)

            if (merge.exitCode === 0) {
                const exportCoverage = await runCommand(llvmCov, [
                    'export',
                    binaryPath,
                    '-instr-profile=' + profdataPath,
                    '-format=text',
                    harnessPath
                ], {
                    cwd: caseDir,
                    timeoutMs: 60_000
                })
                appendCommandLogs(caseDir, 'klee-coverage-export', exportCoverage)
                if (exportCoverage.exitCode === 0) {
                    writeFile(coveragePath, exportCoverage.stdout)
                } else {
                    notes.push('llvm-cov failed to export replay coverage.')
                }
            } else {
                notes.push('llvm-profdata failed to merge replay profiles.')
            }
        } else {
            notes.push('KLEE replay harness failed to compile with LLVM coverage instrumentation.')
        }
    }

    const status: BaselineStatus = dockerCompileAndRun.exitCode === 0 && ktestFiles.length > 0 ? 'passed' : 'failed'
    return {
        tool: 'klee',
        benchmark: benchmark.name,
        language: 'c++',
        status,
        budgetSeconds,
        generatedTestCount: ktestFiles.length,
        coverage: parseLlvmCoverage(coveragePath),
        paths: {
            caseDir,
            source: harnessPath,
            generatedTests: path.join(caseDir, 'klee-out'),
            coverage: fs.existsSync(coveragePath) ? coveragePath : undefined,
            stdout: kleeLogs.stdout,
            stderr: kleeLogs.stderr
        },
        notes
    }
}

function formatMetric(metric: CoverageMetric | undefined): string {
    if (!metric) {
        return ''
    }
    return `${metric.covered}/${metric.total} (${metric.percent.toFixed(2)}%)`
}

function formatCoverage(result: BaselineResult): string {
    const line = formatMetric(result.coverage?.line)
    const branch = formatMetric(result.coverage?.branch)
    const combined = formatMetric(result.coverage?.combined)

    if (line || branch) {
        return `line=${line || 'n/a'}, branch=${branch || 'n/a'}`
    }

    if (combined) {
        return `native=${combined}`
    }

    return 'coverage=n/a'
}

function csvEscape(value: string): string {
    if (!/[",\n]/.test(value)) {
        return value
    }
    return `"${value.replace(/"/g, '""')}"`
}

function writeSummaryFiles(outDir: string, mode: 'smoke' | 'full', results: BaselineResult[]): void {
    const serializable = {
        mode,
        createdAt: new Date().toISOString(),
        projectRoot,
        results: results.map((result) => ({
            ...result,
            paths: {
                caseDir: relativePath(result.paths.caseDir),
                source: relativePath(result.paths.source),
                generatedTests: relativePath(result.paths.generatedTests),
                coverage: relativePath(result.paths.coverage),
                report: relativePath(result.paths.report),
                stdout: relativePath(result.paths.stdout),
                stderr: relativePath(result.paths.stderr)
            }
        }))
    }
    writeFile(path.join(outDir, 'summary.json'), JSON.stringify(serializable, null, 2))

    const csvRows = [
        ['tool', 'benchmark', 'language', 'status', 'budget_seconds', 'generated_tests', 'line_coverage', 'branch_coverage', 'combined_coverage', 'notes'].join(',')
    ]
    for (const result of results) {
        csvRows.push([
            result.tool,
            result.benchmark,
            result.language,
            result.status,
            String(result.budgetSeconds),
            String(result.generatedTestCount),
            formatMetric(result.coverage?.line),
            formatMetric(result.coverage?.branch),
            formatMetric(result.coverage?.combined),
            result.notes.join(' ')
        ].map(csvEscape).join(','))
    }
    writeFile(path.join(outDir, 'summary.csv'), `${csvRows.join('\n')}\n`)

    const latexRows = results.map((result) => [
        result.tool,
        result.benchmark,
        result.language,
        result.status,
        String(result.generatedTestCount),
        formatMetric(result.coverage?.line) || '--',
        formatMetric(result.coverage?.branch) || formatMetric(result.coverage?.combined) || '--'
    ].join(' & ') + ' \\\\').join('\n')

    writeFile(path.join(outDir, 'summary-latex.tex'), `\\begin{tabular}{lllcccc}
\\hline
Tool & Program & Lang. & Status & Tests & Line Cov. & Branch Cov. \\\\
\\hline
${latexRows}
\\hline
\\end{tabular}
`)
}

function selectedBenchmarksFor(mode: 'smoke' | 'full', tool: BaselineTool): Benchmark[] {
    if (mode === 'full') {
        return benchmarks
    }

    if (tool === 'pynguin') {
        return benchmarks.filter((benchmark) => benchmark.id === 'dfs')
    }
    if (tool === 'evosuite') {
        return benchmarks.filter((benchmark) => benchmark.id === 'convex-polygon')
    }
    return benchmarks.filter((benchmark) => benchmark.id === 'basic-methods')
}

async function main(): Promise<void> {
    const { mode, outDir } = parseArgs()
    const budgetSeconds = budgetSecondsFor(mode)
    fs.mkdirSync(outDir, { recursive: true })

    const results: BaselineResult[] = []

    for (const benchmark of selectedBenchmarksFor(mode, 'pynguin')) {
        console.log(`RUN Pynguin ${benchmark.name} (${budgetSeconds}s)`)
        results.push(await runPynguinBaseline(benchmark, outDir, budgetSeconds))
    }

    for (const benchmark of selectedBenchmarksFor(mode, 'evosuite')) {
        console.log(`RUN EvoSuite ${benchmark.name} (${budgetSeconds}s)`)
        results.push(await runEvoSuiteBaseline(benchmark, outDir, budgetSeconds))
    }

    for (const benchmark of selectedBenchmarksFor(mode, 'klee')) {
        console.log(`RUN KLEE ${benchmark.name} (${budgetSeconds}s)`)
        results.push(await runKleeBaseline(benchmark, outDir, budgetSeconds))
    }

    writeSummaryFiles(outDir, mode, results)

    const failed = results.filter((result) => result.status === 'failed')
    console.log(`Baseline ${mode} run wrote ${outDir}`)
    for (const result of results) {
        console.log(`${result.status.toUpperCase()} ${result.tool} ${result.benchmark}: tests=${result.generatedTestCount}, ${formatCoverage(result)}`)
    }

    if (mode === 'smoke' && failed.length > 0) {
        process.exitCode = 1
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
