import {
    CoverageObjective,
    CoverageBucketSummary,
    FinalMethod,
    MethodCoverageSummary,
    ModuleCoverageSummary,
    ObjectiveCoverageStatus,
    SourceSpan
} from './schema.js'

interface PredicateRecord {
    ownerNodeId: string
    predicateId: string
    statement: string
    onTrue: string | null
    onFalse: string | null
    sourceSpan?: SourceSpan
}

function isSyntheticCfgStatement(statement: string): boolean {
    return /^_return_value\s*=/.test(statement.trim())
}

function isNodeRef(method: FinalMethod, ref: string): boolean {
    return Object.prototype.hasOwnProperty.call(method.nodes, ref)
}

function getPredicateMap(method: FinalMethod): Map<string, PredicateRecord> {
    const predicates = new Map<string, PredicateRecord>()

    for (const [nodeId, node] of Object.entries(method.nodes)) {
        if (node.type !== 'conditional' && node.type !== 'loop') {
            continue
        }

        for (const envelope of node.predicates) {
            predicates.set(envelope.predicate.ID, {
                ownerNodeId: nodeId,
                predicateId: envelope.predicate.ID,
                statement: envelope.predicate.statement,
                onTrue: envelope.predicate.onTrue,
                onFalse: envelope.predicate.onFalse,
                sourceSpan: envelope.predicate.sourceSpan
            })
        }
    }

    return predicates
}

function getRefSpan(method: FinalMethod, predicateMap: Map<string, PredicateRecord>, ref: string | null | undefined): SourceSpan | null {
    if (!ref) {
        return null
    }

    if (isNodeRef(method, ref)) {
        return method.nodes[ref].sourceSpan ?? null
    }

    return predicateMap.get(ref)?.sourceSpan ?? null
}

function getOutgoingRefs(method: FinalMethod, predicateMap: Map<string, PredicateRecord>, ref: string): string[] {
    if (isNodeRef(method, ref)) {
        const node = method.nodes[ref]

        switch (node.type) {
            case 'entry':
            case 'block':
            case 'jump':
                return node.next ? [node.next] : []
            case 'conditional':
            case 'loop':
                return node.startPredicate ? [node.startPredicate] : []
            case 'exit':
                return []
        }
    }

    const predicate = predicateMap.get(ref)
    if (!predicate) {
        return []
    }

    return [predicate.onTrue, predicate.onFalse].filter((value): value is string => value != null)
}

function findPath(method: FinalMethod, predicateMap: Map<string, PredicateRecord>, startRef: string, targetRef: string): string[] | null {
    const queue: Array<{ ref: string; path: string[]; visits: Map<string, number> }> = [{
        ref: startRef,
        path: [startRef],
        visits: new Map([[startRef, 1]])
    }]
    const maxDepth = 40
    const maxVisitsPerRef = 2

    while (queue.length > 0) {
        const current = queue.shift()
        if (!current) {
            continue
        }

        if (current.ref === targetRef) {
            return current.path
        }

        if (current.path.length >= maxDepth) {
            continue
        }

        for (const nextRef of getOutgoingRefs(method, predicateMap, current.ref)) {
            const nextVisits = current.visits.get(nextRef) ?? 0
            if (nextVisits >= maxVisitsPerRef) {
                continue
            }

            const visits = new Map(current.visits)
            visits.set(nextRef, nextVisits + 1)
            queue.push({
                ref: nextRef,
                path: [...current.path, nextRef],
                visits
            })
        }
    }

    return null
}

function describePath(method: FinalMethod, predicateMap: Map<string, PredicateRecord>, refs: string[]): string[] {
    const summary: string[] = []

    for (let index = 0; index < refs.length; index += 1) {
        const ref = refs[index]
        const nextRef = refs[index + 1] ?? null

        if (isNodeRef(method, ref)) {
            const node = method.nodes[ref]
            switch (node.type) {
                case 'entry':
                    summary.push(`Enter ${method.name}`)
                    break
                case 'block': {
                    const firstSourceBackedStatement = node.statements.find((statement) => !isSyntheticCfgStatement(statement))
                    if (firstSourceBackedStatement) {
                        summary.push(`Execute ${firstSourceBackedStatement}`)
                    } else if (node.statements[0]) {
                        summary.push(`Execute ${node.statements[0]}`)
                    }
                    break
                }
                case 'exit':
                    summary.push(`Exit ${method.name}`)
                    break
                case 'conditional':
                case 'loop':
                case 'jump':
                    break
            }
            continue
        }

        const predicate = predicateMap.get(ref)
        if (!predicate) {
            continue
        }

        if (nextRef && nextRef === predicate.onTrue) {
            summary.push(`Take TRUE on ${predicate.statement}`)
        } else if (nextRef && nextRef === predicate.onFalse) {
            summary.push(`Take FALSE on ${predicate.statement}`)
        } else {
            summary.push(`Evaluate ${predicate.statement}`)
        }
    }

    return summary
}

function buildPathSketch(method: FinalMethod, predicateMap: Map<string, PredicateRecord>, objective: Omit<CoverageObjective, 'pathSketch'>): CoverageObjective['pathSketch'] {
    if (objective.kind === 'statement') {
        const pathToNode = findPath(method, predicateMap, method.entry, objective.nodeId) ?? [method.entry, objective.nodeId]
        const pathToExit = findPath(method, predicateMap, objective.nodeId, method.exit) ?? [objective.nodeId, method.exit]
        const refs = [...pathToNode, ...pathToExit.slice(1)]

        return {
            refs,
            summary: describePath(method, predicateMap, refs)
        }
    }

    if (!objective.predicateId || !objective.targetRef) {
        return {
            refs: [method.entry],
            summary: [`Enter ${method.name}`]
        }
    }

    const pathToPredicate = findPath(method, predicateMap, method.entry, objective.predicateId) ?? [method.entry, objective.predicateId]
    const pathToExit = findPath(method, predicateMap, objective.targetRef, method.exit) ?? [objective.targetRef, method.exit]
    const refs = [...pathToPredicate, objective.targetRef, ...pathToExit.slice(1)]

    return {
        refs,
        summary: describePath(method, predicateMap, refs)
    }
}

export function enumerateCoverageObjectives(method: FinalMethod): CoverageObjective[] {
    const predicateMap = getPredicateMap(method)
    const objectives: CoverageObjective[] = []

    for (const [nodeId, node] of Object.entries(method.nodes)) {
        if (node.type === 'block') {
            const sourceBackedStatements = node.statements.filter((statement) => !isSyntheticCfgStatement(statement))
            if (sourceBackedStatements.length === 0) {
                continue
            }

            const attributable = Boolean(node.sourceSpan)
            const objectiveBase = {
                id: `${method.id}:${nodeId}:statement`,
                kind: 'statement' as const,
                methodId: method.id,
                methodName: method.name,
                nodeId,
                sourceSpan: node.sourceSpan ?? null,
                targetSpan: node.sourceSpan ?? null,
                attributable,
                unattributableReason: attributable ? null : `Block node '${nodeId}' has no source span.`
            }

            objectives.push({
                ...objectiveBase,
                pathSketch: buildPathSketch(method, predicateMap, objectiveBase)
            })
        }

        if (node.type !== 'conditional' && node.type !== 'loop') {
            continue
        }

        for (const envelope of node.predicates) {
            const predicate = envelope.predicate
            const predicateSpan = predicate.sourceSpan ?? node.sourceSpan ?? null

            for (const branchOutcome of [true, false] as const) {
                const targetRef = branchOutcome ? predicate.onTrue : predicate.onFalse
                if (!targetRef) {
                    continue
                }

                const targetSpan = getRefSpan(method, predicateMap, targetRef)
                const attributable = Boolean(predicateSpan && targetSpan)
                const objectiveBase = {
                    id: `${method.id}:${predicate.ID}:${branchOutcome ? 'true' : 'false'}`,
                    kind: branchOutcome ? 'branch-true' as const : 'branch-false' as const,
                    methodId: method.id,
                    methodName: method.name,
                    nodeId,
                    predicateId: predicate.ID,
                    branchOutcome,
                    targetRef,
                    sourceSpan: predicateSpan,
                    targetSpan,
                    attributable,
                    unattributableReason: attributable
                        ? null
                        : `Predicate '${predicate.ID}' or its target branch lacks source-span metadata.`
                }

                objectives.push({
                    ...objectiveBase,
                    pathSketch: buildPathSketch(method, predicateMap, objectiveBase)
                })
            }
        }
    }

    return objectives.sort((left, right) => {
        const leftPriority = left.kind === 'statement' ? 1 : 0
        const rightPriority = right.kind === 'statement' ? 1 : 0
        if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority
        }

        return left.id.localeCompare(right.id)
    })
}

function summarizeBucket(covered: number, total: number): CoverageBucketSummary {
    return {
        covered,
        total,
        percent: total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2))
    }
}

export function summarizeObjectiveCoverage(
    methods: FinalMethod[],
    objectives: CoverageObjective[],
    statuses: Map<string, ObjectiveCoverageStatus>
): ModuleCoverageSummary {
    const perMethod: MethodCoverageSummary[] = []

    for (const method of methods) {
        const methodObjectives = objectives.filter((objective) => objective.methodId === method.id)
        const branchObjectives = methodObjectives.filter((objective) => objective.kind !== 'statement' && objective.attributable)
        const statementObjectives = methodObjectives.filter((objective) => objective.kind === 'statement' && objective.attributable)
        const coveredObjectiveIds = methodObjectives
            .filter((objective) => statuses.get(objective.id)?.covered)
            .map((objective) => objective.id)
        const uncoveredObjectiveIds = methodObjectives
            .filter((objective) => objective.attributable && !statuses.get(objective.id)?.covered)
            .map((objective) => objective.id)
        const unattributableObjectiveIds = methodObjectives
            .filter((objective) => !objective.attributable)
            .map((objective) => objective.id)

        perMethod.push({
            methodId: method.id,
            methodName: method.name,
            branchCoverage: summarizeBucket(
                branchObjectives.filter((objective) => statuses.get(objective.id)?.covered).length,
                branchObjectives.length
            ),
            statementCoverage: summarizeBucket(
                statementObjectives.filter((objective) => statuses.get(objective.id)?.covered).length,
                statementObjectives.length
            ),
            coveredObjectiveIds,
            uncoveredObjectiveIds,
            unattributableObjectiveIds
        })
    }

    const attributableObjectives = objectives.filter((objective) => objective.attributable)
    const branchObjectives = attributableObjectives.filter((objective) => objective.kind !== 'statement')
    const statementObjectives = attributableObjectives.filter((objective) => objective.kind === 'statement')
    const coveredObjectiveIds = attributableObjectives
        .filter((objective) => statuses.get(objective.id)?.covered)
        .map((objective) => objective.id)
    const uncoveredObjectiveIds = attributableObjectives
        .filter((objective) => !statuses.get(objective.id)?.covered)
        .map((objective) => objective.id)
    const unattributableObjectiveIds = objectives
        .filter((objective) => !objective.attributable)
        .map((objective) => objective.id)

    return {
        branchCoverage: summarizeBucket(
            branchObjectives.filter((objective) => statuses.get(objective.id)?.covered).length,
            branchObjectives.length
        ),
        statementCoverage: summarizeBucket(
            statementObjectives.filter((objective) => statuses.get(objective.id)?.covered).length,
            statementObjectives.length
        ),
        coveredObjectiveIds,
        uncoveredObjectiveIds,
        unattributableObjectiveIds,
        methods: perMethod
    }
}
