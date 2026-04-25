# CFG And Test Generation Agent

This package contains two related pipelines:

1. CFG generation for the source files under `input/`
2. Python test generation from an existing CFG YAML plus the original Python source file

## Installation And Setup

Run everything from:

```bash
cd "/Users/adityakunte/Desktop/School/CS527/CS527_Project/Tangent/Agentic AI CFG Generation/my-agent"
```

Install the Node dependencies:

```bash
npm install
```

Create and activate a local Python virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install the Python dependencies used by test generation:

```bash
pip install pytest coverage
```

Create a `.env` file in this folder with your Gemini API key:

```bash
GEMINI_API_KEY="YOUR_API_KEY"
```

Point the test-generation pipeline at the local virtual environment:

```bash
export TESTGEN_PYTHON_EXECUTABLE="$(pwd)/.venv/bin/python"
```

## Verify The Setup

Run the local checks:

```bash
npm run typecheck
npm run test:cfg-regression
npm run test:test-generation-regression
```

If you want the regression suite to perform a real LLM-backed generation run as well:

```bash
RUN_LIVE_TESTGEN=1 npm run test:test-generation-regression
```

## Run All Inputs

Place source files anywhere under `input/`. The tooling walks the directory tree recursively, generates CFG YAMLs, and writes them under `output/`.

```bash
npm run dev
```

## Run One Input

If you want to generate a CFG for one file only, call the entrypoint directly:

```bash
node --import tsx -e "import { generateCfgForPath } from './cfg-generator.ts'; const yaml = await generateCfgForPath('./input/Cross Language Equivilance/Basic Methods/test.py'); process.stdout.write(yaml)" > ./output/test.py.yaml
```

## Run Test Generation For One Python Input

After you already have a CFG YAML, you can generate pytest tests for a single Python file:

```bash
node --import tsx -e "import { generateTestsForPath } from './test-generator.ts'; const result = await generateTestsForPath({ cfgPath: './output/test.py.yaml', sourcePath: './input/Cross Language Equivilance/Basic Methods/test.py', language: 'python' }); console.log(JSON.stringify(result, null, 2));"
```

Generated test artifacts are written to `generated-tests/`, including:

- the generated pytest module
- the structured JSON report
- the raw coverage JSON
