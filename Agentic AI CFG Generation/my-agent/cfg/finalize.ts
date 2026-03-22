import {
    CfgMethodDraft,
    CfgNodeDraft,
    FinalCfgDocument,
    FinalMethod,
    FinalMethodEnvelope,
    FinalNode
} from './schema.js'
import { validateMethodDraft } from './validate.js'

function predicateSuffix(index: number): string {
    let value = index
    let suffix = ''

    do {
        suffix = String.fromCharCode(97 + (value % 26)) + suffix
        value = Math.floor(value / 26) - 1
    } while (value >= 0)

    return suffix
}

function getNodeAndPredicateMaps(method: CfgMethodDraft): {
    nodeMap: Map<string, CfgNodeDraft>
    predicateOwner: Map<string, CfgNodeDraft>
} {
    const nodeMap = new Map<string, CfgNodeDraft>()
    const predicateOwner = new Map<string, CfgNodeDraft>()

    for (const node of method.nodes) {
        nodeMap.set(node.id, node)
        for (const predicate of node.predicates ?? []) {
            predicateOwner.set(predicate.id, node)
        }
    }

    return { nodeMap, predicateOwner }
}

function getReachableNodeOrder(method: CfgMethodDraft): CfgNodeDraft[] {
    const { nodeMap, predicateOwner } = getNodeAndPredicateMaps(method)
    const entryNode = method.nodes.find((node) => node.type === 'entry')

    if (!entryNode) {
        throw new Error(`Method '${method.name}' does not have an entry node.`)
    }

    const visitedNodes = new Set<string>()
    const visitedPredicates = new Set<string>()
    const orderedNodes: CfgNodeDraft[] = []
    const queue: string[] = [`node:${entryNode.id}`]

    const enqueue = (ref: string | null | undefined): void => {
        if (ref == null) {
            return
        }

        if (nodeMap.has(ref)) {
            queue.push(`node:${ref}`)
            return
        }

        if (predicateOwner.has(ref)) {
            queue.push(`predicate:${ref}`)
        }
    }

    while (queue.length > 0) {
        const current = queue.shift()
        if (!current) {
            continue
        }

        const [kind, id] = current.split(':', 2)

        if (kind === 'node') {
            if (visitedNodes.has(id)) {
                continue
            }

            const node = nodeMap.get(id)
            if (!node) {
                continue
            }

            visitedNodes.add(id)
            orderedNodes.push(node)

            switch (node.type) {
                case 'entry':
                case 'block':
                case 'jump':
                    enqueue(node.next)
                    break
                case 'conditional':
                case 'loop':
                    enqueue(node.predicates?.[0]?.id)
                    break
                case 'exit':
                    break
            }

            continue
        }

        if (visitedPredicates.has(id)) {
            continue
        }

        visitedPredicates.add(id)

        const owner = predicateOwner.get(id)
        const predicate = owner?.predicates?.find((candidate) => candidate.id === id)
        if (!predicate) {
            continue
        }

        enqueue(predicate.onTrue)
        enqueue(predicate.onFalse)
    }

    return orderedNodes
}

function mapRef(ref: string | null | undefined, nodeIdMap: Map<string, string>, predicateIdMap: Map<string, string>): string | null {
    if (ref == null) {
        return null
    }

    return nodeIdMap.get(ref) ?? predicateIdMap.get(ref) ?? null
}

export function finalizeMethodDraft(method: CfgMethodDraft, methodIndex: number): FinalMethodEnvelope {
    const validation = validateMethodDraft(method)
    if (!validation.valid) {
        throw new Error(`Cannot finalize invalid CFG draft for method '${method.name}': ${validation.errors.join(' ')}`)
    }

    const orderedNodes = getReachableNodeOrder(method)
    const nodeIdMap = new Map<string, string>()
    const predicateIdMap = new Map<string, string>()

    orderedNodes.forEach((node, index) => {
        nodeIdMap.set(node.id, `N${index + 1}`)
    })

    orderedNodes.forEach((node, index) => {
        if (node.type !== 'conditional' && node.type !== 'loop') {
            return
        }

        const nodeNumber = index + 1
        node.predicates?.forEach((predicate, predicateIndex) => {
            predicateIdMap.set(predicate.id, `N${nodeNumber}${predicateSuffix(predicateIndex)}`)
        })
    })

    const finalNodes: Record<string, FinalNode> = {}

    for (const node of orderedNodes) {
        const finalNodeId = nodeIdMap.get(node.id)
        if (!finalNodeId) {
            continue
        }

        switch (node.type) {
            case 'entry':
                finalNodes[finalNodeId] = {
                    type: 'entry',
                    arguments: node.arguments ?? [],
                    next: mapRef(node.next, nodeIdMap, predicateIdMap)
                }
                break
            case 'block':
                finalNodes[finalNodeId] = {
                    type: 'block',
                    statements: node.statements ?? [],
                    next: mapRef(node.next, nodeIdMap, predicateIdMap)
                }
                break
            case 'conditional':
                finalNodes[finalNodeId] = {
                    type: 'conditional',
                    startPredicate: predicateIdMap.get(node.predicates?.[0]?.id ?? '') ?? '',
                    predicates: (node.predicates ?? []).map((predicate) => ({
                        predicate: {
                            ID: predicateIdMap.get(predicate.id) ?? predicate.id,
                            statement: predicate.statement,
                            onTrue: mapRef(predicate.onTrue, nodeIdMap, predicateIdMap),
                            onFalse: mapRef(predicate.onFalse, nodeIdMap, predicateIdMap)
                        }
                    }))
                }
                break
            case 'loop':
                finalNodes[finalNodeId] = {
                    type: 'loop',
                    iteratorStart: node.iteratorStart ?? null,
                    iteratorUpdate: node.iteratorUpdate ?? null,
                    startPredicate: predicateIdMap.get(node.predicates?.[0]?.id ?? '') ?? '',
                    predicates: (node.predicates ?? []).map((predicate) => ({
                        predicate: {
                            ID: predicateIdMap.get(predicate.id) ?? predicate.id,
                            statement: predicate.statement,
                            onTrue: mapRef(predicate.onTrue, nodeIdMap, predicateIdMap),
                            onFalse: mapRef(predicate.onFalse, nodeIdMap, predicateIdMap)
                        }
                    }))
                }
                break
            case 'jump':
                finalNodes[finalNodeId] = {
                    type: 'jump',
                    next: mapRef(node.next, nodeIdMap, predicateIdMap)
                }
                break
            case 'exit':
                finalNodes[finalNodeId] = {
                    type: 'exit',
                    return: node.returnValues ?? [],
                    next: null
                }
                break
        }
    }

    const originalEntry = method.nodes.find((node) => node.type === 'entry')
    const originalExit = method.nodes.find((node) => node.type === 'exit')

    if (!originalEntry || !originalExit) {
        throw new Error(`Method '${method.name}' is missing entry or exit nodes during finalization.`)
    }

    const finalMethod: FinalMethod = {
        id: `M${methodIndex + 1}`,
        entry: nodeIdMap.get(originalEntry.id) ?? 'N1',
        exit: nodeIdMap.get(originalExit.id) ?? `N${orderedNodes.length}`,
        name: method.name,
        type: method.returnType,
        nodes: finalNodes
    }

    return {
        method: finalMethod
    }
}

export function finalizeDocument(methods: CfgMethodDraft[]): FinalCfgDocument {
    return {
        methods: methods.map((method, index) => finalizeMethodDraft(method, index))
    }
}
