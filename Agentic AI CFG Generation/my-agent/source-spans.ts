import { SourceSpan } from './cfg/schema.js'

function normalizeComparableText(value: string): string {
    return value
        .replace(/\r\n?/g, '\n')
        .replace(/\s+/g, ' ')
        .trim()
}

function stripTrailingSemicolon(value: string): string {
    return value.replace(/;\s*$/, '').trim()
}

function buildComparableNeedles(query: string): string[] {
    const normalized = normalizeComparableText(query)
    const withoutSemicolon = stripTrailingSemicolon(normalized)

    return [...new Set([normalized, withoutSemicolon].filter((value) => value.length > 0))]
}

function windowContainsQuery(windowText: string, query: string): boolean {
    const normalizedWindow = normalizeComparableText(windowText)
    const needles = buildComparableNeedles(query)

    return needles.some((needle) => normalizedWindow.includes(needle))
}

function splitLines(source: string): string[] {
    return source.split('\n')
}

function buildSearchStartIndexes(lineCount: number, preferredStartIndex: number): number[] {
    const boundedStartIndex = Math.max(0, Math.min(lineCount - 1, preferredStartIndex))
    const ordered = new Set<number>()

    for (let index = boundedStartIndex; index < lineCount; index += 1) {
        ordered.add(index)
    }

    for (let index = 0; index < boundedStartIndex; index += 1) {
        ordered.add(index)
    }

    return [...ordered]
}

export function findSourceSpanInText(
    source: string,
    query: string,
    options: {
        baseLine?: number
        preferredStartLine?: number
        maxWindowLines?: number
    } = {}
): SourceSpan | null {
    const trimmedQuery = query.trim()
    if (trimmedQuery.length === 0) {
        return null
    }

    const baseLine = options.baseLine ?? 1
    const preferredStartLine = options.preferredStartLine ?? baseLine
    const lines = splitLines(source)
    const maxWindowLines = Math.max(1, options.maxWindowLines ?? 6)

    if (lines.length === 0) {
        return null
    }

    const preferredStartIndex = Math.max(0, preferredStartLine - baseLine)
    let bestMatch: SourceSpan | null = null
    let bestWindowLength = Number.POSITIVE_INFINITY

    for (const startIndex of buildSearchStartIndexes(lines.length, preferredStartIndex)) {
        let windowText = ''

        for (let endIndex = startIndex; endIndex < Math.min(lines.length, startIndex + maxWindowLines); endIndex += 1) {
            windowText = windowText.length === 0
                ? lines[endIndex]
                : `${windowText}\n${lines[endIndex]}`

            if (!windowContainsQuery(windowText, trimmedQuery)) {
                continue
            }

            const candidate = {
                startLine: baseLine + startIndex,
                endLine: baseLine + endIndex
            }
            const windowLength = endIndex - startIndex + 1

            if (windowLength < bestWindowLength) {
                bestMatch = candidate
                bestWindowLength = windowLength
            }

            break
        }
    }

    return bestMatch
}

export class SequentialSourceSpanFinder {
    private readonly source: string
    private readonly baseLine: number
    private preferredStartLine: number

    constructor(source: string, baseLine = 1) {
        this.source = source
        this.baseLine = baseLine
        this.preferredStartLine = baseLine
    }

    findNext(query: string, maxWindowLines = 6): SourceSpan | null {
        const span = findSourceSpanInText(this.source, query, {
            baseLine: this.baseLine,
            preferredStartLine: this.preferredStartLine,
            maxWindowLines
        })

        if (span) {
            this.preferredStartLine = span.endLine
        }

        return span
    }
}
