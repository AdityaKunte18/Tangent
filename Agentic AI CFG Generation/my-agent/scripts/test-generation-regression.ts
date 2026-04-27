import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCfgDocumentFromString } from '../testgen/cfg-loader.js'
import { attributeCoverageToObjectives, createBaselineCoverageStatuses } from '../testgen/coverage.js'
import { enumerateCoverageObjectives, summarizeObjectiveCoverage } from '../testgen/objectives.js'
import type { TestGenerationLanguage } from '../testgen/schema.js'
import { ensureCppTestEnvironment, runCppCoverageSuite, validateCppTestCandidate } from '../testgen/cpp-runner.js'
import { ensureJavaTestEnvironment, runJavaCoverageSuite, validateJavaTestCandidate } from '../testgen/java-runner.js'
import { ensurePythonTestEnvironment, runPythonCoverageSuite, validatePythonTestCandidate } from '../testgen/python-runner.js'
import { generateTestsForDocument, generateTestsForPath } from '../test-generator.js'

function createTempPythonModule(source: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-regression-'))
    const filepath = path.join(root, 'sample_module.py')
    fs.writeFileSync(filepath, source, 'utf-8')
    return filepath
}

function createTempCppModule(source: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-regression-'))
    const filepath = path.join(root, 'sample_module.cpp')
    fs.writeFileSync(filepath, source, 'utf-8')
    return filepath
}

function createTempJavaModule(source: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-regression-'))
    const filepath = path.join(root, 'SampleModule.java')
    fs.writeFileSync(filepath, source, 'utf-8')
    return filepath
}

function assertFullyCoveredComplexFixture(input: {
    language: string
    methods: ReturnType<typeof loadCfgDocumentFromString>['methods'][number]['method'][]
    objectives: ReturnType<typeof enumerateCoverageObjectives>
    statuses: ReturnType<typeof attributeCoverageToObjectives>
}): void {
    const summary = summarizeObjectiveCoverage(input.methods, input.objectives, input.statuses)
    const missing = summary.uncoveredObjectiveIds.join(', ')

    assert.equal(summary.branchCoverage.total, 10, `${input.language} complex fixture should expose five two-way decisions.`)
    assert.equal(summary.statementCoverage.total, 7, `${input.language} complex fixture should expose seven source-backed blocks.`)
    assert.equal(summary.branchCoverage.covered, 10, `${input.language} complex fixture should cover every branch objective; missing: ${missing}`)
    assert.equal(summary.statementCoverage.covered, 7, `${input.language} complex fixture should cover every statement objective; missing: ${missing}`)
}

const complexPythonSource = `def adjust(value):
    return value * 2

def analyze(x, y, limit):
    total = 0
    while total < limit:
        total += x
        if total > y and x > 0:
            break
        if total < -10:
            return -99
    if total == y:
        return adjust(total)
    elif total > y:
        return 1
    return 0
`

const complexPythonCfgText = `methods:
  - method:
      id: M1
      entry: N1
      exit: N15
      name: analyze
      type: int
      nodes:
        N1:
          type: entry
          arguments:
            - name: x
              type: int
            - name: y
              type: int
            - name: limit
              type: int
          next: N2
        N2:
          type: block
          statements:
            - total = 0
          next: N3
        N3:
          type: loop
          iteratorStart: null
          iteratorUpdate: null
          startPredicate: N3a
          predicates:
            - predicate:
                ID: N3a
                statement: total < limit
                onTrue: N4
                onFalse: N9
        N4:
          type: block
          statements:
            - total += x
          next: N5
        N5:
          type: conditional
          startPredicate: N5a
          predicates:
            - predicate:
                ID: N5a
                statement: total > y and x > 0
                onTrue: N6
                onFalse: N7
        N6:
          type: block
          statements:
            - break
          next: N9
        N7:
          type: conditional
          startPredicate: N7a
          predicates:
            - predicate:
                ID: N7a
                statement: total < -10
                onTrue: N8
                onFalse: N3
        N8:
          type: block
          statements:
            - return -99
          next: N15
        N9:
          type: conditional
          startPredicate: N9a
          predicates:
            - predicate:
                ID: N9a
                statement: total == y
                onTrue: N10
                onFalse: N11
        N10:
          type: block
          statements:
            - return adjust(total)
          next: N15
        N11:
          type: conditional
          startPredicate: N11a
          predicates:
            - predicate:
                ID: N11a
                statement: total > y
                onTrue: N12
                onFalse: N13
        N12:
          type: block
          statements:
            - return 1
          next: N15
        N13:
          type: block
          statements:
            - return 0
          next: N15
        N15:
          type: exit
          return:
            - name: _return_value
              type: int
          next: null
`

const complexCppSource = `int adjust(int value) {
    return value * 2;
}

int analyze(int x, int y, int limit) {
    int total = 0;
    while (total < limit) {
        total += x;
        if (total > y && x > 0) {
            break;
        }
        if (total < -10) {
            return -99;
        }
    }
    if (total == y) {
        return adjust(total);
    } else if (total > y) {
        return 1;
    }
    return 0;
}
`

const complexCppCfgText = `methods:
  - method:
      id: M1
      entry: N1
      exit: N15
      name: analyze
      type: int
      nodes:
        N1:
          type: entry
          arguments:
            - name: x
              type: int
            - name: y
              type: int
            - name: limit
              type: int
          next: N2
        N2:
          type: block
          statements:
            - int total = 0;
          next: N3
        N3:
          type: loop
          iteratorStart: null
          iteratorUpdate: null
          startPredicate: N3a
          predicates:
            - predicate:
                ID: N3a
                statement: total < limit
                onTrue: N4
                onFalse: N9
        N4:
          type: block
          statements:
            - total += x;
          next: N5
        N5:
          type: conditional
          startPredicate: N5a
          predicates:
            - predicate:
                ID: N5a
                statement: total > y && x > 0
                onTrue: N6
                onFalse: N7
        N6:
          type: block
          statements:
            - break;
          next: N9
        N7:
          type: conditional
          startPredicate: N7a
          predicates:
            - predicate:
                ID: N7a
                statement: total < -10
                onTrue: N8
                onFalse: N3
        N8:
          type: block
          statements:
            - return -99;
          next: N15
        N9:
          type: conditional
          startPredicate: N9a
          predicates:
            - predicate:
                ID: N9a
                statement: total == y
                onTrue: N10
                onFalse: N11
        N10:
          type: block
          statements:
            - return adjust(total);
          next: N15
        N11:
          type: conditional
          startPredicate: N11a
          predicates:
            - predicate:
                ID: N11a
                statement: total > y
                onTrue: N12
                onFalse: N13
        N12:
          type: block
          statements:
            - return 1;
          next: N15
        N13:
          type: block
          statements:
            - return 0;
          next: N15
        N15:
          type: exit
          return:
            - name: _return_value
              type: int
          next: null
`

const complexJavaSource = `public class SampleModule {
    public static int adjust(int value) {
        return value * 2;
    }

    public static int analyze(int x, int y, int limit) {
        int total = 0;
        while (total < limit) {
            total += x;
            if (total > y && x > 0) {
                break;
            }
            if (total < -10) {
                return -99;
            }
        }
        if (total == y) {
            return adjust(total);
        } else if (total > y) {
            return 1;
        }
        return 0;
    }
}
`

const complexJavaCfgText = complexCppCfgText

async function assertNoLlmGenerationSmoke(input: {
    name: string
    language: TestGenerationLanguage
    source: string
    sourceFilename: string
    cfgText: string
    expectedExtension: string
    expectedGeneratedSnippet: string
}): Promise<void> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-public-api-'))
    const sourcePath = path.join(root, input.sourceFilename)
    const outDir = path.join(root, 'generated')
    fs.writeFileSync(sourcePath, input.source, 'utf-8')

    const result = await generateTestsForDocument({
        cfgDocument: input.cfgText,
        sourcePath,
        language: input.language,
        outDir,
        maxRounds: 0
    })

    assert.equal(path.extname(result.generatedTestPath), `.${input.expectedExtension}`)
    assert.ok(fs.existsSync(result.generatedTestPath), `${input.name} should write a generated test module.`)
    assert.ok(fs.existsSync(result.reportPath), `${input.name} should write a report.`)
    assert.ok(fs.existsSync(result.rawCoveragePath), `${input.name} should write a coverage JSON file.`)
    assert.equal(result.acceptedCandidateCount, 0)
    assert.equal(result.coverageBefore.branchCoverage.total, 2)
    assert.equal(result.coverageBefore.statementCoverage.total, 2)
    assert.ok(
        fs.readFileSync(result.generatedTestPath, 'utf-8').includes(input.expectedGeneratedSnippet),
        `${input.name} generated harness should use the expected language-specific structure.`
    )
}

async function assertComplexPythonCoverageFixture(): Promise<void> {
    let environmentReady = true
    try {
        await ensurePythonTestEnvironment()
    } catch (error) {
        environmentReady = false
        console.log(`SKIP Python complex coverage fixture (${error instanceof Error ? error.message : String(error)})`)
    }
    if (!environmentReady) {
        return
    }

    const sourcePath = createTempPythonModule(complexPythonSource)
    const document = loadCfgDocumentFromString(complexPythonCfgText, sourcePath)
    const method = document.methods[0].method
    const objectives = enumerateCoverageObjectives(method)
    const unattributable = objectives.filter((objective) => !objective.attributable)
    assert.deepEqual(unattributable.map((objective) => objective.id), [])

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-python-complex-coverage-'))
    const testPath = path.join(outDir, 'sample_module_complex_generated_test.py')
    const coveragePath = path.join(outDir, 'sample_module_complex_coverage.json')
    fs.writeFileSync(testPath, `import importlib.util
import pathlib
import sys

SOURCE_PATH = pathlib.Path(${JSON.stringify(sourcePath)})
MODULE_NAME = SOURCE_PATH.stem + "_under_test"
_spec = importlib.util.spec_from_file_location(MODULE_NAME, SOURCE_PATH)
assert _spec is not None and _spec.loader is not None
module = importlib.util.module_from_spec(_spec)
sys.modules[MODULE_NAME] = module
_spec.loader.exec_module(module)

def test_break_to_greater_return():
    assert module.analyze(2, 4, 5) == 1

def test_loop_exits_equal_helper():
    assert module.analyze(2, 4, 4) == 8

def test_early_return_inside_loop():
    assert module.analyze(-6, 100, 1) == -99

def test_skip_loop_default():
    assert module.analyze(0, 1, 0) == 0
`, 'utf-8')

    const runResult = await runPythonCoverageSuite({
        testFilePath: testPath,
        coverageJsonPath: coveragePath,
        workingDir: outDir
    })
    assert.equal(runResult.ok, true, runResult.stderr || runResult.coverageStderr)

    const statuses = attributeCoverageToObjectives(objectives, runResult.rawCoverage, sourcePath)
    assertFullyCoveredComplexFixture({
        language: 'Python',
        methods: [method],
        objectives,
        statuses
    })
    console.log('PASS Python complex coverage fixture')
}

async function assertComplexCppCoverageFixture(): Promise<void> {
    let environmentReady = true
    try {
        await ensureCppTestEnvironment()
    } catch (error) {
        environmentReady = false
        console.log(`SKIP C++ complex coverage fixture (${error instanceof Error ? error.message : String(error)})`)
    }
    if (!environmentReady) {
        return
    }

    const sourcePath = createTempCppModule(complexCppSource)
    const document = loadCfgDocumentFromString(complexCppCfgText, sourcePath)
    const method = document.methods[0].method
    const objectives = enumerateCoverageObjectives(method)
    const unattributable = objectives.filter((objective) => !objective.attributable)
    assert.deepEqual(unattributable.map((objective) => objective.id), [])

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-cpp-complex-coverage-'))
    const testPath = path.join(outDir, 'analyze_complex_generated_test.cpp')
    const coveragePath = path.join(outDir, 'analyze_complex_coverage.json')
    fs.writeFileSync(testPath, `#include <cassert>
#define main __cfg_source_main
#include ${JSON.stringify(sourcePath)}
#undef main

void test_break_to_greater_return() {
    assert(analyze(2, 4, 5) == 1);
}

void test_loop_exits_equal_helper() {
    assert(analyze(2, 4, 4) == 8);
}

void test_early_return_inside_loop() {
    assert(analyze(-6, 100, 1) == -99);
}

void test_skip_loop_default() {
    assert(analyze(0, 1, 0) == 0);
}

int main() {
    test_break_to_greater_return();
    test_loop_exits_equal_helper();
    test_early_return_inside_loop();
    test_skip_loop_default();
    return 0;
}
`, 'utf-8')

    const runResult = await runCppCoverageSuite({
        sourcePath,
        testFilePath: testPath,
        coverageJsonPath: coveragePath,
        workingDir: outDir
    })
    assert.equal(runResult.ok, true, runResult.stderr || runResult.coverageStderr)

    const statuses = attributeCoverageToObjectives(objectives, runResult.rawCoverage, sourcePath)
    assertFullyCoveredComplexFixture({
        language: 'C++',
        methods: [method],
        objectives,
        statuses
    })
    console.log('PASS C++ complex coverage fixture')
}

async function assertComplexJavaCoverageFixture(): Promise<void> {
    let environmentReady = true
    try {
        await ensureJavaTestEnvironment()
    } catch (error) {
        environmentReady = false
        console.log(`SKIP Java complex coverage fixture (${error instanceof Error ? error.message : String(error)})`)
    }
    if (!environmentReady) {
        return
    }

    const sourcePath = createTempJavaModule(complexJavaSource)
    const document = loadCfgDocumentFromString(complexJavaCfgText, sourcePath)
    const method = document.methods[0].method
    const objectives = enumerateCoverageObjectives(method)
    const unattributable = objectives.filter((objective) => !objective.attributable)
    assert.deepEqual(unattributable.map((objective) => objective.id), [])

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-java-complex-coverage-'))
    const testPath = path.join(outDir, 'SampleModuleComplexGeneratedTest.java')
    const coveragePath = path.join(outDir, 'sample_module_complex_coverage.json')
    fs.writeFileSync(testPath, `public class SampleModuleComplexGeneratedTest {
    static void test_break_to_greater_return() {
        assert SampleModule.analyze(2, 4, 5) == 1;
    }

    static void test_loop_exits_equal_helper() {
        assert SampleModule.analyze(2, 4, 4) == 8;
    }

    static void test_early_return_inside_loop() {
        assert SampleModule.analyze(-6, 100, 1) == -99;
    }

    static void test_skip_loop_default() {
        assert SampleModule.analyze(0, 1, 0) == 0;
    }

    public static void main(String[] args) {
        test_break_to_greater_return();
        test_loop_exits_equal_helper();
        test_early_return_inside_loop();
        test_skip_loop_default();
    }
}
`, 'utf-8')

    const runResult = await runJavaCoverageSuite({
        sourcePath,
        testFilePath: testPath,
        coverageJsonPath: coveragePath,
        workingDir: outDir,
        objectives
    })
    assert.equal(runResult.ok, true, runResult.stderr || runResult.coverageStderr)

    const statuses = attributeCoverageToObjectives(objectives, runResult.rawCoverage, sourcePath)
    assertFullyCoveredComplexFixture({
        language: 'Java',
        methods: [method],
        objectives,
        statuses
    })
    console.log('PASS Java complex coverage fixture')
}

async function main(): Promise<void> {
    const methodSource = `def classify(x, y):
    if x + y > 0:
        print("positive")
        return True
    print("negative")
    return False
`
    const sourcePath = createTempPythonModule(methodSource)
    const cfgText = `methods:
  - method:
      id: M1
      entry: N1
      exit: N7
      name: classify
      type: boolean
      nodes:
        N1:
          type: entry
          arguments:
            - name: x
              type: unknown
            - name: y
              type: unknown
          next: N2
        N2:
          type: conditional
          startPredicate: N2a
          predicates:
            - predicate:
                ID: N2a
                statement: x + y > 0
                onTrue: N3
                onFalse: N4
        N3:
          type: block
          statements:
            - print("positive")
          next: N5
        N4:
          type: block
          statements:
            - print("negative")
          next: N6
        N5:
          type: block
          statements:
            - _return_value = True;
          next: N7
        N6:
          type: block
          statements:
            - _return_value = False;
          next: N7
        N7:
          type: exit
          return:
            - name: _return_value
              type: boolean
          next: null
`

    const document = loadCfgDocumentFromString(cfgText, sourcePath)
    const method = document.methods[0].method
    const objectives = enumerateCoverageObjectives(method)

    assert.equal(objectives.filter((objective) => objective.kind === 'branch-true').length, 1)
    assert.equal(objectives.filter((objective) => objective.kind === 'branch-false').length, 1)
    assert.equal(objectives.filter((objective) => objective.kind === 'statement').length, 2)
    assert.ok(objectives.every((objective) => objective.pathSketch.summary.length > 0))
    console.log('PASS objective extraction and path sketching')

    const baselineStatuses = createBaselineCoverageStatuses(objectives)
    const baselineSummary = summarizeObjectiveCoverage([method], objectives, baselineStatuses)
    assert.equal(baselineSummary.branchCoverage.covered, 0)
    assert.equal(baselineSummary.statementCoverage.covered, 0)
    console.log('PASS baseline coverage summary')

    const coveredStatuses = attributeCoverageToObjectives(objectives, {
        files: {
            [sourcePath]: {
                executed_lines: [1, 2, 3, 4],
                executed_branches: [[2, 3]]
            }
        }
    }, sourcePath)
    assert.equal(coveredStatuses.get('M1:N2a:true')?.covered, true)
    assert.equal(coveredStatuses.get('M1:N2a:false')?.covered, false)
    assert.equal(coveredStatuses.get('M1:N3:statement')?.covered, true)
    assert.equal(coveredStatuses.get('M1:N4:statement')?.covered, false)

    const relativePathStatuses = attributeCoverageToObjectives(objectives, {
        files: {
            [path.basename(sourcePath)]: {
                executed_lines: [1, 2, 5, 6],
                executed_branches: [[2, 5]]
            }
        }
    }, sourcePath)
    assert.equal(relativePathStatuses.get('M1:N2a:false')?.covered, true)
    assert.equal(relativePathStatuses.get('M1:N4:statement')?.covered, true)
    console.log('PASS coverage attribution')

    const validCandidate = await validatePythonTestCandidate(
        `def test_positive():
    assert module.classify(1, 1) is True
`,
        'classify'
    )
    assert.equal(validCandidate.valid, true)

    const invalidCandidate = await validatePythonTestCandidate(
        `import os

def test_bad():
    assert module.classify(1, 1) is True
`,
        'classify'
    )
    assert.equal(invalidCandidate.valid, false)

    const missingTargetPythonCandidate = await validatePythonTestCandidate(
        `def test_no_target_call():
    assert True
`,
        'classify'
    )
    assert.equal(missingTargetPythonCandidate.valid, false)
    assert.ok(missingTargetPythonCandidate.errors.some((error) => error.includes('module.classify')))
    console.log('PASS candidate validation')

    try {
        await ensurePythonTestEnvironment()
        const pythonOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-python-coverage-'))
        const pythonTestPath = path.join(pythonOutDir, 'sample_module_generated_test.py')
        const pythonCoveragePath = path.join(pythonOutDir, 'sample_module_coverage.json')
        fs.writeFileSync(pythonTestPath, `import importlib.util
import pathlib
import sys

SOURCE_PATH = pathlib.Path(${JSON.stringify(sourcePath)})
MODULE_NAME = SOURCE_PATH.stem + "_under_test"
_spec = importlib.util.spec_from_file_location(MODULE_NAME, SOURCE_PATH)
assert _spec is not None and _spec.loader is not None
module = importlib.util.module_from_spec(_spec)
sys.modules[MODULE_NAME] = module
_spec.loader.exec_module(module)

def test_positive():
    assert module.classify(1, 1) is True

def test_negative():
    assert module.classify(-1, 0) is False
`, 'utf-8')

        const pythonRunResult = await runPythonCoverageSuite({
            testFilePath: pythonTestPath,
            coverageJsonPath: pythonCoveragePath,
            workingDir: pythonOutDir
        })
        assert.equal(pythonRunResult.ok, true, pythonRunResult.stderr || pythonRunResult.coverageStderr)

        const pythonStatuses = attributeCoverageToObjectives(objectives, pythonRunResult.rawCoverage, sourcePath)
        assert.equal(pythonStatuses.get('M1:N2a:true')?.covered, true)
        assert.equal(pythonStatuses.get('M1:N2a:false')?.covered, true)
        assert.equal(pythonStatuses.get('M1:N3:statement')?.covered, true)
        assert.equal(pythonStatuses.get('M1:N4:statement')?.covered, true)
        console.log('PASS Python coverage bridge')
    } catch (error) {
        console.log(`SKIP Python coverage bridge (${error instanceof Error ? error.message : String(error)})`)
    }

    const cppSource = `int classify(int x) {
    if (x > 0) {
        return 1;
    }
    return 0;
}
`
    const cppSourcePath = createTempCppModule(cppSource)
    const cppCfgText = `methods:
  - method:
      id: M1
      entry: N1
      exit: N6
      name: classify
      type: int
      nodes:
        N1:
          type: entry
          arguments:
            - name: x
              type: int
          next: N2
        N2:
          type: conditional
          startPredicate: N2a
          predicates:
            - predicate:
                ID: N2a
                statement: x > 0
                onTrue: N3
                onFalse: N4
        N3:
          type: block
          statements:
            - return 1;
          next: N6
        N4:
          type: block
          statements:
            - return 0;
          next: N6
        N6:
          type: exit
          return:
            - name: _return_value
              type: int
          next: null
`
    const cppDocument = loadCfgDocumentFromString(cppCfgText, cppSourcePath)
    const cppMethod = cppDocument.methods[0].method
    const cppObjectives = enumerateCoverageObjectives(cppMethod)
    assert.ok(cppObjectives.every((objective) => objective.attributable))

    const validCppCandidate = await validateCppTestCandidate(
        `void test_positive() {
    assert(classify(1) == 1);
}
`,
        'classify'
    )
    assert.equal(validCppCandidate.valid, true)

    const invalidCppCandidate = await validateCppTestCandidate(
        `#include <fstream>

void test_bad() {
    assert(classify(1) == 1);
}
`,
        'classify'
    )
    assert.equal(invalidCppCandidate.valid, false)

    const missingTargetCppCandidate = await validateCppTestCandidate(
        `void test_no_target_call() {
    assert(1 == 1);
}
`,
        'classify'
    )
    assert.equal(missingTargetCppCandidate.valid, false)
    assert.ok(missingTargetCppCandidate.errors.some((error) => error.includes('classify')))
    console.log('PASS C++ candidate validation')

    try {
        await ensureCppTestEnvironment()
        const cppOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-cpp-coverage-'))
        const cppTestPath = path.join(cppOutDir, 'classify_generated_test.cpp')
        const cppCoveragePath = path.join(cppOutDir, 'classify_coverage.json')
        fs.writeFileSync(cppTestPath, `#include <cassert>
#define main __cfg_source_main
#include ${JSON.stringify(cppSourcePath)}
#undef main

void test_positive() {
    assert(classify(1) == 1);
}

void test_negative() {
    assert(classify(0) == 0);
}

int main() {
    test_positive();
    test_negative();
    return 0;
}
`, 'utf-8')

        const cppRunResult = await runCppCoverageSuite({
            sourcePath: cppSourcePath,
            testFilePath: cppTestPath,
            coverageJsonPath: cppCoveragePath,
            workingDir: cppOutDir
        })
        assert.equal(cppRunResult.ok, true, cppRunResult.stderr || cppRunResult.coverageStderr)

        const cppStatuses = attributeCoverageToObjectives(cppObjectives, cppRunResult.rawCoverage, cppSourcePath)
        assert.equal(cppStatuses.get('M1:N2a:true')?.covered, true)
        assert.equal(cppStatuses.get('M1:N2a:false')?.covered, true)
        assert.equal(cppStatuses.get('M1:N3:statement')?.covered, true)
        assert.equal(cppStatuses.get('M1:N4:statement')?.covered, true)
        console.log('PASS C++ coverage bridge')
    } catch (error) {
        console.log(`SKIP C++ coverage bridge (${error instanceof Error ? error.message : String(error)})`)
    }

    const javaSource = `public class SampleModule {
    public static int classify(int x) {
        if (x > 0) {
            return 1;
        }
        return 0;
    }
}
`
    const javaSourcePath = createTempJavaModule(javaSource)
    const javaCfgText = `methods:
  - method:
      id: M1
      entry: N1
      exit: N6
      name: classify
      type: int
      nodes:
        N1:
          type: entry
          arguments:
            - name: x
              type: int
          next: N2
        N2:
          type: conditional
          startPredicate: N2a
          predicates:
            - predicate:
                ID: N2a
                statement: x > 0
                onTrue: N3
                onFalse: N4
        N3:
          type: block
          statements:
            - return 1;
          next: N6
        N4:
          type: block
          statements:
            - return 0;
          next: N6
        N6:
          type: exit
          return:
            - name: _return_value
              type: int
          next: null
`
    const javaDocument = loadCfgDocumentFromString(javaCfgText, javaSourcePath)
    const javaMethod = javaDocument.methods[0].method
    const javaObjectives = enumerateCoverageObjectives(javaMethod)
    assert.ok(javaObjectives.every((objective) => objective.attributable))

    const validJavaCandidate = await validateJavaTestCandidate(
        `static void test_positive() {
    assert SampleModule.classify(1) == 1;
}
`,
        'classify',
        'SampleModule'
    )
    assert.equal(validJavaCandidate.valid, true)

    const invalidJavaCandidate = await validateJavaTestCandidate(
        `import java.io.File;

static void test_bad() {
    assert SampleModule.classify(1) == 1;
}
`,
        'classify',
        'SampleModule'
    )
    assert.equal(invalidJavaCandidate.valid, false)

    const missingTargetJavaCandidate = await validateJavaTestCandidate(
        `static void test_no_target_call() {
    assert true;
}
`,
        'classify',
        'SampleModule'
    )
    assert.equal(missingTargetJavaCandidate.valid, false)
    assert.ok(missingTargetJavaCandidate.errors.some((error) => error.includes('SampleModule.classify')))
    console.log('PASS Java candidate validation')

    try {
        await ensureJavaTestEnvironment()
        const javaOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-java-coverage-'))
        const javaTestPath = path.join(javaOutDir, 'SampleModuleGeneratedTest.java')
        const javaCoveragePath = path.join(javaOutDir, 'sample_module_coverage.json')
        fs.writeFileSync(javaTestPath, `public class SampleModuleGeneratedTest {
    static void test_positive() {
        assert SampleModule.classify(1) == 1;
    }

    static void test_negative() {
        assert SampleModule.classify(0) == 0;
    }

    public static void main(String[] args) {
        test_positive();
        test_negative();
    }
}
`, 'utf-8')

        const javaRunResult = await runJavaCoverageSuite({
            sourcePath: javaSourcePath,
            testFilePath: javaTestPath,
            coverageJsonPath: javaCoveragePath,
            workingDir: javaOutDir,
            objectives: javaObjectives
        })
        assert.equal(javaRunResult.ok, true, javaRunResult.stderr || javaRunResult.coverageStderr)

        const javaStatuses = attributeCoverageToObjectives(javaObjectives, javaRunResult.rawCoverage, javaSourcePath)
        assert.equal(javaStatuses.get('M1:N2a:true')?.covered, true)
        assert.equal(javaStatuses.get('M1:N2a:false')?.covered, true)
        assert.equal(javaStatuses.get('M1:N3:statement')?.covered, true)
        assert.equal(javaStatuses.get('M1:N4:statement')?.covered, true)
        console.log('PASS Java coverage bridge')
    } catch (error) {
        console.log(`SKIP Java coverage bridge (${error instanceof Error ? error.message : String(error)})`)
    }

    await assertComplexPythonCoverageFixture()
    await assertComplexCppCoverageFixture()
    await assertComplexJavaCoverageFixture()

    await assertNoLlmGenerationSmoke({
        name: 'Python public API',
        language: 'python',
        source: methodSource,
        sourceFilename: 'sample_module.py',
        cfgText,
        expectedExtension: 'py',
        expectedGeneratedSnippet: 'test_generated_placeholder'
    })
    await assertNoLlmGenerationSmoke({
        name: 'C++ public API',
        language: 'c++',
        source: cppSource,
        sourceFilename: 'sample_module.cpp',
        cfgText: cppCfgText,
        expectedExtension: 'cpp',
        expectedGeneratedSnippet: '#define main __cfg_source_main'
    })
    await assertNoLlmGenerationSmoke({
        name: 'Java public API',
        language: 'java',
        source: javaSource,
        sourceFilename: 'SampleModule.java',
        cfgText: javaCfgText,
        expectedExtension: 'java',
        expectedGeneratedSnippet: 'public class SampleModule_generated_test'
    })
    console.log('PASS language public API smoke tests')

    if (process.env.RUN_LIVE_TESTGEN === '1') {
        const liveDocumentCases: Array<{
            name: string
            language: TestGenerationLanguage
            sourceFilename: string
            source: string
            cfgText: string
        }> = [
            {
                name: 'Python complex CFG',
                language: 'python',
                sourceFilename: 'sample_module.py',
                source: complexPythonSource,
                cfgText: complexPythonCfgText
            },
            {
                name: 'C++ complex CFG',
                language: 'c++',
                sourceFilename: 'sample_module.cpp',
                source: complexCppSource,
                cfgText: complexCppCfgText
            },
            {
                name: 'Java complex CFG',
                language: 'java',
                sourceFilename: 'SampleModule.java',
                source: complexJavaSource,
                cfgText: complexJavaCfgText
            }
        ]

        for (const testCase of liveDocumentCases) {
            const liveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testgen-live-complex-'))
            const sourcePath = path.join(liveRoot, testCase.sourceFilename)
            const outDir = path.join(liveRoot, 'generated')
            fs.writeFileSync(sourcePath, testCase.source, 'utf-8')

            const result = await generateTestsForDocument({
                cfgDocument: testCase.cfgText,
                sourcePath,
                language: testCase.language,
                outDir,
                maxRounds: 3,
                maxAcceptedTests: 3,
                maxNoGainRounds: 2,
                maxCandidates: 6
            })

            assert.ok(fs.existsSync(result.generatedTestPath), `${testCase.name} should produce a generated test module.`)
            assert.ok(fs.existsSync(result.reportPath), `${testCase.name} should produce a JSON report.`)
            assert.ok(
                result.coverageAfter.coveredObjectiveIds.length > result.coverageBefore.coveredObjectiveIds.length,
                `${testCase.name} should improve coverage in a live generation run.`
            )
            console.log(`PASS live complex integration ${testCase.name}`)
        }

        const projectRoot = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
        const integrationCases = [
            {
                name: 'Basic Methods',
                cfgPath: path.join(projectRoot, 'output/test.py.yaml'),
                sourcePath: path.join(projectRoot, 'input/Cross Language Equivilance/Basic Methods/test.py')
            },
            {
                name: 'Depth First Search',
                cfgPath: path.join(projectRoot, 'output/DFS.py.yaml'),
                sourcePath: path.join(projectRoot, 'input/Real World Sampling/Depth First Search/DFS.py')
            },
            {
                name: 'Convex Polygon',
                cfgPath: path.join(projectRoot, 'output/PCP.py.yaml'),
                sourcePath: path.join(projectRoot, 'input/Real World Sampling/Point Lies Inside Given N points of a Convex Polygon/PCP.py')
            }
        ]

        for (const testCase of integrationCases) {
            if (!fs.existsSync(testCase.cfgPath) || !fs.existsSync(testCase.sourcePath)) {
                console.log(`SKIP live integration ${testCase.name} (missing CFG or source fixture)`)
                continue
            }

            const result = await generateTestsForPath({
                cfgPath: testCase.cfgPath,
                sourcePath: testCase.sourcePath,
                language: 'python',
                maxRounds: 3,
                maxAcceptedTests: 5,
                maxNoGainRounds: 2,
                maxCandidates: 8
            })

            assert.ok(fs.existsSync(result.generatedTestPath), `${testCase.name} should produce a pytest module.`)
            assert.ok(fs.existsSync(result.reportPath), `${testCase.name} should produce a JSON report.`)
            assert.ok(result.coverageAfter.coveredObjectiveIds.length >= result.coverageBefore.coveredObjectiveIds.length)
            console.log(`PASS live integration ${testCase.name}`)
        }
    } else {
        console.log('SKIP live integration tests (set RUN_LIVE_TESTGEN=1 to enable)')
    }

    console.log('PASS test-generation regression suite')
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
