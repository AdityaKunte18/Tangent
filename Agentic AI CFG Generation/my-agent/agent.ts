import 'dotenv/config'
import { FunctionTool, InvocationContext, LlmAgent, ContentEvent, Session, BaseSessionService, InMemorySessionService, Runner, EventType } from '@google/adk'
import { instructions } from './instructions/instructions.js'
import { readfiles, exportfile, Export } from './tools/tooling.js'

const APP_NAME = 'CFG_GENERATION'
const USER_ID = 'user_1'
const SESSION_ID = 'S_001'

export const rootAgent = new LlmAgent({
    name: 'CFG_Generation_Agent',
    model: 'gemini-2.5-flash',
    description: 'Agent to generate CFG from Python, C, & Java code',
    instruction: instructions,
})


const sessionService = new InMemorySessionService()

const runner = new Runner({
    agent: rootAgent,
    appName: APP_NAME,
    sessionService
})


async function main() {
    console.log('starting program')
    const files = readfiles()
    console.log('files read')
    await sessionService.createSession({
        appName: APP_NAME,
        userId: USER_ID,
        sessionId: SESSION_ID
    })


    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const { filepath, contents } = file
        console.log(`Processing ${filepath}...`)


        const stream = runner.runAsync({
            userId: USER_ID,
            sessionId: SESSION_ID,
            newMessage: {
                role: 'user',
                parts: [
                    {
                        text: contents
                    }
                ]
            }
        })

        let output = ''

        for await (const event of stream) {
            if (event.content?.parts) {
                for (const part of event.content.parts) {
                    if (part.text) {
                        output += part.text
                    }
                }
            }
        }
        

        console.log(`Processing complete`)
        console.log(`Saving results`)
        const export_data: Export = {
            name: filepath,
            data: output
        }
        exportfile(export_data)
    }
}

main()