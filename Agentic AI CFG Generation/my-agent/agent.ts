import 'dotenv/config'
import { FunctionTool, LlmAgent } from '@google/adk'
import { instructions } from './instructions/instructions.js'
import { readfiles, exportfile, Export } from './tools/tooling.js'


// export const rootAgent = new LlmAgent({
//     name: 'CFG_Generation_Agent',
//     model: '',
//     description: 'Agent to generate CFG from Python, C, & Java code',
//     instruction: instructions
// })

function main() {
    console.log('starting program')
    const files = readfiles()
    console.log('files read')
    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const { filepath, contents } = file
        console.log(`Processing ${filepath}...`)

        console.log(`Processing complete`)
        console.log(`Saving results`)
        const export_data: Export = {
            name: filepath,
            data: '# Test YAML'
        }
        exportfile(export_data)
    }
}

main()