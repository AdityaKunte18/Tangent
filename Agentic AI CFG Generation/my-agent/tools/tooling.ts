import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

export interface File {
    filepath: string,
    extention: string,
    contents: string
}

export interface Export {
    name: string,
    data: string
}

const validExtentions = ['.py', '.c', '.java']

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
                filepath: file.name,
                extention,
                contents
            })
        }
    }
    // console.log(allFiles)
    return allFiles
}

export function exportfile(export_data: Export): void {
    const {name, data} = export_data
    const filename = `${name}.yaml`

    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const __path = path.join(__dirname, '../output', filename)

    fs.writeFileSync(__path, data, 'utf-8')
}

