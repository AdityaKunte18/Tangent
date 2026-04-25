import {
    CfgMethodDraft,
    CfgNodeDraft,
    CfgPredicate,
    DiscoveredMethod,
    MethodPlan,
    MethodPlanLoopStep,
    MethodPlanStep,
    SourceSpan
} from './schema.js'
import { SequentialSourceSpanFinder } from '../source-spans.js'

interface LoopContext {
    breakTargetId: string
    continueTargetId: string
}

interface CompilerState {
    nodes: CfgNodeDraft[]
    nodeCounter: number
    predicateCounter: number
    exitNodeId: string
    voidMethod: boolean
    stepSpans: WeakMap<MethodPlanStep, SourceSpan | null>
}

function isVoidReturnType(returnType: string): boolean {
    const normalized = returnType.trim().toLowerCase()
    return normalized === 'void' || normalized === 'none'
}

function createCompilerState(method: DiscoveredMethod, plan: MethodPlan): CompilerState {
    return {
        nodes: [],
        nodeCounter: 0,
        predicateCounter: 0,
        exitNodeId: 'exit',
        voidMethod: isVoidReturnType(method.returnType),
        stepSpans: resolvePlanSourceSpans(method, plan)
    }
}

function nextNodeId(state: CompilerState, baseId: string): string {
    state.nodeCounter += 1
    return `${baseId}_${String(state.nodeCounter).padStart(4, '0')}`
}

function nextPredicateId(state: CompilerState, baseId: string): string {
    state.predicateCounter += 1
    return `${baseId}_${String(state.predicateCounter).padStart(4, '0')}`
}

function addNode(state: CompilerState, node: CfgNodeDraft): string {
    state.nodes.push(node)
    return node.id
}

function createPredicate(
    state: CompilerState,
    baseId: string,
    statement: string,
    onTrue: string | null,
    onFalse: string | null,
    sourceSpan?: SourceSpan | null
): CfgPredicate {
    return {
        id: nextPredicateId(state, baseId),
        statement,
        onTrue,
        onFalse,
        sourceSpan: sourceSpan ?? undefined
    }
}

function normalizeAssignmentExpression(expression: string): string {
    const trimmed = expression.trim()
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

function createReturnTarget(
    state: CompilerState,
    expression: string | null,
    sourceSpan?: SourceSpan | null
): string {
    if (state.voidMethod) {
        return state.exitNodeId
    }

    if (!expression || expression.trim().length === 0) {
        throw new Error('Non-void methods must return an expression in the MethodPlan.')
    }

    return addNode(state, {
        id: nextNodeId(state, 'return_value'),
        type: 'block',
        statements: [`_return_value = ${normalizeAssignmentExpression(expression)}`],
        next: state.exitNodeId,
        sourceSpan: sourceSpan ?? undefined
    })
}

function combineSpans(spans: Array<SourceSpan | null | undefined>): SourceSpan | null {
    const definedSpans = spans.filter((span): span is SourceSpan => span != null)
    if (definedSpans.length === 0) {
        return null
    }

    return {
        startLine: Math.min(...definedSpans.map((span) => span.startLine)),
        endLine: Math.max(...definedSpans.map((span) => span.endLine))
    }
}

function resolvePlanSourceSpans(method: DiscoveredMethod, plan: MethodPlan): WeakMap<MethodPlanStep, SourceSpan | null> {
    const stepSpans = new WeakMap<MethodPlanStep, SourceSpan | null>()
    const finder = new SequentialSourceSpanFinder(method.source, method.startLine)

    const walk = (steps: MethodPlanStep[]): void => {
        for (const step of steps) {
            switch (step.kind) {
                case 'block': {
                    const spans = step.statements.map((statement) => finder.findNext(statement))
                    stepSpans.set(step, combineSpans(spans))
                    break
                }
                case 'return':
                    stepSpans.set(
                        step,
                        finder.findNext(step.expression?.trim().length ? `return ${step.expression}` : 'return')
                    )
                    break
                case 'break':
                    stepSpans.set(step, finder.findNext('break'))
                    break
                case 'continue':
                    stepSpans.set(step, finder.findNext('continue'))
                    break
                case 'if':
                    stepSpans.set(step, finder.findNext(step.condition))
                    walk(step.then)
                    walk(step.else)
                    break
                case 'loop':
                    stepSpans.set(
                        step,
                        finder.findNext(step.condition)
                        ?? (step.iteratorStart ? finder.findNext(step.iteratorStart) : null)
                    )
                    walk(step.body)
                    break
            }
        }
    }

    walk(plan.body)
    return stepSpans
}

function compileLoopStep(
    state: CompilerState,
    step: MethodPlanLoopStep,
    continuationId: string,
    loopStack: LoopContext[]
): string {
    const sourceSpan = state.stepSpans.get(step) ?? null
    const loopId = nextNodeId(state, 'loop')
    const hasExplicitUpdate = Boolean(step.iteratorUpdate?.trim())
    const updateNodeId = hasExplicitUpdate
        ? addNode(state, {
            id: nextNodeId(state, 'loop_update'),
            type: 'block',
            statements: [step.iteratorUpdate!.trim()],
            next: loopId,
            sourceSpan: sourceSpan ?? undefined
        })
        : null

    const continueTargetId = updateNodeId ?? loopId
    const bodyContinuationId = continueTargetId
    const nestedLoopStack = [
        ...loopStack,
        {
            breakTargetId: continuationId,
            continueTargetId
        }
    ]

    const bodyEntryId = step.body.length > 0
        ? compileStepSequence(state, step.body, bodyContinuationId, nestedLoopStack)
        : bodyContinuationId

    const loopNode: CfgNodeDraft = {
        id: loopId,
        type: 'loop',
        predicates: [
            createPredicate(
                state,
                'loop_predicate',
                step.condition,
                bodyEntryId,
                continuationId,
                sourceSpan
            )
        ],
        iteratorStart: step.iteratorStart?.trim() || null,
        iteratorUpdate: updateNodeId ? null : (step.iteratorUpdate?.trim() || null),
        sourceSpan: sourceSpan ?? undefined
    }

    addNode(state, loopNode)

    if (step.loopType === 'do-while') {
        return bodyEntryId
    }

    return loopId
}

function compileSingleStep(
    state: CompilerState,
    step: MethodPlanStep,
    continuationId: string,
    loopStack: LoopContext[]
): string {
    switch (step.kind) {
        case 'block':
            return addNode(state, {
                id: nextNodeId(state, 'block'),
                type: 'block',
                statements: step.statements,
                next: continuationId,
                sourceSpan: state.stepSpans.get(step) ?? undefined
            })
        case 'return':
            return createReturnTarget(state, step.expression, state.stepSpans.get(step))
        case 'break': {
            const loopContext = loopStack[loopStack.length - 1]
            if (!loopContext) {
                throw new Error('Encountered break outside a loop while compiling MethodPlan.')
            }

            return addNode(state, {
                id: nextNodeId(state, 'break_jump'),
                type: 'jump',
                jumpKind: 'break',
                next: loopContext.breakTargetId,
                sourceSpan: state.stepSpans.get(step) ?? undefined
            })
        }
        case 'continue': {
            const loopContext = loopStack[loopStack.length - 1]
            if (!loopContext) {
                throw new Error('Encountered continue outside a loop while compiling MethodPlan.')
            }

            return addNode(state, {
                id: nextNodeId(state, 'continue_jump'),
                type: 'jump',
                jumpKind: 'continue',
                next: loopContext.continueTargetId,
                sourceSpan: state.stepSpans.get(step) ?? undefined
            })
        }
        case 'if': {
            const sourceSpan = state.stepSpans.get(step) ?? null
            const thenEntryId = step.then.length > 0
                ? compileStepSequence(state, step.then, continuationId, loopStack)
                : continuationId
            const elseEntryId = step.else.length > 0
                ? compileStepSequence(state, step.else, continuationId, loopStack)
                : continuationId

            return addNode(state, {
                id: nextNodeId(state, 'conditional'),
                type: 'conditional',
                predicates: [
                    createPredicate(
                        state,
                        'conditional_predicate',
                        step.condition,
                        thenEntryId,
                        elseEntryId,
                        sourceSpan
                    )
                ],
                sourceSpan: sourceSpan ?? undefined
            })
        }
        case 'loop':
            return compileLoopStep(state, step, continuationId, loopStack)
    }
}

function compileStepSequence(
    state: CompilerState,
    steps: MethodPlanStep[],
    continuationId: string,
    loopStack: LoopContext[]
): string {
    let currentContinuationId = continuationId

    for (let index = steps.length - 1; index >= 0; index -= 1) {
        currentContinuationId = compileSingleStep(
            state,
            steps[index],
            currentContinuationId,
            loopStack
        )
    }

    return currentContinuationId
}

export function compileMethodPlan(method: DiscoveredMethod, plan: MethodPlan): CfgMethodDraft {
    const state = createCompilerState(method, plan)
    const exitNode: CfgNodeDraft = {
        id: state.exitNodeId,
        type: 'exit',
        returnValues: state.voidMethod
            ? []
            : [{ name: '_return_value', type: method.returnType }],
        next: null
    }

    addNode(state, exitNode)

    const bodyEntryId = plan.body.length > 0
        ? compileStepSequence(state, plan.body, state.exitNodeId, [])
        : state.exitNodeId

    state.nodes.unshift({
        id: 'entry',
        type: 'entry',
        arguments: method.parameters,
        next: bodyEntryId,
        sourceSpan: {
            startLine: method.startLine,
            endLine: method.startLine
        }
    })

    return {
        name: method.name,
        returnType: method.returnType,
        parameters: method.parameters,
        nodes: state.nodes
    }
}
