# CFG Generation Agent

## Installation and Setup

1. Go to ``my-agent/`` folder:


2. Install dependencies with ``npm install``: 

3. Create a `.env` file in this folder to set the GEMINI API key:

```bash
GEMINI_API_KEY="MYAPIKEY"
```

## Testing

```bash
npm run test:cfg-regression
```

### Running Inputs

Place source files in the `input/` folde and then run:

```bash
npm run dev
```

The CFG generator will process files in `input/` and write corresponding .yaml files into `output/`.

### Running a single input

You can just import the ``generateCfgForPath`` function:

```bash
node --import tsx -e "import { generateCfgForPath } from './cfg-generator.ts'; const yaml = await generateCfgForPath('./input/test.py'); process.stdout.write(yaml)" > ./output/test.py.yaml
```