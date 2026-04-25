import path from 'node:path'
import {
    CoverageObjective,
    FinalMethod,
    ModuleCoverageSummary,
    ObjectiveCoverageStatus
} from './schema.js'
import { summarizeObjectiveCoverage } from './objectives.js'

interface CoverageFileData {
    executedLines: Set<number>
    executedBranches: Array<[number, number]>
    executedBranchOutcomes: Array<{
        line: number
        trueCount: number
        falseCount: number
    }>
}

function normalizeComparablePath(value: string): string {
    return path.normalize(value)
}

function coverageFileMatchesSource(filePath: string, sourcePath: string): boolean {
    const normalizedSourcePath = normalizeComparablePath(path.resolve(sourcePath))
    const candidatePaths = [
        path.resolve(filePath),
        path.resolve(path.dirname(sourcePath), filePath)
    ].map(normalizeComparablePath)

    return candidatePaths.includes(normalizedSourcePath)
        || path.basename(filePath) === path.basename(sourcePath)
}

function coerceBranchArc(value: unknown): [number, number] | null {
    if (!Array.isArray(value) || value.length !== 2) {
        return null
    }

    const start = Number(value[0])
    const end = Number(value[1])

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null
    }

    return [start, end]
}

function coerceBranchOutcome(value: unknown): CoverageFileData['executedBranchOutcomes'][number] | null {
    if (!value || typeof value !== 'object') {
        return null
    }

    const payload = value as {
        line?: unknown
        trueCount?: unknown
        falseCount?: unknown
    }
    const line = Number(payload.line)
    const trueCount = Number(payload.trueCount)
    const falseCount = Number(payload.falseCount)

    if (!Number.isFinite(line) || !Number.isFinite(trueCount) || !Number.isFinite(falseCount)) {
        return null
    }

    return {
        line,
        trueCount,
        falseCount
    }
}

function extractCoverageFileData(rawCoverage: unknown, sourcePath: string): CoverageFileData {
    const files = (rawCoverage as { files?: Record<string, unknown> })?.files ?? {}

    for (const [filePath, payload] of Object.entries(files)) {
        if (!coverageFileMatchesSource(filePath, sourcePath)) {
            continue
        }

        const filePayload = payload as {
            executed_lines?: unknown[]
            executed_branches?: unknown[]
            executed_branch_outcomes?: unknown[]
        }

        return {
            executedLines: new Set((filePayload.executed_lines ?? []).map((line) => Number(line)).filter(Number.isFinite)),
            executedBranches: (filePayload.executed_branches ?? [])
                .map(coerceBranchArc)
                .filter((arc): arc is [number, number] => arc != null),
            executedBranchOutcomes: (filePayload.executed_branch_outcomes ?? [])
                .map(coerceBranchOutcome)
                .filter((outcome): outcome is CoverageFileData['executedBranchOutcomes'][number] => outcome != null)
        }
    }

    return {
        executedLines: new Set<number>(),
        executedBranches: [],
        executedBranchOutcomes: []
    }
}

function range(start: number, end: number): number[] {
    const values: number[] = []
    for (let value = start; value <= end; value += 1) {
        values.push(value)
    }
    return values
}

export function createBaselineCoverageStatuses(objectives: CoverageObjective[]): Map<string, ObjectiveCoverageStatus> {
    return new Map(objectives.map((objective) => [
        objective.id,
        {
            objectiveId: objective.id,
            covered: false,
            attributable: objective.attributable,
            reason: objective.unattributableReason
        }
    ]))
}

export function attributeCoverageToObjectives(
    objectives: CoverageObjective[],
    rawCoverage: unknown,
    sourcePath: string
): Map<string, ObjectiveCoverageStatus> {
    const fileData = extractCoverageFileData(rawCoverage, sourcePath)
    const statuses = new Map<string, ObjectiveCoverageStatus>()

    for (const objective of objectives) {
        if (!objective.attributable) {
            statuses.set(objective.id, {
                objectiveId: objective.id,
                covered: false,
                attributable: false,
                reason: objective.unattributableReason
            })
            continue
        }

        if (!objective.sourceSpan) {
            statuses.set(objective.id, {
                objectiveId: objective.id,
                covered: false,
                attributable: false,
                reason: objective.unattributableReason ?? 'Objective is missing source-span metadata.'
            })
            continue
        }

        if (objective.kind === 'statement') {
            const covered = range(objective.sourceSpan.startLine, objective.sourceSpan.endLine)
                .some((line) => fileData.executedLines.has(line))

            statuses.set(objective.id, {
                objectiveId: objective.id,
                covered,
                attributable: true,
                reason: covered ? null : null
            })
            continue
        }

        if (!objective.targetSpan) {
            statuses.set(objective.id, {
                objectiveId: objective.id,
                covered: false,
                attributable: false,
                reason: objective.unattributableReason ?? 'Branch objective target is missing source-span metadata.'
            })
            continue
        }

        const coveredByArc = fileData.executedBranches.some(([fromLine, toLine]) =>
            fromLine >= objective.sourceSpan!.startLine
            && fromLine <= objective.sourceSpan!.endLine
            && toLine >= objective.targetSpan!.startLine
            && toLine <= objective.targetSpan!.endLine
        )
        const targetLineExecuted = range(objective.targetSpan.startLine, objective.targetSpan.endLine)
            .some((line) => fileData.executedLines.has(line))
        const targetBranchEvaluated = fileData.executedBranchOutcomes.some((outcome) =>
            outcome.line >= objective.targetSpan!.startLine
            && outcome.line <= objective.targetSpan!.endLine
            && (outcome.trueCount > 0 || outcome.falseCount > 0)
        )
        const coveredByOutcome = fileData.executedBranchOutcomes.some((outcome) =>
            outcome.line >= objective.sourceSpan!.startLine
            && outcome.line <= objective.sourceSpan!.endLine
            && (objective.branchOutcome ? outcome.trueCount > 0 : outcome.falseCount > 0)
        )
        const covered = coveredByArc || (coveredByOutcome && (targetLineExecuted || targetBranchEvaluated))

        statuses.set(objective.id, {
            objectiveId: objective.id,
            covered,
            attributable: true,
            reason: covered ? null : null
        })
    }

    return statuses
}

export function summarizeCoverageFromRaw(
    methods: FinalMethod[],
    objectives: CoverageObjective[],
    rawCoverage: unknown,
    sourcePath: string
): {
    statuses: Map<string, ObjectiveCoverageStatus>
    summary: ModuleCoverageSummary
} {
    const statuses = attributeCoverageToObjectives(objectives, rawCoverage, sourcePath)
    return {
        statuses,
        summary: summarizeObjectiveCoverage(methods, objectives, statuses)
    }
}
