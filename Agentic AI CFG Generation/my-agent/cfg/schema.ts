import { z } from 'zod'

export const parameterSchema = z.object({
    name: z.string().trim().min(1),
    type: z.string().trim().min(1)
})

export const variableSchema = z.object({
    name: z.string().trim().min(1),
    type: z.string().trim().min(1)
})

export const sourceSpanSchema = z.object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive()
}).refine((value) => value.endLine >= value.startLine, {
    message: 'sourceSpan.endLine must be greater than or equal to sourceSpan.startLine.'
})

export const discoveredMethodLocationSchema = z.object({
    name: z.string().trim().min(1),
    returnType: z.string().trim().min(1),
    parameters: z.array(parameterSchema),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive()
})

export const discoveryResultSchema = z.object({
    language: z.string().trim().min(1),
    methods: z.array(discoveredMethodLocationSchema)
})

export const cfgPredicateSchema = z.object({
    id: z.string().trim().min(1),
    statement: z.string().trim().min(1),
    onTrue: z.string().trim().min(1).nullable(),
    onFalse: z.string().trim().min(1).nullable(),
    sourceSpan: sourceSpanSchema.optional()
})

export const cfgNodeSchema = z.object({
    id: z.string().trim().min(1),
    type: z.enum(['entry', 'block', 'conditional', 'loop', 'jump', 'exit']),
    arguments: z.array(parameterSchema).optional(),
    statements: z.array(z.string()).optional(),
    next: z.string().trim().min(1).nullable().optional(),
    predicates: z.array(cfgPredicateSchema).optional(),
    iteratorStart: z.string().nullable().optional(),
    iteratorUpdate: z.string().nullable().optional(),
    returnValues: z.array(variableSchema).optional(),
    jumpKind: z.enum(['break', 'continue']).optional(),
    sourceSpan: sourceSpanSchema.optional()
})

export const cfgDraftSchema = z.object({
    name: z.string().trim().min(1),
    returnType: z.string().trim().min(1),
    parameters: z.array(parameterSchema),
    nodes: z.array(cfgNodeSchema).min(2)
})

export interface MethodPlanBlockStep {
    kind: 'block'
    statements: string[]
}

export interface MethodPlanReturnStep {
    kind: 'return'
    expression: string | null
}

export interface MethodPlanBreakStep {
    kind: 'break'
}

export interface MethodPlanContinueStep {
    kind: 'continue'
}

export interface MethodPlanIfStep {
    kind: 'if'
    condition: string
    then: MethodPlanStep[]
    else: MethodPlanStep[]
}

export interface MethodPlanLoopStep {
    kind: 'loop'
    loopType: 'for' | 'while' | 'do-while' | 'foreach' | 'unknown'
    condition: string
    iteratorStart: string | null
    iteratorUpdate: string | null
    body: MethodPlanStep[]
}

export type MethodPlanStep =
    | MethodPlanBlockStep
    | MethodPlanReturnStep
    | MethodPlanBreakStep
    | MethodPlanContinueStep
    | MethodPlanIfStep
    | MethodPlanLoopStep

export interface MethodPlan {
    name: string
    returnType: string
    parameters: Parameter[]
    body: MethodPlanStep[]
}

export const methodPlanStepSchema: z.ZodType<MethodPlanStep> = z.lazy(() => z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('block'),
        statements: z.array(z.string().trim().min(1)).min(1)
    }),
    z.object({
        kind: z.literal('return'),
        expression: z.string().trim().min(1).nullable().optional().default(null)
    }),
    z.object({
        kind: z.literal('break')
    }),
    z.object({
        kind: z.literal('continue')
    }),
    z.object({
        kind: z.literal('if'),
        condition: z.string().trim().optional().default(''),
        then: z.array(methodPlanStepSchema),
        else: z.array(methodPlanStepSchema).default([])
    }),
    z.object({
        kind: z.literal('loop'),
        loopType: z.enum(['for', 'while', 'do-while', 'foreach', 'unknown']),
        condition: z.string().trim().optional().default(''),
        iteratorStart: z.string().trim().min(1).nullable().default(null),
        iteratorUpdate: z.string().trim().min(1).nullable().default(null),
        body: z.array(methodPlanStepSchema)
    })
]))

export const methodPlanSchema = z.object({
    name: z.string().trim().min(1),
    returnType: z.string().trim().min(1),
    parameters: z.array(parameterSchema),
    body: z.array(methodPlanStepSchema)
})

export type Parameter = z.infer<typeof parameterSchema>
export type Variable = z.infer<typeof variableSchema>
export type DiscoveredMethodLocation = z.infer<typeof discoveredMethodLocationSchema>
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>
export type CfgPredicate = z.infer<typeof cfgPredicateSchema>
export type CfgNodeDraft = z.infer<typeof cfgNodeSchema>
export type CfgMethodDraft = z.infer<typeof cfgDraftSchema>

export type SourceSpan = z.infer<typeof sourceSpanSchema>

export interface DiscoveredMethod extends DiscoveredMethodLocation {
    source: string
}

export interface FinalPredicate {
    predicate: {
        ID: string
        statement: string
        onTrue: string | null
        onFalse: string | null
        sourceSpan?: SourceSpan
    }
}

export interface FinalEntryNode {
    type: 'entry'
    arguments: Parameter[]
    next: string | null
    sourceSpan?: SourceSpan
}

export interface FinalBlockNode {
    type: 'block'
    statements: string[]
    next: string | null
    sourceSpan?: SourceSpan
}

export interface FinalConditionalNode {
    type: 'conditional'
    startPredicate: string
    predicates: FinalPredicate[]
    sourceSpan?: SourceSpan
}

export interface FinalLoopNode {
    type: 'loop'
    iteratorStart: string | null
    iteratorUpdate: string | null
    startPredicate: string
    predicates: FinalPredicate[]
    sourceSpan?: SourceSpan
}

export interface FinalJumpNode {
    type: 'jump'
    next: string | null
    sourceSpan?: SourceSpan
}

export interface FinalExitNode {
    type: 'exit'
    return: Variable[]
    next: null
    sourceSpan?: SourceSpan
}

export type FinalNode =
    | FinalEntryNode
    | FinalBlockNode
    | FinalConditionalNode
    | FinalLoopNode
    | FinalJumpNode
    | FinalExitNode

export interface FinalMethod {
    id: string
    entry: string
    exit: string
    name: string
    type: string
    nodes: Record<string, FinalNode>
}

export interface FinalMethodEnvelope {
    method: FinalMethod
}

export interface FinalCfgDocument {
    methods: FinalMethodEnvelope[]
}

export const finalPredicateEnvelopeSchema = z.object({
    predicate: z.object({
        ID: z.string().trim().min(1),
        statement: z.string().trim().min(1),
        onTrue: z.string().trim().min(1).nullable(),
        onFalse: z.string().trim().min(1).nullable(),
        sourceSpan: sourceSpanSchema.optional()
    })
})

export const finalEntryNodeSchema = z.object({
    type: z.literal('entry'),
    arguments: z.array(parameterSchema),
    next: z.string().trim().min(1).nullable(),
    sourceSpan: sourceSpanSchema.optional()
})

export const finalBlockNodeSchema = z.object({
    type: z.literal('block'),
    statements: z.array(z.string()),
    next: z.string().trim().min(1).nullable(),
    sourceSpan: sourceSpanSchema.optional()
})

export const finalConditionalNodeSchema = z.object({
    type: z.literal('conditional'),
    startPredicate: z.string().trim().min(1),
    predicates: z.array(finalPredicateEnvelopeSchema),
    sourceSpan: sourceSpanSchema.optional()
})

export const finalLoopNodeSchema = z.object({
    type: z.literal('loop'),
    iteratorStart: z.string().nullable(),
    iteratorUpdate: z.string().nullable(),
    startPredicate: z.string().trim().min(1),
    predicates: z.array(finalPredicateEnvelopeSchema),
    sourceSpan: sourceSpanSchema.optional()
})

export const finalJumpNodeSchema = z.object({
    type: z.literal('jump'),
    next: z.string().trim().min(1).nullable(),
    sourceSpan: sourceSpanSchema.optional()
})

export const finalExitNodeSchema = z.object({
    type: z.literal('exit'),
    return: z.array(variableSchema),
    next: z.null(),
    sourceSpan: sourceSpanSchema.optional()
})

export const finalNodeSchema = z.discriminatedUnion('type', [
    finalEntryNodeSchema,
    finalBlockNodeSchema,
    finalConditionalNodeSchema,
    finalLoopNodeSchema,
    finalJumpNodeSchema,
    finalExitNodeSchema
])

export const finalMethodSchema = z.object({
    id: z.string().trim().min(1),
    entry: z.string().trim().min(1),
    exit: z.string().trim().min(1),
    name: z.string().trim().min(1),
    type: z.string().trim().min(1),
    nodes: z.record(z.string().trim().min(1), finalNodeSchema)
})

export const finalMethodEnvelopeSchema = z.object({
    method: finalMethodSchema
})

export const finalCfgDocumentSchema = z.object({
    methods: z.array(finalMethodEnvelopeSchema)
})
