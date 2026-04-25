import { DiscoveredMethod, Parameter } from '../cfg/schema.js'
import { File } from '../tools/tooling.js'

function splitLines(source: string): string[] {
    return source.split('\n')
}

function sliceSource(lines: string[], startLine: number, endLine: number): string {
    return lines.slice(startLine - 1, endLine).join('\n').trimEnd()
}

function countIndent(line: string): number {
    let indent = 0

    for (const character of line) {
        if (character === ' ') {
            indent += 1
            continue
        }

        if (character === '\t') {
            indent += 4
            continue
        }

        break
    }

    return indent
}

function splitTopLevelCommaSeparated(text: string): string[] {
    const parts: string[] = []
    let current = ''
    let depth = 0

    for (const character of text) {
        if (character === ',' && depth === 0) {
            const trimmed = current.trim()
            if (trimmed.length > 0) {
                parts.push(trimmed)
            }
            current = ''
            continue
        }

        current += character

        if (character === '(' || character === '[' || character === '<' || character === '{') {
            depth += 1
        } else if (character === ')' || character === ']' || character === '>' || character === '}') {
            depth = Math.max(0, depth - 1)
        }
    }

    const trimmed = current.trim()
    if (trimmed.length > 0) {
        parts.push(trimmed)
    }

    return parts
}

function normalizeReturnLiteralType(expression: string): string {
    const trimmed = expression.trim()

    if (/^(true|false)$/i.test(trimmed)) {
        return 'boolean'
    }

    if (/^(f)?(["'`]).*\2$/i.test(trimmed)) {
        return 'string'
    }

    if (/^-?\d+$/.test(trimmed)) {
        return 'int'
    }

    if (/^-?\d+\.\d+$/.test(trimmed)) {
        return 'float'
    }

    return 'unknown'
}

function inferPythonReturnType(lines: string[], startIndex: number, endIndex: number): string {
    const inferredTypes = new Set<string>()
    let sawReturn = false

    for (let index = startIndex; index <= endIndex; index += 1) {
        const trimmed = lines[index].trim()
        const match = trimmed.match(/^return\b(.*)$/)

        if (!match) {
            continue
        }

        sawReturn = true
        const expression = match[1].trim()
        if (expression.length === 0) {
            continue
        }

        inferredTypes.add(normalizeReturnLiteralType(expression))
    }

    if (!sawReturn || inferredTypes.size === 0) {
        return 'None'
    }

    return inferredTypes.size === 1 ? [...inferredTypes][0] : 'unknown'
}

function parsePythonParameters(parameterText: string): Parameter[] {
    if (parameterText.trim().length === 0) {
        return []
    }

    return splitTopLevelCommaSeparated(parameterText).map((parameter) => {
        const withoutDefault = parameter.split('=')[0].trim()
        const annotationMatch = withoutDefault.match(/^(\*{0,2}[A-Za-z_]\w*)\s*:\s*(.+)$/)

        if (annotationMatch) {
            return {
                name: annotationMatch[1].replace(/^\*+/, ''),
                type: annotationMatch[2].trim()
            }
        }

        return {
            name: withoutDefault.replace(/^\*+/, ''),
            type: 'unknown'
        }
    })
}

function discoverPythonMethods(file: File): DiscoveredMethod[] {
    const lines = splitLines(file.contents)
    const methods: DiscoveredMethod[] = []
    const definitionPattern = /^(\s*)def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:/

    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(definitionPattern)
        if (!match) {
            continue
        }

        const baseIndent = countIndent(match[1])
        let endIndex = index

        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
            const candidate = lines[cursor]
            const trimmed = candidate.trim()

            if (trimmed.length === 0 || trimmed.startsWith('#')) {
                continue
            }

            if (countIndent(candidate) <= baseIndent) {
                break
            }

            endIndex = cursor
        }

        methods.push({
            name: match[2],
            returnType: match[4]?.trim() ?? inferPythonReturnType(lines, index, endIndex),
            parameters: parsePythonParameters(match[3]),
            startLine: index + 1,
            endLine: endIndex + 1,
            source: sliceSource(lines, index + 1, endIndex + 1)
        })
    }

    return methods
}

function looksLikeControlStatement(signature: string): boolean {
    const trimmed = signature.trim()

    return /^(if|for|while|switch|catch|else|do|try)\b/.test(trimmed)
        || /\b(class|interface|enum|namespace)\b/.test(trimmed)
}

function parseBraceDelimitedParameters(parameterText: string): Parameter[] {
    const trimmed = parameterText.trim()
    if (trimmed.length === 0 || trimmed === 'void') {
        return []
    }

    return splitTopLevelCommaSeparated(trimmed).map((parameter) => {
        const withoutDefault = parameter.split('=')[0].trim().replace(/\bfinal\s+/g, '')
        const nameMatch = withoutDefault.match(/([A-Za-z_]\w*)\s*(\[\])?\s*$/)

        if (!nameMatch) {
            return {
                name: withoutDefault,
                type: 'unknown'
            }
        }

        const name = nameMatch[1]
        const arraySuffix = nameMatch[2] ?? ''
        const type = withoutDefault.slice(0, nameMatch.index).trim()

        return {
            name,
            type: `${type}${arraySuffix}`.trim() || 'unknown'
        }
    })
}

function parseBraceDelimitedSignature(signature: string): {
    name: string
    returnType: string
    parameters: Parameter[]
} | null {
    const compact = signature.replace(/\s+/g, ' ').replace(/\{.*$/, '').trim()
    if (!compact.includes('(') || looksLikeControlStatement(compact)) {
        return null
    }

    const match = compact.match(/^(.*?)([A-Za-z_~]\w*)\s*\((.*)\)\s*(?:const)?$/)
    if (!match) {
        return null
    }

    const prefix = match[1]
        .replace(/\b(public|private|protected|static|final|abstract|synchronized|virtual|inline|constexpr|friend|extern)\b/g, '')
        .trim()

    return {
        name: match[2],
        returnType: prefix.length > 0 ? prefix : 'unknown',
        parameters: parseBraceDelimitedParameters(match[3])
    }
}

function findBraceDelimitedMethodEnd(lines: string[], startIndex: number): number | null {
    let depth = 0
    let inSingleQuote = false
    let inDoubleQuote = false
    let inBlockComment = false
    let sawOpeningBrace = false

    for (let index = startIndex; index < lines.length; index += 1) {
        const line = lines[index]

        for (let cursor = 0; cursor < line.length; cursor += 1) {
            const current = line[cursor]
            const next = line[cursor + 1]

            if (inBlockComment) {
                if (current === '*' && next === '/') {
                    inBlockComment = false
                    cursor += 1
                }
                continue
            }

            if (!inSingleQuote && !inDoubleQuote) {
                if (current === '/' && next === '*') {
                    inBlockComment = true
                    cursor += 1
                    continue
                }

                if (current === '/' && next === '/') {
                    break
                }
            }

            if (current === '"' && !inSingleQuote && line[cursor - 1] !== '\\') {
                inDoubleQuote = !inDoubleQuote
                continue
            }

            if (current === '\'' && !inDoubleQuote && line[cursor - 1] !== '\\') {
                inSingleQuote = !inSingleQuote
                continue
            }

            if (inSingleQuote || inDoubleQuote) {
                continue
            }

            if (current === '{') {
                depth += 1
                sawOpeningBrace = true
                continue
            }

            if (current === '}') {
                depth -= 1
                if (sawOpeningBrace && depth === 0) {
                    return index + 1
                }
            }
        }
    }

    return null
}

function discoverBraceDelimitedMethods(file: File, language: 'java' | 'c++'): DiscoveredMethod[] {
    const lines = splitLines(file.contents)
    const methods: DiscoveredMethod[] = []

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim()
        if (!line.includes('(')) {
            continue
        }

        let signature = line
        let cursor = index

        while (!signature.includes('{') && cursor + 1 < lines.length) {
            cursor += 1
            signature = `${signature} ${lines[cursor].trim()}`

            if (signature.includes(';')) {
                break
            }
        }

        if (!signature.includes('{')) {
            continue
        }

        const parsed = parseBraceDelimitedSignature(signature)
        if (!parsed) {
            continue
        }

        const endLine = findBraceDelimitedMethodEnd(lines, index)
        if (endLine == null || endLine < index + 1) {
            continue
        }

        methods.push({
            name: parsed.name,
            returnType: parsed.returnType,
            parameters: parsed.parameters,
            startLine: index + 1,
            endLine,
            source: sliceSource(lines, index + 1, endLine)
        })

        index = endLine - 1
    }

    return methods
}

export function discoverMethodsLocally(file: File): {
    language: string
    methods: DiscoveredMethod[]
} {
    switch (file.extention) {
        case '.py':
            return {
                language: 'python',
                methods: discoverPythonMethods(file)
            }
        case '.java':
            return {
                language: 'java',
                methods: discoverBraceDelimitedMethods(file, 'java')
            }
        case '.cpp':
            return {
                language: 'c++',
                methods: discoverBraceDelimitedMethods(file, 'c++')
            }
        default:
            return {
                language: 'unknown',
                methods: []
            }
    }
}
