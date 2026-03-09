import 'dotenv/config'
import { FunctionTool, LlmAgent } from '@google/adk'
import { instructions } from './instructions/instructions.js'


// export const rootAgent = new LlmAgent({
//     name: 'CFG_Generation_Agent',
//     model: '',
//     description: 'Agent to generate CFG from Python, C, & Java code',
//     instruction: instructions
// })


import { readfiles } from './tools/tooling.js'

readfiles()