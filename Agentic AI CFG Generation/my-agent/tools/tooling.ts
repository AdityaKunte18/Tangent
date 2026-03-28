import * as fs from 'fs'
import * as path from 'path'
import { exit } from 'process'
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
    let files: string[] = []
    console.log(inputRoot)
    files = recursivewalk(inputRoot)

    if (files.length == 0) {
        console.error('No files found')
        exit(-1)
    }

    const output: File[] = []

    for (let i = 0; i < files.length; i++) {
        const data = fs.readFileSync(files[i], 'utf-8')
        output.push(createFileRecord(files[i], data))
    }
    if (output.length == 0) {
        console.error('No output files generated')
        exit(-1)
    }
    return output
}

function recursivewalk(rootdir: string): string[] {
    let files: string[] = []
    const entries = fs.readdirSync(rootdir)
    for (let i = 0; i < entries.length; i++) {
        const entry: string = entries[i]
        const updatedpath = path.join(rootdir, entry)
        const stat = fs.statSync(updatedpath)
        if (stat.isDirectory()) {
            const newFiles = recursivewalk(updatedpath)
            files = [...files, ...newFiles]
        } else {
            if (!stat.isFile()) continue
            const entention = path.extname(updatedpath).toLocaleLowerCase()
            if (!isSupportedExtention(entention)) continue
            files.push(updatedpath)
        }
    }
    return files
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
