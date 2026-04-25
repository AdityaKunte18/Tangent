import { z } from 'zod'
import { FinalCfgDocument, FinalMethod, SourceSpan, finalCfgDocumentSchema } from '../cfg/schema.js'

export { finalCfgDocumentSchema }
export type { FinalCfgDocument, FinalMethod, SourceSpan }

export type ObjectiveKind = 'branch-true' | 'branch-false' | 'statement'
export type TestGenerationLanguage = 'python' | 'c++' | 'java'

export interface PathSketch {
    refs: string[]
    summary: string[]
}

export interface CoverageObjective {
    id: string
    kind: ObjectiveKind
    methodId: string
    methodName: string
    nodeId: string
    predicateId?: string
    branchOutcome?: boolean
    targetRef?: string | null
    sourceSpan: SourceSpan | null
    targetSpan: SourceSpan | null
    attributable: boolean
    unattributableReason: string | null
    pathSketch: PathSketch
}

export interface ObjectiveCoverageStatus {
    objectiveId: string
    covered: boolean
    attributable: boolean
    reason: string | null
}

export interface CoverageBucketSummary {
    covered: number
    total: number
    percent: number
}

export interface MethodCoverageSummary {
    methodId: string
    methodName: string
    branchCoverage: CoverageBucketSummary
    statementCoverage: CoverageBucketSummary
    coveredObjectiveIds: string[]
    uncoveredObjectiveIds: string[]
    unattributableObjectiveIds: string[]
}

export interface ModuleCoverageSummary {
    branchCoverage: CoverageBucketSummary
    statementCoverage: CoverageBucketSummary
    coveredObjectiveIds: string[]
    uncoveredObjectiveIds: string[]
    unattributableObjectiveIds: string[]
    methods: MethodCoverageSummary[]
}

export const testCandidateSchema = z.object({
    testName: z.string().trim().regex(/^test_[A-Za-z_]\w*$/),
    code: z.string().trim().min(1)
})

export const pytestCandidateSchema = testCandidateSchema

export type TestCandidate = z.infer<typeof testCandidateSchema>
export type PytestCandidate = TestCandidate

export interface CandidateValidationResult {
    valid: boolean
    errors: string[]
    functionName: string | null
    fingerprint: string | null
    calledTargets: string[]
    assertionCount: number
    usesCapsys: boolean
}

export interface CandidateEvaluationResult {
    candidate: PytestCandidate
    targetObjectiveId: string
    accepted: boolean
    reason: string
    fingerprint: string | null
    coverageAfter: ModuleCoverageSummary | null
}

export interface IterationHistoryEntry {
    round: number
    targetObjectiveId: string
    targetMethodName: string
    candidateName: string
    accepted: boolean
    reason: string
}

export interface TestGenerationResult {
    generatedTestPath: string
    reportPath: string
    rawCoveragePath: string
    coverageBefore: ModuleCoverageSummary
    coverageAfter: ModuleCoverageSummary
    perMethod: MethodCoverageSummary[]
    acceptedCandidateCount: number
    rejectedCandidateCount: number
    iterationHistory: IterationHistoryEntry[]
    failedCandidateReasons: string[]
}

export interface GenerateTestsCommonOptions {
    language: TestGenerationLanguage
    sourcePath: string
    outDir?: string
    maxRounds?: number
    maxAcceptedTests?: number
    maxNoGainRounds?: number
    maxCandidates?: number
}

export interface GenerateTestsForPathOptions extends GenerateTestsCommonOptions {
    cfgPath: string
}

export interface GenerateTestsForDocumentOptions extends GenerateTestsCommonOptions {
    cfgDocument: FinalCfgDocument | string
}

export interface TestGenerationReport {
    sourcePath: string
    generatedTestPath: string
    coverageBefore: ModuleCoverageSummary
    coverageAfter: ModuleCoverageSummary
    acceptedCandidateCount: number
    rejectedCandidateCount: number
    acceptedTestNames: string[]
    iterationHistory: IterationHistoryEntry[]
    failedCandidateReasons: string[]
}
