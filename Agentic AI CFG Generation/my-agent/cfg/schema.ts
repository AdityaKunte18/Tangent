import { z } from 'zod'

export const parameterSchema = z.object({
    name: z.string().trim().min(1),
    type: z.string().trim().min(1)
})

export const variableSchema = z.object({
    name: z.string().trim().min(1),
    type: z.string().trim().min(1)
})

export const discoveredMethodSchema = z.object({
    name: z.string().trim().min(1),
    returnType: z.string().trim().min(1),
    parameters: z.array(parameterSchema),
    source: z.string().trim().min(1)
})

export const discoveryResultSchema = z.object({
    language: z.string().trim().min(1),
    methods: z.array(discoveredMethodSchema)
})

export const cfgPredicateSchema = z.object({
    id: z.string().trim().min(1),
    statement: z.string().trim().min(1),
    onTrue: z.string().trim().min(1).nullable(),
    onFalse: z.string().trim().min(1).nullable()
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
    jumpKind: z.enum(['break', 'continue']).optional()
})

export const cfgDraftSchema = z.object({
    name: z.string().trim().min(1),
    returnType: z.string().trim().min(1),
    parameters: z.array(parameterSchema),
    nodes: z.array(cfgNodeSchema).min(2)
})

export type Parameter = z.infer<typeof parameterSchema>
export type Variable = z.infer<typeof variableSchema>
export type DiscoveredMethod = z.infer<typeof discoveredMethodSchema>
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>
export type CfgPredicate = z.infer<typeof cfgPredicateSchema>
export type CfgNodeDraft = z.infer<typeof cfgNodeSchema>
export type CfgMethodDraft = z.infer<typeof cfgDraftSchema>

export interface FinalPredicate {
    predicate: {
        ID: string
        statement: string
        onTrue: string | null
        onFalse: string | null
    }
}

export interface FinalEntryNode {
    type: 'entry'
    arguments: Parameter[]
    next: string | null
}

export interface FinalBlockNode {
    type: 'block'
    statements: string[]
    next: string | null
}

export interface FinalConditionalNode {
    type: 'conditional'
    startPredicate: string
    predicates: FinalPredicate[]
}

export interface FinalLoopNode {
    type: 'loop'
    iteratorStart: string | null
    iteratorUpdate: string | null
    startPredicate: string
    predicates: FinalPredicate[]
}

export interface FinalJumpNode {
    type: 'jump'
    next: string | null
}

export interface FinalExitNode {
    type: 'exit'
    return: Variable[]
    next: null
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
