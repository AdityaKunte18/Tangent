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
const ignoredDirectoryNames = new Set([
    '.git',
    '.hg',
    '.svn',
    '.venv',
    'venv',
    '__pycache__',
    'node_modules',
    'dist',
    'build',
    'target',
    'out',
    'bin',
    'obj',
    'coverage',
    '.mypy_cache',
    '.pytest_cache'
])

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const inputRoot = path.join(__dirname, '../input')
const outputRoot = path.join(__dirname, '../output')

function normalizeContents(contents: string): string {
    return contents.replace(/\r\n?/g, '\n')
}

function createFileRecord(filepath: string, contents: string, displayPath?: string): File {
    return {
        filepath: displayPath ?? path.basename(filepath),
        extention: path.extname(filepath).toLocaleLowerCase(),
        contents: normalizeContents(contents)
    }
}

export function isSupportedExtention(extention: string): boolean {
    return validExtentions.includes(extention.toLocaleLowerCase())
}

function collectSourceFilePaths(rootDir: string): string[] {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
    const files: string[] = []

    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name)

        if (entry.isDirectory()) {
            if (ignoredDirectoryNames.has(entry.name)) {
                continue
            }

            files.push(...collectSourceFilePaths(entryPath))
            continue
        }

        if (!entry.isFile()) {
            continue
        }

        const extention = path.extname(entry.name).toLocaleLowerCase()
        if (!isSupportedExtention(extention)) {
            continue
        }

        files.push(entryPath)
    }

    return files
}

export function readFilesFromRoot(rootDir: string): File[] {
    const resolvedRoot = path.resolve(rootDir)
    const files = collectSourceFilePaths(resolvedRoot)

    return files.map((filepath) => {
        const data = fs.readFileSync(filepath, 'utf-8')
        const relativePath = path.relative(resolvedRoot, filepath)
        return createFileRecord(filepath, data, relativePath)
    })
}

export function readfiles(): File[] {
    return readFilesFromRoot(inputRoot)
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

    fs.mkdirSync(path.dirname(__path), { recursive: true })
    fs.writeFileSync(__path, data, 'utf-8')
}
