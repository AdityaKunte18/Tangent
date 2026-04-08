import {
    CfgMethodDraft,
    CfgNodeDraft,
    CfgPredicate,
    DiscoveredMethod,
    MethodPlan,
    MethodPlanLoopStep,
    MethodPlanStep
} from './schema.js'

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
}

function isVoidReturnType(returnType: string): boolean {
    const normalized = returnType.trim().toLowerCase()
    return normalized === 'void' || normalized === 'none'
}

function createCompilerState(method: DiscoveredMethod): CompilerState {
    return {
        nodes: [],
        nodeCounter: 0,
        predicateCounter: 0,
        exitNodeId: 'exit',
        voidMethod: isVoidReturnType(method.returnType)
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
    onFalse: string | null
): CfgPredicate {
    return {
        id: nextPredicateId(state, baseId),
        statement,
        onTrue,
        onFalse
    }
}

function normalizeAssignmentExpression(expression: string): string {
    const trimmed = expression.trim()
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

function createReturnTarget(
    state: CompilerState,
    expression: string | null
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
        next: state.exitNodeId
    })
}

function compileLoopStep(
    state: CompilerState,
    step: MethodPlanLoopStep,
    continuationId: string,
    loopStack: LoopContext[]
): string {
    const loopId = nextNodeId(state, 'loop')
    const hasExplicitUpdate = Boolean(step.iteratorUpdate?.trim())
    const updateNodeId = hasExplicitUpdate
        ? addNode(state, {
            id: nextNodeId(state, 'loop_update'),
            type: 'block',
            statements: [step.iteratorUpdate!.trim()],
            next: loopId
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
                continuationId
            )
        ],
        iteratorStart: step.iteratorStart?.trim() || null,
        iteratorUpdate: updateNodeId ? null : (step.iteratorUpdate?.trim() || null)
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
                next: continuationId
            })
        case 'return':
            return createReturnTarget(state, step.expression)
        case 'break': {
            const loopContext = loopStack[loopStack.length - 1]
            if (!loopContext) {
                throw new Error('Encountered break outside a loop while compiling MethodPlan.')
            }

            return addNode(state, {
                id: nextNodeId(state, 'break_jump'),
                type: 'jump',
                jumpKind: 'break',
                next: loopContext.breakTargetId
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
                next: loopContext.continueTargetId
            })
        }
        case 'if': {
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
                        elseEntryId
                    )
                ]
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
    const state = createCompilerState(method)
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
        next: bodyEntryId
    })

    return {
        name: method.name,
        returnType: method.returnType,
        parameters: method.parameters,
        nodes: state.nodes
    }
}
