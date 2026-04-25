import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import {
    FinalCfgDocument,
    FinalMethod,
    SourceSpan,
    finalCfgDocumentSchema
} from './schema.js'
import { discoverMethodsLocally } from '../discovery/local-discovery.js'
import { SequentialSourceSpanFinder } from '../source-spans.js'
import { readFileAtPath } from '../tools/tooling.js'

function compareNodeIds(left: string, right: string): number {
    const leftMatch = left.match(/^N(\d+)([a-z]*)$/i)
    const rightMatch = right.match(/^N(\d+)([a-z]*)$/i)

    if (!leftMatch || !rightMatch) {
        return left.localeCompare(right)
    }

    const numericDiff = Number(leftMatch[1]) - Number(rightMatch[1])
    if (numericDiff !== 0) {
        return numericDiff
    }

    return leftMatch[2].localeCompare(rightMatch[2])
}

function combineSpans(spans: Array<SourceSpan | null | undefined>): SourceSpan | null {
    const defined = spans.filter((span): span is SourceSpan => span != null)
    if (defined.length === 0) {
        return null
    }

    return {
        startLine: Math.min(...defined.map((span) => span.startLine)),
        endLine: Math.max(...defined.map((span) => span.endLine))
    }
}

function stripSyntheticReturn(statement: string): string | null {
    const match = statement.trim().match(/^_return_value\s*=\s*(.+?);?$/)
    return match ? match[1].trim() : null
}

function ensureMethodSourceSpans(method: FinalMethod, methodSource: {
    startLine: number
    endLine: number
    source: string
}): void {
    const finder = new SequentialSourceSpanFinder(methodSource.source, methodSource.startLine)
    const orderedNodeIds = Object.keys(method.nodes).sort(compareNodeIds)

    for (const nodeId of orderedNodeIds) {
        const node = method.nodes[nodeId]

        switch (node.type) {
            case 'entry':
                node.sourceSpan ??= {
                    startLine: methodSource.startLine,
                    endLine: methodSource.startLine
                }
                break
            case 'block':
                if (!node.sourceSpan) {
                    const spans = node.statements
                        .map((statement) => {
                            const syntheticReturn = stripSyntheticReturn(statement)
                            if (syntheticReturn) {
                                return finder.findNext(`return ${syntheticReturn}`)
                            }

                            return finder.findNext(statement)
                        })
                    node.sourceSpan = combineSpans(spans) ?? undefined
                }
                break
            case 'conditional':
            case 'loop': {
                const predicateSpans = node.predicates.map((envelope) => {
                    const predicate = envelope.predicate
                    predicate.sourceSpan ??= finder.findNext(predicate.statement) ?? undefined
                    return predicate.sourceSpan
                })
                node.sourceSpan ??= combineSpans(predicateSpans) ?? undefined
                break
            }
            case 'jump':
            case 'exit':
                break
        }
    }
}

export function augmentCfgDocumentWithSourceSpans(document: FinalCfgDocument, sourcePath: string): FinalCfgDocument {
    const sourceFile = readFileAtPath(sourcePath)
    const discovery = discoverMethodsLocally(sourceFile)
    const discoveredMethods = new Map(discovery.methods.map((method) => [method.name, method]))

    for (const envelope of document.methods) {
        const method = envelope.method
        const discovered = discoveredMethods.get(method.name)
        if (!discovered) {
            continue
        }

        ensureMethodSourceSpans(method, discovered)
    }

    return document
}

export function loadCfgDocumentFromString(cfgText: string, sourcePath?: string): FinalCfgDocument {
    const parsed = parse(cfgText)
    const document = finalCfgDocumentSchema.parse(parsed)

    return sourcePath
        ? augmentCfgDocumentWithSourceSpans(document, sourcePath)
        : document
}

export function loadCfgDocumentFromPath(cfgPath: string, sourcePath?: string): FinalCfgDocument {
    const resolvedPath = path.resolve(cfgPath)
    const cfgText = fs.readFileSync(resolvedPath, 'utf-8')
    return loadCfgDocumentFromString(cfgText, sourcePath)
}
