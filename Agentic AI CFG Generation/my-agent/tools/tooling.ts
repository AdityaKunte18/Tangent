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

const validExtentions = ['.py', '.cpp', '.java']

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const inputRoot = path.join(__dirname, '../input')
const outputRoot = path.join(__dirname, '../output')

function normalizeContents(contents: string): string {
    return contents.replace(/\r\n?/g, '\n')
}

function createFileRecord(filepath: string, contents: string): File {
    return {
        filepath: path.basename(filepath),
        extention: path.extname(filepath).toLocaleLowerCase(),
        contents: normalizeContents(contents)
    }
}

export function isSupportedExtention(extention: string): boolean {
    return validExtentions.includes(extention.toLocaleLowerCase())
}

export function readfiles(): File[] {
    const files: fs.Dirent[] = fs.readdirSync(inputRoot, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
    const allFiles: File[] = []
    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (!file.isFile()) {
            continue
        }

        const extention = path.extname(file.name).toLocaleLowerCase()
        if (isSupportedExtention(extention)) {
            const data = fs.readFileSync(path.join(inputRoot, file.name), 'utf-8')
            allFiles.push(createFileRecord(file.name, data))
        }
    }
    // console.log(allFiles)
    return allFiles
}

export function readFileAtPath(filepath: string): File {
    const resolvedPath = path.resolve(filepath)

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`File does not exist: ${resolvedPath}`)
    }

    const stat = fs.statSync(resolvedPath)
    if (!stat.isFile()) {
        throw new Error(`Path is not a file: ${resolvedPath}`)
    }

    const extention = path.extname(resolvedPath).toLocaleLowerCase()
    if (!isSupportedExtention(extention)) {
        throw new Error(`Unsupported file extension '${extention}'. Supported extensions: ${validExtentions.join(', ')}`)
    }

    const data = fs.readFileSync(resolvedPath, 'utf-8')
    return createFileRecord(resolvedPath, data)
}

export function exportfile(export_data: Export): void {
    const {name, data} = export_data
    const filename = `${name}.yaml`
    const __path = path.join(outputRoot, filename)

    fs.writeFileSync(__path, data, 'utf-8')
}
