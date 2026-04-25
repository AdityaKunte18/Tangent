# Testing Framework Summary

This document explains how the current test-generation pipeline works, starting from an existing CFG YAML and ending with an executable generated test module plus coverage reports.

## Primary Entry Points

- Orchestration entrypoint: [`test-generator.ts`](./test-generator.ts)
- CFG/test-generation data model: [`testgen/schema.ts`](./testgen/schema.ts)
- CFG loading and source-span augmentation: [`testgen/cfg-loader.ts`](./testgen/cfg-loader.ts)
- Coverage-objective extraction and summarization: [`testgen/objectives.ts`](./testgen/objectives.ts)
- Coverage attribution: [`testgen/coverage.ts`](./testgen/coverage.ts)
- Python execution bridge: [`testgen/python-runner.ts`](./testgen/python-runner.ts)
- C++ execution bridge: [`testgen/cpp-runner.ts`](./testgen/cpp-runner.ts)
- Java execution bridge: [`testgen/java-runner.ts`](./testgen/java-runner.ts)
- Python AST validation and `coverage.py` execution: [`scripts/python_testgen_helper.py`](./scripts/python_testgen_helper.py)
- LLM prompt construction: [`testgen/instructions.ts`](./testgen/instructions.ts)
- Local source-method discovery: [`discovery/local-discovery.ts`](./discovery/local-discovery.ts)
- Source-span search helper: [`source-spans.ts`](./source-spans.ts)
- CFG schema used by test generation: [`cfg/schema.ts`](./cfg/schema.ts)
- Regression coverage for the framework itself: [`scripts/test-generation-regression.ts`](./scripts/test-generation-regression.ts)

## What The Framework Consumes

The test generator currently supports Python, C++, and Java source files and expects:

1. A CFG document, either as YAML text or a path to a YAML file
2. The original source file that the CFG was generated from

The public APIs are:

- `generateTestsForPath({ cfgPath, sourcePath, language, ... })`
- `generateTestsForDocument({ cfgDocument, sourcePath, language, ... })`

These APIs are defined in [`test-generator.ts`](./test-generator.ts), and the result shape is defined in [`testgen/schema.ts`](./testgen/schema.ts).

## What The Framework Produces

Each run writes three artifacts into `generated-tests/` by default:

1. A generated test module (`pytest` for Python, a standalone C++ harness for C++, a standalone Java harness for Java)
2. A JSON summary report
3. A coverage JSON file (`coverage.py` JSON for Python, normalized `llvm-cov` data for C++, normalized Java source-instrumentation data for Java)

The returned `TestGenerationResult` includes the file paths plus:

- coverage before and after generation
- per-method coverage summaries
- accepted and rejected candidate counts
- iteration history
- failure reasons

The artifact/result schemas live in [`testgen/schema.ts`](./testgen/schema.ts), and the files are written by [`test-generator.ts`](./test-generator.ts).

## Step 1: Parse The CFG And Normalize It Into A Typed Document

The CFG is loaded in [`testgen/cfg-loader.ts`](./testgen/cfg-loader.ts):

- YAML text is parsed with `yaml.parse(...)`
- the parsed object is validated with `finalCfgDocumentSchema`
- the loader optionally augments missing `sourceSpan` metadata when a `sourcePath` is available

The typed CFG structure comes from [`cfg/schema.ts`](./cfg/schema.ts). The test-generation layer re-exports the relevant CFG types from [`testgen/schema.ts`](./testgen/schema.ts).

## Step 2: Recover Or Augment Source Spans

Coverage attribution depends on line-level source spans. If the CFG YAML already contains `sourceSpan` values for nodes and predicates, those are used directly. If not, the loader attempts to recover them.

This happens in [`testgen/cfg-loader.ts`](./testgen/cfg-loader.ts):

- the source file is read
- methods are rediscovered locally with [`discovery/local-discovery.ts`](./discovery/local-discovery.ts)
- each CFG method is matched back to a discovered source method by name
- missing block/predicate spans are filled with a sequential text matcher

The sequential matcher is implemented in [`source-spans.ts`](./source-spans.ts). It searches the method source for the next occurrence of a statement or predicate, prefers later matches after previous hits, and uses short multi-line windows to tolerate formatting differences.

This span augmentation exists for backward compatibility with older CFG YAML files that were generated before span metadata was emitted reliably.

## Step 3: Rediscover Source Methods

The generator needs the original source text for each method, not just the CFG.

[`discovery/local-discovery.ts`](./discovery/local-discovery.ts) extracts per-method source slices and metadata from the original file. For Python, Java, and C++ it records:

- method name
- start and end line
- source text
- parsed parameters
- inferred Python return type when no annotation is present

This rediscovered method source is later passed into the LLM prompt and is also used during span augmentation.

## Step 4: Convert The CFG Into Coverage Objectives

[`testgen/objectives.ts`](./testgen/objectives.ts) turns each CFG method into a set of deterministic coverage objectives.

### Statement objectives

For every CFG block node with source-backed statements:

- create one statement objective
- ignore synthetic `_return_value = ...` statements, since those are CFG artifacts rather than source statements

### Branch objectives

For every predicate in each `conditional` or `loop` node:

- create a `branch-true` objective if `onTrue` exists
- create a `branch-false` objective if `onFalse` exists

### Attributable vs. unattributable objectives

Each objective is marked either:

- attributable: enough source-span metadata exists to map runtime coverage back to the CFG objective
- unattributable: source spans are missing, so the objective is tracked but cannot be credited deterministically

### Path sketches

Each objective also gets a path sketch:

- a reference path through CFG node/predicate IDs
- a human-readable summary such as `Enter method`, `Take TRUE on ...`, `Execute ...`, `Exit method`

The path sketch is built with a bounded breadth-first search over CFG references. That sketch is used only to guide the LLM; it does not control execution.

### Objective ordering

Objectives are sorted:

1. branch objectives first
2. statement objectives second
3. lexicographically by ID within each group

This ordering matters because the main loop always chooses the next uncovered attributable objective from the ordered list.

## Step 5: Build The LLM Prompt For One Objective

The framework generates tests one objective at a time.

[`testgen/instructions.ts`](./testgen/instructions.ts) defines both:

- the global instruction for the test-generation agent
- the per-objective prompt builder

Each prompt includes:

- target method name
- source method body
- parameter list
- return type
- uncovered target objective
- CFG method slice
- current accepted tests
- recent failed candidate reasons

The LLM is required to return JSON with exactly two fields:

- `testName`
- `code`

For Python, the `code` field must contain exactly one pytest test function and no imports. For C++, it must contain exactly one `void test_<name>()` function and no includes or `main()`. For Java, it must contain exactly one `static void test_<name>()` method and no imports, class declaration, or `main()`.

## Step 6: Run The Objective-By-Objective Generation Loop

[`test-generator.ts`](./test-generator.ts) orchestrates the full process.

At a high level the loop is:

1. Ensure the requested language's test environment is available
2. Load the CFG and enumerate all objectives
3. Start with baseline coverage where all objectives are uncovered
4. Pick the next uncovered attributable objective
5. Ask the LLM for a test candidate
6. Validate the candidate deterministically
7. Write a temporary generated test module containing all accepted tests plus the pending candidate
8. Run the suite under the language coverage runner
9. Attribute dynamic coverage back to CFG objectives
10. Accept the candidate only if it covers the target objective or improves total coverage
11. Repeat until a stopping budget is hit

The current loop uses these budgets:

- `maxRounds`
- `maxAcceptedTests`
- `maxNoGainRounds`
- `maxCandidates`
- `MAX_CANDIDATES_PER_ROUND`

For Python, the generated test module imports the target source file dynamically and then appends all accepted pytest functions. For C++, the generated harness includes the source file, renames any source-level `main` with a preprocessor guard, appends accepted `void test_*()` functions, and calls them from a generated `main()`. For Java, the generated harness compiles alongside an instrumented copy of the source class, appends accepted `static void test_*()` methods, and calls them from a generated `main()`.

## Step 7: Validate Candidates Deterministically Before Execution

Python candidates are validated through [`testgen/python-runner.ts`](./testgen/python-runner.ts), which shells out to the Python helper [`scripts/python_testgen_helper.py`](./scripts/python_testgen_helper.py).

The Python helper performs AST-based validation:

- candidate must parse successfully
- candidate must contain exactly one top-level test function
- function name must start with `test_`
- no imports are allowed inside the generated candidate
- only the `capsys` fixture is allowed
- the candidate must call `module.<target_method>(...)` at least once
- disallowed calls such as `open`, `eval`, `exec`, and `__import__` are rejected
- disallowed module roots such as `os`, `pathlib`, `subprocess`, `socket`, `requests`, and `shutil` are rejected

The validator also computes a fingerprint from call shapes, assertion shapes, and fixture usage. The orchestration loop uses that fingerprint to reject duplicate tests.

C++ candidates are validated in [`testgen/cpp-runner.ts`](./testgen/cpp-runner.ts):

- candidate must contain exactly one `void test_<name>()` function
- no includes, preprocessor directives, or generated `main()`
- candidate must call the target function directly
- process, filesystem, network, and threading APIs are rejected
- a normalized fingerprint is computed to reject duplicate tests

Java candidates are validated in [`testgen/java-runner.ts`](./testgen/java-runner.ts):

- candidate must contain exactly one `static void test_<name>()` method
- no imports, package declarations, classes, or generated `main()`
- candidate must call the target as `<SourceClass>.<target_method>(...)`
- process, filesystem, network, threading, and reflection APIs are rejected
- a normalized fingerprint is computed to reject duplicate tests

## Step 8: Execute The Generated Test Suite Under Coverage

When a candidate passes validation, [`test-generator.ts`](./test-generator.ts) writes a temporary suite and executes it through the language runner.

The Python helper then runs:

- `python -m coverage run --branch -m pytest -q <generated_test_file>`
- `python -m coverage json -o <coverage_json_path>`

The C++ runner compiles and measures the generated harness with LLVM coverage:

- `clang++ -std=c++20 -fprofile-instr-generate -fcoverage-mapping <generated_test_file> -o <binary>`
- run the binary with `LLVM_PROFILE_FILE`
- `llvm-profdata merge -sparse <profraw> -o <profdata>`
- `llvm-cov show` for executed line counts
- `llvm-cov export` for branch outcome counts

The Java runner compiles and measures the generated harness with source-level instrumentation:

- write an instrumented copy of the Java source class into the run directory
- compile the instrumented source, recorder helper, and generated harness with `javac`
- run the harness with `java -ea`
- collect executed source lines from the recorder
- derive branch outcomes from CFG target-span execution

This produces:

- test stdout/stderr
- coverage stdout/stderr
- raw or normalized coverage JSON

The generated tests are therefore not trusted until they both:

1. execute successfully
2. produce measurable coverage improvement

## Step 9: Map Runtime Coverage Back To CFG Objectives

[`testgen/coverage.ts`](./testgen/coverage.ts) performs the deterministic attribution step.

### File matching

The coverage JSON is searched for the source file that matches the tested module path.

### Statement attribution

A statement objective is marked covered if any executed line falls inside the objective's `sourceSpan`.

### Branch attribution

A Python branch objective is marked covered if any executed branch arc in the coverage JSON travels:

- from a line within the predicate's source span
- to a line within the target branch span

A C++ branch objective is marked covered when LLVM reports the matching true/false branch outcome on the predicate line and the target span has executed line coverage.

A Java branch objective is marked covered when the instrumented run executes the CFG target span for the matching predicate outcome.

### Unattributable objectives

If source spans are missing, the objective stays visible in the report but is explicitly marked unattributable instead of being guessed.

## Step 10: Summarize Coverage At The Method And Module Levels

[`testgen/objectives.ts`](./testgen/objectives.ts) also builds the coverage summaries used in reports.

For each method, the summary tracks:

- branch coverage counts and percent
- statement coverage counts and percent
- covered objective IDs
- uncovered objective IDs
- unattributable objective IDs

The module-level report aggregates the same buckets across all methods.

This is why the framework can report both:

- overall module progress
- the specific methods and CFG objectives that still need tests

## Acceptance Rules

A candidate test is accepted only if all of the following are true:

1. it passes deterministic validation
2. it executes successfully under the language runner
3. it is not a duplicate
4. it either:
   - covers the targeted CFG objective, or
   - increases overall attributable coverage

Passing tests that do not improve coverage are rejected to keep the generated suite from growing without benefit.

## Regression Tests For The Framework

[`scripts/test-generation-regression.ts`](./scripts/test-generation-regression.ts) exercises the framework itself.

It covers:

- objective extraction and path sketching
- baseline coverage summaries
- mapping raw coverage back to CFG objectives
- validation of valid and invalid generated candidates
- C++ LLVM coverage bridge attribution
- Java validation and source-instrumented coverage bridge attribution
- optional live end-to-end runs when `RUN_LIVE_TESTGEN=1`

This regression script is the fastest way to verify that the framework still behaves correctly after changes.

## Current Scope And Limitations

- Test generation currently supports Python, C++, and Java
- C++ coverage requires a Clang/LLVM toolchain compatible with generated instrumentation profiles
- Java coverage currently uses lightweight source instrumentation, so it works best for default-package source classes and line spans that can safely receive statement probes
- The generator is CFG-driven, but the concrete input/assertion proposal is still LLM-generated
- Coverage attribution depends on reliable source spans
- The scheduler is currently greedy and objective-by-objective, which can limit coverage efficiency on larger modules

## Short Version

The testing framework is a hybrid system:

- deterministic code owns CFG parsing, objective extraction, validation, execution, coverage measurement, and acceptance
- the LLM only proposes one concrete test candidate for one uncovered objective at a time

That separation is the key design choice in the current implementation.
