import { CfgMethodDraft, CfgNodeDraft, DiscoveredMethod } from './schema.js'

function isVoidReturnType(returnType: string): boolean {
    const normalized = returnType.trim().toLowerCase()
    return normalized === 'void' || normalized === 'none'
}

function parseReturnStatement(statement: string): {
    expression: string | null
    hadSemicolon: boolean
} | null {
    const trimmed = statement.trim()
    if (!trimmed.startsWith('return')) {
        return null
    }

    const body = trimmed.replace(/^return\b/, '').trim()
    const hadSemicolon = body.endsWith(';')
    const expression = body.replace(/;$/, '').trim()

    return {
        expression: expression.length > 0 ? expression : null,
        hadSemicolon
    }
}

function nextSyntheticNodeId(nodes: CfgNodeDraft[], baseId: string): string {
    let counter = 0
    let candidate = `${baseId}_normalized`
    const existingIds = new Set(nodes.map((node) => node.id))

    while (existingIds.has(candidate)) {
        counter += 1
        candidate = `${baseId}_normalized_${counter}`
    }

    return candidate
}

function buildReturnAssignment(expression: string, hadSemicolon: boolean): string {
    const suffix = hadSemicolon ? ';' : ''
    return `_return_value = ${expression}${suffix}`
}

function collectReferencedNodeIds(nodes: CfgNodeDraft[]): Set<string> {
    const referencedNodeIds = new Set<string>()

    for (const node of nodes) {
        if (node.next != null) {
            referencedNodeIds.add(node.next)
        }

        for (const predicate of node.predicates ?? []) {
            if (predicate.onTrue != null) {
                referencedNodeIds.add(predicate.onTrue)
            }

            if (predicate.onFalse != null) {
                referencedNodeIds.add(predicate.onFalse)
            }
        }
    }

    return referencedNodeIds
}

function collectPredicateTargetNodeIds(nodes: CfgNodeDraft[]): Set<string> {
    const targetNodeIds = new Set<string>()

    for (const node of nodes) {
        for (const predicate of node.predicates ?? []) {
            if (predicate.onTrue != null) {
                targetNodeIds.add(predicate.onTrue)
            }

            if (predicate.onFalse != null) {
                targetNodeIds.add(predicate.onFalse)
            }
        }
    }

    return targetNodeIds
}

function isSyntheticReturnBlock(node: CfgNodeDraft): boolean {
    return node.type === 'block' && (node.statements ?? []).some((statement) => statement.includes('_return_value'))
}

function isLikelyLoopUpdateBlock(node: CfgNodeDraft): boolean {
    if (node.type !== 'block') {
        return false
    }

    if (/update|increment|decrement/i.test(node.id)) {
        return true
    }

    const statements = node.statements ?? []
    if (statements.length !== 1) {
        return false
    }

    return /(\+\+|--|\+=|-=)/.test(statements[0])
}

function isEligibleRepairBlock(node: CfgNodeDraft): boolean {
    return node.type === 'block' && node.next == null && !isSyntheticReturnBlock(node)
}

export function normalizeDraft(method: DiscoveredMethod, draft: CfgMethodDraft): CfgMethodDraft {
    const normalized = structuredClone(draft)
    normalized.name = method.name
    normalized.returnType = method.returnType
    normalized.parameters = method.parameters

    const exitNodes = normalized.nodes.filter((node) => node.type === 'exit')
    const exitNode = exitNodes.length === 1 ? exitNodes[0] : null
    const voidMethod = isVoidReturnType(method.returnType)
    const hasBranchingNodes = normalized.nodes.some((node) => node.type === 'conditional' || node.type === 'loop')
    let syntheticReturnVariableRequired = false

    for (const node of normalized.nodes) {
        if (node.type === 'entry') {
            node.arguments = method.parameters
            continue
        }

        if (node.type === 'exit') {
            node.next = null
            node.returnValues = voidMethod ? [] : (node.returnValues ?? [])
            continue
        }

        if (node.type !== 'block') {
            continue
        }

        node.statements = node.statements ?? []
        const lastStatement = node.statements.length > 0
            ? node.statements[node.statements.length - 1]
            : undefined
        const parsedReturn = lastStatement ? parseReturnStatement(lastStatement) : null

        if (parsedReturn && exitNode) {
            node.statements = node.statements.slice(0, -1)

            if (voidMethod) {
                node.next = exitNode.id
                continue
            }

            if (parsedReturn.expression) {
                const assignmentNodeId = nextSyntheticNodeId(normalized.nodes, node.id)
                normalized.nodes.push({
                    id: assignmentNodeId,
                    type: 'block',
                    statements: [buildReturnAssignment(parsedReturn.expression, parsedReturn.hadSemicolon)],
                    next: exitNode.id
                })
                node.next = assignmentNodeId
                syntheticReturnVariableRequired = true
            }
        }

        if (!hasBranchingNodes && node.next == null && exitNode) {
            node.next = exitNode.id
        }
    }

    if (exitNode && hasBranchingNodes) {
        const nodeMap = new Map(normalized.nodes.map((node) => [node.id, node]))
        const referencedNodeIds = collectReferencedNodeIds(normalized.nodes)
        const predicateTargetIds = collectPredicateTargetNodeIds(normalized.nodes)
        const branchRoots = normalized.nodes.filter((node) => {
            return (node.type === 'conditional' || node.type === 'loop') && !referencedNodeIds.has(node.id)
        })

        if (branchRoots.length === 1) {
            const rootNode = branchRoots[0]
            const entryNode = normalized.nodes.find((node) => node.type === 'entry')
            const visited = new Set<string>()
            let currentNode = entryNode?.next ? nodeMap.get(entryNode.next) : undefined
            let reconnectCandidate: CfgNodeDraft | undefined

            while (currentNode && !visited.has(currentNode.id)) {
                visited.add(currentNode.id)

                if (currentNode.type !== 'block' && currentNode.type !== 'jump') {
                    break
                }

                reconnectCandidate = currentNode

                if (currentNode.next == null || currentNode.next === exitNode.id) {
                    break
                }

                currentNode = nodeMap.get(currentNode.next)
            }

            if (reconnectCandidate && reconnectCandidate.id !== rootNode.id && (reconnectCandidate.next == null || reconnectCandidate.next === exitNode.id)) {
                reconnectCandidate.next = rootNode.id
            }
        }

        for (const loopNode of normalized.nodes.filter((node) => node.type === 'loop')) {
            for (const predicate of loopNode.predicates ?? []) {
                const trueTarget = predicate.onTrue ? nodeMap.get(predicate.onTrue) : undefined

                if (!trueTarget || trueTarget.type !== 'block') {
                    continue
                }

                const usesSyntheticReturn = (trueTarget.statements ?? []).some((statement) => statement.includes('_return_value'))
                if (usesSyntheticReturn && trueTarget.next == null) {
                    trueTarget.next = exitNode.id
                    continue
                }

                if (!usesSyntheticReturn && (trueTarget.next == null || trueTarget.next === exitNode.id)) {
                    trueTarget.next = loopNode.id
                }
            }
        }

        const danglingBranchBlocks = normalized.nodes.filter((node) => {
            return node.type === 'block' && node.next == null && predicateTargetIds.has(node.id)
        })

        if (voidMethod) {
            for (const block of danglingBranchBlocks) {
                block.next = exitNode.id
            }
        } else {
            const unreferencedSyntheticBlocks = normalized.nodes.filter((node) => {
                return isSyntheticReturnBlock(node) && !referencedNodeIds.has(node.id)
            })

            for (const block of danglingBranchBlocks) {
                if (block.next != null) {
                    continue
                }

                const syntheticTarget = unreferencedSyntheticBlocks.shift()
                if (syntheticTarget) {
                    block.next = syntheticTarget.id
                }
            }
        }

        for (const loopNode of normalized.nodes.filter((node) => node.type === 'loop')) {
            const loopIndex = normalized.nodes.findIndex((node) => node.id === loopNode.id)
            const predecessor = normalized.nodes.find((node) => {
                return (node.type === 'entry' || node.type === 'block' || node.type === 'jump') && node.next === loopNode.id
            })

            const initCandidate = [...normalized.nodes]
                .slice(0, loopIndex)
                .reverse()
                .find((node) => {
                    return isEligibleRepairBlock(node) && !referencedNodeIds.has(node.id) && !predicateTargetIds.has(node.id)
                })

            if (predecessor && initCandidate && predecessor.id !== initCandidate.id) {
                initCandidate.next = loopNode.id
                predecessor.next = initCandidate.id
            }

            const updateCandidate = normalized.nodes
                .slice(loopIndex + 1)
                .find((node) => {
                    return isEligibleRepairBlock(node)
                        && !referencedNodeIds.has(node.id)
                        && !predicateTargetIds.has(node.id)
                        && isLikelyLoopUpdateBlock(node)
                })

            if (updateCandidate) {
                updateCandidate.next = loopNode.id

                for (const predicate of loopNode.predicates ?? []) {
                    const trueTarget = predicate.onTrue ? nodeMap.get(predicate.onTrue) : undefined

                    if (!trueTarget || trueTarget.type !== 'block' || trueTarget.id === updateCandidate.id) {
                        continue
                    }

                    if (trueTarget.next == null || trueTarget.next === loopNode.id) {
                        trueTarget.next = updateCandidate.id
                    }
                }
            }
        }
    }

    if (exitNode) {
        for (const node of normalized.nodes) {
            if (node.type !== 'block' || node.next != null) {
                continue
            }

            const usesSyntheticReturn = (node.statements ?? []).some((statement) => statement.includes('_return_value'))
            if (usesSyntheticReturn) {
                node.next = exitNode.id
            }
        }
    }

    if (exitNode) {
        if (voidMethod) {
            exitNode.returnValues = []
        } else if (syntheticReturnVariableRequired || (exitNode.returnValues?.length ?? 0) === 0) {
            exitNode.returnValues = [
                {
                    name: '_return_value',
                    type: method.returnType
                }
            ]
        }
    }

    return normalized
}
