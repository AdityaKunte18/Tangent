import { CfgMethodDraft, CfgNodeDraft, CfgPredicate } from './schema.js'

export interface ValidationResult {
    valid: boolean
    errors: string[]
}

function isVoidReturnType(returnType: string): boolean {
    const normalized = returnType.trim().toLowerCase()
    return normalized === 'void' || normalized === 'none'
}

function isBlank(value: string | null | undefined): boolean {
    return value == null || value.trim().length === 0
}

function isNodeTerminatorStatement(statement: string): boolean {
    return /^\s*(return|break|continue)\b/.test(statement)
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)]
}

export function validateMethodDraft(method: CfgMethodDraft): ValidationResult {
    const errors: string[] = []
    const nodeMap = new Map<string, CfgNodeDraft>()
    const predicateMap = new Map<string, CfgPredicate>()
    const predicateOwner = new Map<string, CfgNodeDraft>()

    for (const node of method.nodes) {
        if (nodeMap.has(node.id)) {
            errors.push(`Duplicate node id '${node.id}'.`)
            continue
        }
        nodeMap.set(node.id, node)
    }

    const entryNodes = method.nodes.filter((node) => node.type === 'entry')
    const exitNodes = method.nodes.filter((node) => node.type === 'exit')

    if (entryNodes.length !== 1) {
        errors.push(`Method '${method.name}' must have exactly one entry node, found ${entryNodes.length}.`)
    }

    if (exitNodes.length !== 1) {
        errors.push(`Method '${method.name}' must have exactly one exit node, found ${exitNodes.length}.`)
    }

    for (const node of method.nodes) {
        if ((node.type === 'conditional' || node.type === 'loop') && (!node.predicates || node.predicates.length === 0)) {
            errors.push(`Node '${node.id}' of type '${node.type}' must declare at least one predicate.`)
            continue
        }

        for (const predicate of node.predicates ?? []) {
            if (predicateMap.has(predicate.id)) {
                errors.push(`Duplicate predicate id '${predicate.id}'.`)
                continue
            }
            predicateMap.set(predicate.id, predicate)
            predicateOwner.set(predicate.id, node)
        }
    }

    for (const node of method.nodes) {
        switch (node.type) {
            case 'entry':
                if (node.arguments == null) {
                    errors.push(`Entry node '${node.id}' must declare an arguments array.`)
                }
                if (isBlank(node.next)) {
                    errors.push(`Entry node '${node.id}' must point to a next node.`)
                }
                break
            case 'block':
                if (!node.statements) {
                    errors.push(`Block node '${node.id}' must declare a statements array.`)
                    break
                }
                for (const statement of node.statements) {
                    if (isNodeTerminatorStatement(statement)) {
                        errors.push(`Block node '${node.id}' contains a control transfer statement '${statement}'. Use exit or jump nodes instead.`)
                    }
                }
                if (isBlank(node.next)) {
                    errors.push(`Block node '${node.id}' must point to a next node.`)
                }
                break
            case 'jump':
                if (isBlank(node.next)) {
                    errors.push(`Jump node '${node.id}' must point to a next node.`)
                }
                break
            case 'conditional':
                if (node.next != null) {
                    errors.push(`Conditional node '${node.id}' must not declare a next field.`)
                }
                break
            case 'loop':
                if (node.next != null) {
                    errors.push(`Loop node '${node.id}' must not declare a next field.`)
                }
                break
            case 'exit': {
                if (node.next !== null && node.next !== undefined) {
                    errors.push(`Exit node '${node.id}' must have next: null.`)
                }
                const returnValues = node.returnValues ?? []
                if (isVoidReturnType(method.returnType)) {
                    if (returnValues.length !== 0) {
                        errors.push(`Void/None method '${method.name}' must have an empty return list on exit.`)
                    }
                } else if (returnValues.length !== 1) {
                    errors.push(`Non-void method '${method.name}' must have exactly one return value on exit, found ${returnValues.length}.`)
                }
                break
            }
        }
    }

    for (const node of method.nodes) {
        if (node.type === 'entry' || node.type === 'block' || node.type === 'jump') {
            if (!isBlank(node.next) && !nodeMap.has(node.next!)) {
                errors.push(`Node '${node.id}' references missing next node '${node.next}'.`)
            }
        }

        if (node.type === 'conditional' || node.type === 'loop') {
            const predicates = node.predicates ?? []
            const localPredicateIds = new Set(predicates.map((predicate) => predicate.id))

            for (const predicate of predicates) {
                if (predicate.onTrue == null && predicate.onFalse == null) {
                    errors.push(`Predicate '${predicate.id}' in node '${node.id}' must have at least one outgoing edge.`)
                }

                for (const [label, ref] of [['onTrue', predicate.onTrue], ['onFalse', predicate.onFalse]] as const) {
                    if (ref == null) {
                        continue
                    }

                    if (nodeMap.has(ref)) {
                        continue
                    }

                    if (!predicateMap.has(ref)) {
                        errors.push(`Predicate '${predicate.id}' in node '${node.id}' references missing ${label} target '${ref}'.`)
                        continue
                    }

                    if (!localPredicateIds.has(ref)) {
                        errors.push(`Predicate '${predicate.id}' in node '${node.id}' references predicate '${ref}' outside its owning node.`)
                    }
                }
            }
        }
    }

    if (errors.length > 0 || entryNodes.length !== 1) {
        return {
            valid: errors.length === 0,
            errors: unique(errors)
        }
    }

    const adjacency = new Map<string, string[]>()

    const addEdge = (from: string, to: string | null | undefined): void => {
        if (to == null) {
            return
        }
        const edges = adjacency.get(from) ?? []
        edges.push(to)
        adjacency.set(from, edges)
    }

    for (const node of method.nodes) {
        const nodeKey = `node:${node.id}`

        switch (node.type) {
            case 'entry':
            case 'block':
            case 'jump':
                addEdge(nodeKey, node.next == null ? null : `node:${node.next}`)
                break
            case 'conditional':
            case 'loop': {
                const firstPredicate = node.predicates?.[0]
                if (firstPredicate) {
                    addEdge(nodeKey, `predicate:${firstPredicate.id}`)
                }
                break
            }
            case 'exit':
                adjacency.set(nodeKey, [])
                break
        }

        for (const predicate of node.predicates ?? []) {
            const predicateKey = `predicate:${predicate.id}`
            const toKeys: string[] = []

            for (const ref of [predicate.onTrue, predicate.onFalse]) {
                if (ref == null) {
                    continue
                }

                if (nodeMap.has(ref)) {
                    toKeys.push(`node:${ref}`)
                    continue
                }

                if (predicateMap.has(ref)) {
                    toKeys.push(`predicate:${ref}`)
                }
            }

            adjacency.set(predicateKey, toKeys)
        }
    }

    const entryNode = entryNodes[0]
    const startKey = `node:${entryNode.id}`
    const visited = new Set<string>()
    const queue = [startKey]

    while (queue.length > 0) {
        const current = queue.shift()
        if (!current || visited.has(current)) {
            continue
        }

        visited.add(current)

        for (const target of adjacency.get(current) ?? []) {
            if (!visited.has(target)) {
                queue.push(target)
            }
        }
    }

    for (const node of method.nodes) {
        const key = `node:${node.id}`
        if (!visited.has(key)) {
            errors.push(`Node '${node.id}' is unreachable from the entry node.`)
        }
    }

    for (const predicate of predicateMap.values()) {
        const key = `predicate:${predicate.id}`
        if (!visited.has(key)) {
            errors.push(`Predicate '${predicate.id}' is unreachable from the entry node.`)
        }
    }

    return {
        valid: errors.length === 0,
        errors: unique(errors)
    }
}
