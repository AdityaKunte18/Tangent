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

function nextSyntheticPredicateId(nodes: CfgNodeDraft[], baseId: string): string {
    let counter = 0
    let candidate = `${baseId}_predicate`
    const existingIds = new Set(
        nodes.flatMap((node) => (node.predicates ?? []).map((predicate) => predicate.id))
    )

    while (existingIds.has(candidate)) {
        counter += 1
        candidate = `${baseId}_predicate_${counter}`
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

function buildPredicateMap(nodes: CfgNodeDraft[]): Map<string, { predicate: NonNullable<CfgNodeDraft['predicates']>[number], owner: CfgNodeDraft }> {
    const predicateMap = new Map<string, { predicate: NonNullable<CfgNodeDraft['predicates']>[number], owner: CfgNodeDraft }>()

    for (const node of nodes) {
        for (const predicate of node.predicates ?? []) {
            predicateMap.set(predicate.id, {
                predicate,
                owner: node
            })
        }
    }

    return predicateMap
}

function buildGraphIndex(nodes: CfgNodeDraft[]): {
    nodeMap: Map<string, CfgNodeDraft>
    referencedNodeIds: Set<string>
    predicateTargetIds: Set<string>
    inboundCounts: Map<string, number>
} {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]))
    const referencedNodeIds = collectReferencedNodeIds(nodes)
    const predicateTargetIds = collectPredicateTargetNodeIds(nodes)
    const inboundCounts = new Map<string, number>()

    const addInbound = (targetId: string | null | undefined): void => {
        if (targetId == null || !nodeMap.has(targetId)) {
            return
        }

        inboundCounts.set(targetId, (inboundCounts.get(targetId) ?? 0) + 1)
    }

    for (const node of nodes) {
        addInbound(node.next)

        for (const predicate of node.predicates ?? []) {
            addInbound(predicate.onTrue)
            addInbound(predicate.onFalse)
        }
    }

    return {
        nodeMap,
        referencedNodeIds,
        predicateTargetIds,
        inboundCounts
    }
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

function extractVariableName(expression: string | null | undefined): string | null {
    if (!expression) {
        return null
    }

    const trimmed = expression.trim().replace(/;$/, '')
    const updateMatch = trimmed.match(/([A-Za-z_]\w*)\s*(?:\+\+|--|\+=|-=)/)
    if (updateMatch) {
        return updateMatch[1]
    }

    const assignmentMatch = trimmed.match(/([A-Za-z_]\w*)\s*=\s*[^=]/)
    if (assignmentMatch) {
        return assignmentMatch[1]
    }

    return null
}

function inferLoopVariable(loopNode: CfgNodeDraft): string | null {
    const directVariable = extractVariableName(loopNode.iteratorUpdate) ?? extractVariableName(loopNode.iteratorStart)
    if (directVariable) {
        return directVariable
    }

    const predicateStatement = loopNode.predicates?.[0]?.statement?.trim()
    if (!predicateStatement) {
        return null
    }

    const predicateMatch = predicateStatement.match(/^([A-Za-z_]\w*)\s*(?:<|<=|>|>=|==|!=)/)
    return predicateMatch?.[1] ?? null
}

function findLoopUpdateBlock(
    nodes: CfgNodeDraft[],
    loopNode: CfgNodeDraft,
    loopIndex: number
): CfgNodeDraft | undefined {
    const loopVariable = inferLoopVariable(loopNode)
    const candidates = nodes
        .slice(loopIndex + 1)
        .filter((node) => node.type === 'block' && isLikelyLoopUpdateBlock(node))

    if (loopVariable) {
        return candidates.find((node) => {
            const statement = node.statements?.[0]
            return extractVariableName(statement) === loopVariable
        })
    }

    return candidates[0]
}

function collectLoopLeafBlocks(
    loopNode: CfgNodeDraft,
    nodeMap: Map<string, CfgNodeDraft>,
    predicateMap: Map<string, { predicate: NonNullable<CfgNodeDraft['predicates']>[number], owner: CfgNodeDraft }>
): CfgNodeDraft[] {
    const leaves: CfgNodeDraft[] = []
    const visitedRefs = new Set<string>()
    const queue: string[] = (loopNode.predicates ?? [])
        .map((predicate) => predicate.onTrue)
        .filter((target): target is string => target != null)

    while (queue.length > 0) {
        const ref = queue.shift()
        if (!ref || visitedRefs.has(ref)) {
            continue
        }

        visitedRefs.add(ref)

        const targetNode = nodeMap.get(ref)
        if (targetNode) {
            if (targetNode.id === loopNode.id || targetNode.type === 'exit') {
                continue
            }

            if (targetNode.type === 'loop' && targetNode.id !== loopNode.id) {
                continue
            }

            if (targetNode.type === 'block') {
                if (isSyntheticReturnBlock(targetNode)) {
                    continue
                }

                if (targetNode.next == null || targetNode.next === loopNode.id) {
                    leaves.push(targetNode)
                    continue
                }

                queue.push(targetNode.next)
                continue
            }

            if (targetNode.type === 'conditional') {
                for (const predicate of targetNode.predicates ?? []) {
                    if (predicate.onTrue) {
                        queue.push(predicate.onTrue)
                    }
                    if (predicate.onFalse) {
                        queue.push(predicate.onFalse)
                    }
                }
                continue
            }

            if (targetNode.type === 'jump' && targetNode.next && targetNode.next !== loopNode.id) {
                queue.push(targetNode.next)
            }

            continue
        }

        const predicateEntry = predicateMap.get(ref)
        if (!predicateEntry) {
            continue
        }

        for (const target of [predicateEntry.predicate.onTrue, predicateEntry.predicate.onFalse]) {
            if (target && target !== loopNode.id) {
                queue.push(target)
            }
        }
    }

    return leaves
}

function isConstantTruePredicate(statement: string | null | undefined): boolean {
    if (!statement) {
        return false
    }

    const normalized = statement.trim().replace(/[();]/g, '').toLowerCase()
    return normalized === 'true' || normalized === '1'
}

function isBreakJumpNode(node: CfgNodeDraft | undefined): boolean {
    if (!node || node.type !== 'jump') {
        return false
    }

    return node.jumpKind === 'break' || /\bbreak\b/i.test(node.id)
}

function findOrphanBreakConditional(
    nodes: CfgNodeDraft[],
    loopNode: CfgNodeDraft,
    loopIndex: number,
    nodeMap: Map<string, CfgNodeDraft>,
    inboundCounts: Map<string, number>
): CfgNodeDraft | undefined {
    const loopPredicate = loopNode.predicates?.[0]
    if (!isConstantTruePredicate(loopPredicate?.statement)) {
        return undefined
    }

    const loopBodyEntryId = loopPredicate?.onTrue ?? null

    return nodes
        .slice(loopIndex + 1)
        .find((node) => {
            if (node.type !== 'conditional' || (inboundCounts.get(node.id) ?? 0) !== 0) {
                return false
            }

            return (node.predicates ?? []).some((predicate) => {
                const targets = [predicate.onTrue, predicate.onFalse]
                    .map((targetId) => targetId ? nodeMap.get(targetId) : undefined)

                const hasBreakTarget = targets.some((targetNode) => isBreakJumpNode(targetNode))
                const loopsBackToHeader = predicate.onTrue === loopNode.id
                    || predicate.onFalse === loopNode.id
                    || predicate.onTrue === loopBodyEntryId
                    || predicate.onFalse === loopBodyEntryId

                return hasBreakTarget && loopsBackToHeader
            })
        })
}

export function normalizeDraft(method: DiscoveredMethod, draft: CfgMethodDraft): CfgMethodDraft {
    const normalized = structuredClone(draft)
    normalized.name = method.name
    normalized.returnType = method.returnType
    normalized.parameters = method.parameters
    const legacyLoopNextTargets = new Map<string, string>()

    const exitNodes = normalized.nodes.filter((node) => node.type === 'exit')
    const exitNode = exitNodes.length === 1 ? exitNodes[0] : null
    const voidMethod = isVoidReturnType(method.returnType)
    const hasBranchingNodes = normalized.nodes.some((node) => node.type === 'conditional' || node.type === 'loop')
    let syntheticReturnVariableRequired = false

    for (const node of normalized.nodes) {
        if (node.type === 'entry') {
            delete node.statements
            delete node.predicates
            delete node.iteratorStart
            delete node.iteratorUpdate
            delete node.returnValues
            delete node.jumpKind
            node.arguments = method.parameters
            continue
        }

        if (node.type === 'exit') {
            delete node.arguments
            delete node.statements
            delete node.predicates
            delete node.iteratorStart
            delete node.iteratorUpdate
            delete node.jumpKind
            node.next = null
            node.returnValues = voidMethod ? [] : (node.returnValues ?? [])
            continue
        }

        if (node.type === 'conditional') {
            delete node.arguments
            delete node.statements
            delete node.iteratorStart
            delete node.iteratorUpdate
            delete node.returnValues
            delete node.jumpKind
            delete node.next
            continue
        }

        if (node.type === 'loop') {
            const legacyNext = node.next
            delete node.arguments
            delete node.statements
            delete node.returnValues
            delete node.jumpKind
            delete node.next

            if ((node.predicates?.length ?? 0) === 0 && legacyNext) {
                legacyLoopNextTargets.set(node.id, legacyNext)
            }

            continue
        }

        if (node.type === 'jump') {
            delete node.arguments
            delete node.statements
            delete node.predicates
            delete node.iteratorStart
            delete node.iteratorUpdate
            delete node.returnValues
            continue
        }

        if (node.type !== 'block') {
            continue
        }

        delete node.arguments
        delete node.predicates
        delete node.iteratorStart
        delete node.iteratorUpdate
        delete node.returnValues
        delete node.jumpKind
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

    const firstSyntheticReturnTargetId = normalized.nodes.find((node) => isSyntheticReturnBlock(node))?.id

    for (const node of normalized.nodes) {
        if (node.type !== 'loop' || (node.predicates?.length ?? 0) > 0) {
            continue
        }

        const legacyNextTarget = legacyLoopNextTargets.get(node.id)
        if (!legacyNextTarget) {
            continue
        }

        node.predicates = [
            {
                id: nextSyntheticPredicateId(normalized.nodes, node.id),
                statement: 'true',
                onTrue: legacyNextTarget,
                onFalse: firstSyntheticReturnTargetId ?? exitNode?.id ?? null
            }
        ]
    }

    if (exitNode && hasBranchingNodes) {
        let { nodeMap, referencedNodeIds, predicateTargetIds, inboundCounts } = buildGraphIndex(normalized.nodes)
        const entryNode = normalized.nodes.find((node) => node.type === 'entry')
        let linearTail: CfgNodeDraft | undefined = entryNode
        const visitedLinearNodes = new Set<string>()
        let currentNode = entryNode?.next ? nodeMap.get(entryNode.next) : undefined

        while (currentNode && !visitedLinearNodes.has(currentNode.id)) {
            visitedLinearNodes.add(currentNode.id)

            if (currentNode.type !== 'block' && currentNode.type !== 'jump') {
                break
            }

            linearTail = currentNode

            if (currentNode.next == null || currentNode.next === exitNode.id) {
                break
            }

            currentNode = nodeMap.get(currentNode.next)
        }

        if (linearTail && (linearTail.type === 'entry' || linearTail.type === 'block' || linearTail.type === 'jump') && linearTail.next == null) {
            const tailIndex = normalized.nodes.findIndex((node) => node.id === linearTail?.id)
            const nextControlNode = normalized.nodes
                .slice(tailIndex + 1)
                .find((node) => node.type === 'conditional' || node.type === 'loop')

            if (nextControlNode && nextControlNode.id !== linearTail.id) {
                linearTail.next = nextControlNode.id
            }
        }

        ;({ nodeMap, referencedNodeIds, predicateTargetIds, inboundCounts } = buildGraphIndex(normalized.nodes))

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

        ;({ nodeMap, referencedNodeIds, predicateTargetIds, inboundCounts } = buildGraphIndex(normalized.nodes))

        for (const loopNode of normalized.nodes.filter((node) => node.type === 'loop')) {
            const loopIndex = normalized.nodes.findIndex((node) => node.id === loopNode.id)
            const orphanConditional = normalized.nodes
                .slice(loopIndex + 1)
                .find((node) => node.type === 'conditional' && (inboundCounts.get(node.id) ?? 0) === 0)

            if (!orphanConditional) {
                continue
            }

            const loopBodyCandidates = (loopNode.predicates ?? [])
                .map((predicate) => predicate.onTrue ? nodeMap.get(predicate.onTrue) : undefined)
                .filter((candidate): candidate is CfgNodeDraft => candidate?.type === 'block')

            const insertionPredecessor = [...loopBodyCandidates]
                .reverse()
                .find((node) => node.next == null || node.next === loopNode.id)

            if (!insertionPredecessor) {
                continue
            }

            insertionPredecessor.next = orphanConditional.id

            const firstPredicate = orphanConditional.predicates?.[0]
            const falseJoinTarget = firstPredicate?.onFalse ? nodeMap.get(firstPredicate.onFalse) : undefined
            const joinBlock = falseJoinTarget?.type === 'block'
                ? falseJoinTarget
                : undefined
            const loopFallbackTarget = loopNode.id

            if (joinBlock && joinBlock.next == null) {
                joinBlock.next = loopFallbackTarget
            }

            for (const predicate of orphanConditional.predicates ?? []) {
                for (const targetId of [predicate.onTrue, predicate.onFalse]) {
                    const targetNode = targetId ? nodeMap.get(targetId) : undefined

                    if (!targetNode || targetNode.type !== 'block' || targetNode.next != null) {
                        continue
                    }

                    if (isSyntheticReturnBlock(targetNode)) {
                        targetNode.next = exitNode.id
                        continue
                    }

                    if (joinBlock && targetNode.id !== joinBlock.id) {
                        targetNode.next = joinBlock.id
                        continue
                    }

                    targetNode.next = loopFallbackTarget
                }
            }
        }

        ;({ nodeMap, referencedNodeIds, predicateTargetIds, inboundCounts } = buildGraphIndex(normalized.nodes))

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

        ;({ nodeMap } = buildGraphIndex(normalized.nodes))
        const predicateMap = buildPredicateMap(normalized.nodes)

        const loopNodesInReverse = [...normalized.nodes]
            .map((node, index) => ({ node, index }))
            .filter((entry): entry is { node: CfgNodeDraft, index: number } => entry.node.type === 'loop')
            .reverse()

        for (const { node: loopNode, index: loopIndex } of loopNodesInReverse) {
            const updateBlock = findLoopUpdateBlock(normalized.nodes, loopNode, loopIndex)
            const continueTargetId = updateBlock?.id ?? loopNode.id

            if (updateBlock) {
                updateBlock.next = loopNode.id
            }

            const leafBlocks = collectLoopLeafBlocks(loopNode, nodeMap, predicateMap)
            for (const leafBlock of leafBlocks) {
                if (leafBlock.id === continueTargetId) {
                    continue
                }

                if (leafBlock.next == null || (leafBlock.next === loopNode.id && continueTargetId !== loopNode.id)) {
                    leafBlock.next = continueTargetId
                }
            }
        }

        ;({ nodeMap, inboundCounts } = buildGraphIndex(normalized.nodes))

        for (const { node: loopNode, index: loopIndex } of loopNodesInReverse) {
            const orphanBreakConditional = findOrphanBreakConditional(
                normalized.nodes,
                loopNode,
                loopIndex,
                nodeMap,
                inboundCounts
            )

            if (!orphanBreakConditional) {
                continue
            }

            const loopPredicate = loopNode.predicates?.[0]
            const bodyEntry = loopPredicate?.onTrue ? nodeMap.get(loopPredicate.onTrue) : undefined

            if (!bodyEntry || bodyEntry.type !== 'block') {
                continue
            }

            for (const predicate of orphanBreakConditional.predicates ?? []) {
                if (predicate.onTrue === bodyEntry.id) {
                    predicate.onTrue = loopNode.id
                }
                if (predicate.onFalse === bodyEntry.id) {
                    predicate.onFalse = loopNode.id
                }
            }

            const leafBlocks = collectLoopLeafBlocks(loopNode, nodeMap, predicateMap)
                .filter((node) => node.id !== orphanBreakConditional.id)
            const spliceTargets = leafBlocks.filter((node) => node.next === loopNode.id)

            if (spliceTargets.length === 0) {
                spliceTargets.push(bodyEntry)
            }

            for (const block of spliceTargets) {
                block.next = orphanBreakConditional.id
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
