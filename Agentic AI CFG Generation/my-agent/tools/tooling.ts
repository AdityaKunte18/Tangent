import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

export interface File {
    filepath: string,
    extention: string,
    contents: string
}

const validExtentions = ['.py', '.c', '.java']

/**
 * Reads all of the files in a directory and 
 */
export function readfiles(): File[] {
    const root = './input'
    const files: fs.Dirent[] = fs.readdirSync(root, { withFileTypes: true })
    const allFiles: File[] = []
    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const extention = path.extname(file.name).toLocaleLowerCase()
        if (validExtentions.includes(extention)) {
            const __filename = fileURLToPath(import.meta.url)
            const __dirname = path.dirname(__filename)
            const data = fs.readFileSync(path.join(__dirname, '../input', file.name), 'utf-8')
            let contents = data
            contents = contents.replace(/\r\n/g, ' ') // Note to self: It might be better to have these in here for the agent, might not. If agent is having issues, try removing this line
            allFiles.push({
                filepath: path.join(__dirname, file.name),
                extention,
                contents
            })
        }
    }
    console.log(allFiles)
    return allFiles
}

