import { DiscoveredMethod, MethodPlan, MethodPlanStep } from './schema.js'

export interface PlanValidationResult {
    valid: boolean
    errors: string[]
}

function isVoidReturnType(returnType: string): boolean {
    const normalized = returnType.trim().toLowerCase()
    return normalized === 'void' || normalized === 'none'
}

function normalizeComparableText(value: string): string {
    return value
        .replace(/\r\n?/g, '\n')
        .replace(/\s+/g, ' ')
        .trim()
}

function stripTrailingSemicolon(value: string): string {
    return value.replace(/;\s*$/, '').trim()
}

function containsSourceSnippet(source: string, snippet: string): boolean {
    const normalizedSource = normalizeComparableText(source)
    const normalizedSnippet = normalizeComparableText(snippet)
    const semicolonAgnosticSnippet = stripTrailingSemicolon(normalizedSnippet)

    return normalizedSource.includes(normalizedSnippet)
        || (semicolonAgnosticSnippet.length > 0 && normalizedSource.includes(semicolonAgnosticSnippet))
}

function isControlTransferStatement(statement: string): boolean {
    return /^\s*(return|break|continue)\b/.test(statement)
}

function isAllowedSyntheticCondition(condition: string): boolean {
    const normalized = condition.trim().toLowerCase()
    return normalized === 'true' || normalized === '1'
}

function validateSourceBackedText(
    source: string,
    label: string,
    value: string,
    errors: string[]
): void {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
        errors.push(`${label} must not be blank.`)
        return
    }

    if (containsSourceSnippet(source, trimmed)) {
        return
    }

    errors.push(`${label} does not appear in the source method: '${trimmed}'.`)
}

function validateStepSequence(
    steps: MethodPlanStep[],
    source: string,
    errors: string[],
    path: string,
    loopDepth: number,
    methodReturnType: string
): void {
    steps.forEach((step, index) => {
        const stepPath = `${path}[${index}]`

        switch (step.kind) {
            case 'block':
                step.statements.forEach((statement, statementIndex) => {
                    if (isControlTransferStatement(statement)) {
                        errors.push(`Block step ${stepPath} contains control transfer statement '${statement}'.`)
                    }

                    validateSourceBackedText(
                        source,
                        `Statement ${statementIndex + 1} in ${stepPath}`,
                        statement,
                        errors
                    )
                })
                break
            case 'return':
                if (isVoidReturnType(methodReturnType)) {
                    if (step.expression !== null) {
                        errors.push(`Void/None return step ${stepPath} must use expression: null.`)
                    }
                    break
                }

                if (step.expression === null) {
                    errors.push(`Non-void return step ${stepPath} must include an expression.`)
                    break
                }

                validateSourceBackedText(
                    source,
                    `Return expression in ${stepPath}`,
                    step.expression,
                    errors
                )
                break
            case 'break':
                if (loopDepth === 0) {
                    errors.push(`Break step ${stepPath} is outside any loop.`)
                }
                break
            case 'continue':
                if (loopDepth === 0) {
                    errors.push(`Continue step ${stepPath} is outside any loop.`)
                }
                break
            case 'if':
                validateSourceBackedText(
                    source,
                    `Condition in ${stepPath}`,
                    step.condition,
                    errors
                )
                validateStepSequence(step.then, source, errors, `${stepPath}.then`, loopDepth, methodReturnType)
                validateStepSequence(step.else, source, errors, `${stepPath}.else`, loopDepth, methodReturnType)
                break
            case 'loop':
                if (!isAllowedSyntheticCondition(step.condition)) {
                    validateSourceBackedText(
                        source,
                        `Loop condition in ${stepPath}`,
                        step.condition,
                        errors
                    )
                }

                if (step.iteratorStart) {
                    validateSourceBackedText(
                        source,
                        `Loop iteratorStart in ${stepPath}`,
                        step.iteratorStart,
                        errors
                    )
                }

                if (step.iteratorUpdate) {
                    validateSourceBackedText(
                        source,
                        `Loop iteratorUpdate in ${stepPath}`,
                        step.iteratorUpdate,
                        errors
                    )
                }

                validateStepSequence(step.body, source, errors, `${stepPath}.body`, loopDepth + 1, methodReturnType)
                break
        }

        if ((step.kind === 'return' || step.kind === 'break' || step.kind === 'continue') && index < steps.length - 1) {
            errors.push(`Step ${stepPath} is followed by unreachable sibling steps.`)
        }
    })
}

export function validateMethodPlan(method: DiscoveredMethod, plan: MethodPlan): PlanValidationResult {
    const errors: string[] = []
    const normalizedSource = normalizeComparableText(method.source)

    if (plan.name.trim() !== method.name.trim()) {
        errors.push(`Plan method name '${plan.name}' does not match discovered method '${method.name}'.`)
    }

    if (plan.returnType.trim() !== method.returnType.trim()) {
        errors.push(`Plan return type '${plan.returnType}' does not match discovered method '${method.returnType}'.`)
    }

    const serializedPlanParameters = JSON.stringify(plan.parameters)
    const serializedMethodParameters = JSON.stringify(method.parameters)
    if (serializedPlanParameters !== serializedMethodParameters) {
        errors.push(`Plan parameters do not match discovered method parameters for '${method.name}'.`)
    }

    validateStepSequence(plan.body, normalizedSource, errors, 'body', 0, method.returnType)

    return {
        valid: errors.length === 0,
        errors
    }
}
