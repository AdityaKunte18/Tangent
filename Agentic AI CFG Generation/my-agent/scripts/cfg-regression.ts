import assert from 'node:assert/strict'
import { compileMethodPlan } from '../cfg/compile-plan.js'
import { normalizeDraft } from '../cfg/normalize.js'
import { validateMethodPlan } from '../cfg/plan-validate.js'
import { validateMethodDraft } from '../cfg/validate.js'
import { CfgMethodDraft, DiscoveredMethod, MethodPlan } from '../cfg/schema.js'

type RegressionMethodInput = Omit<DiscoveredMethod, 'startLine' | 'endLine'>

interface CfgRegressionCase {
    name: string
    method: RegressionMethodInput
    draft: CfgMethodDraft
    assertNormalized: (draft: CfgMethodDraft) => void
}

interface PlanRegressionCase {
    name: string
    method: RegressionMethodInput
    plan: MethodPlan
    assertCompiled: (draft: CfgMethodDraft) => void
}

function materializeRegressionMethod(method: RegressionMethodInput): DiscoveredMethod {
    const lineCount = Math.max(1, method.source.split('\n').length)

    return {
        ...method,
        startLine: 1,
        endLine: lineCount
    }
}

function runRegressionCase(testCase: CfgRegressionCase): void {
    const normalized = normalizeDraft(materializeRegressionMethod(testCase.method), testCase.draft)
    const validation = validateMethodDraft(normalized)

    assert.equal(validation.valid, true, `${testCase.name} should validate. Errors: ${validation.errors.join(' | ')}`)
    testCase.assertNormalized(normalized)
    console.log(`PASS ${testCase.name}`)
}

function runPlanRegressionCase(testCase: PlanRegressionCase): void {
    const method = materializeRegressionMethod(testCase.method)
    const planValidation = validateMethodPlan(method, testCase.plan)
    assert.equal(planValidation.valid, true, `${testCase.name} should have a valid MethodPlan. Errors: ${planValidation.errors.join(' | ')}`)

    const draft = compileMethodPlan(method, testCase.plan)
    const cfgValidation = validateMethodDraft(draft, method.source)
    assert.equal(cfgValidation.valid, true, `${testCase.name} should compile into a valid CFG. Errors: ${cfgValidation.errors.join(' | ')}`)
    testCase.assertCompiled(draft)
    console.log(`PASS ${testCase.name}`)
}

const regressionCases: CfgRegressionCase[] = [
    {
        name: 'straight-line void method',
        method: {
            name: 'basic',
            returnType: 'void',
            parameters: [],
            source: 'void basic () { int x = 1; int y = 2; printf(x + y); }'
        },
        draft: {
            name: 'basic',
            returnType: 'void',
            parameters: [],
            nodes: [
                {
                    id: 'entry',
                    type: 'entry',
                    next: 'body'
                },
                {
                    id: 'body',
                    type: 'block',
                    statements: ['int x = 1;', 'int y = 2;', 'printf(x + y);', 'return;']
                },
                {
                    id: 'exit',
                    type: 'exit',
                    returnValues: [],
                    next: null
                }
            ]
        },
        assertNormalized: (draft) => {
            const body = draft.nodes.find((node) => node.id === 'body')
            assert.ok(body?.type === 'block')
            assert.equal(body.next, 'exit')
            assert.deepEqual(body.statements, ['int x = 1;', 'int y = 2;', 'printf(x + y);'])
        }
    },
    {
        name: 'loop with synthetic return',
        method: {
            name: 'decrement',
            returnType: 'int',
            parameters: [
                { name: 'start_number', type: 'int' },
                { name: 'times', type: 'int' }
            ],
            source: 'int decrement(int start_number, int times) { int value = start_number; for (int i = 0; i < times; i++) { value--; } return value; }'
        },
        draft: {
            name: 'decrement',
            returnType: 'int',
            parameters: [
                { name: 'start_number', type: 'int' },
                { name: 'times', type: 'int' }
            ],
            nodes: [
                {
                    id: 'entry',
                    type: 'entry',
                    arguments: [
                        { name: 'start_number', type: 'int' },
                        { name: 'times', type: 'int' }
                    ],
                    next: 'block_init'
                },
                {
                    id: 'block_init',
                    type: 'block',
                    statements: ['int value = start_number', 'int i = 0'],
                    next: 'loop_condition'
                },
                {
                    id: 'loop_condition',
                    type: 'loop',
                    predicates: [
                        {
                            id: 'pred_1',
                            statement: 'i < times',
                            onTrue: 'loop_body',
                            onFalse: 'block_return'
                        }
                    ],
                    iteratorStart: null,
                    iteratorUpdate: 'i++'
                },
                {
                    id: 'loop_body',
                    type: 'block',
                    statements: ['value--']
                },
                {
                    id: 'block_return',
                    type: 'block',
                    statements: ['_return_value = value']
                },
                {
                    id: 'exit',
                    type: 'exit',
                    returnValues: [{ name: '_return_value', type: 'int' }],
                    next: null
                }
            ]
        },
        assertNormalized: (draft) => {
            const loopBody = draft.nodes.find((node) => node.id === 'loop_body')
            const returnBlock = draft.nodes.find((node) => node.id === 'block_return')
            assert.ok(loopBody?.type === 'block')
            assert.ok(returnBlock?.type === 'block')
            assert.equal(loopBody.next, 'loop_condition')
            assert.equal(returnBlock.next, 'exit')
        }
    },
    {
        name: 'branching non-void returns',
        method: {
            name: 'conditional1',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            source: 'int conditional1(int x, int y) { if (x + y > 0) { printf(\"positive\"); return 1; } printf(\"negative\"); return 0; }'
        },
        draft: {
            name: 'conditional1',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            nodes: [
                {
                    id: 'entry',
                    type: 'entry',
                    next: 'cond'
                },
                {
                    id: 'cond',
                    type: 'conditional',
                    predicates: [
                        {
                            id: 'p1',
                            statement: 'x + y > 0',
                            onTrue: 't_block',
                            onFalse: 'f_block'
                        }
                    ]
                },
                {
                    id: 't_block',
                    type: 'block',
                    statements: ['printf(\"positive\");', 'return 1;']
                },
                {
                    id: 'f_block',
                    type: 'block',
                    statements: ['printf(\"negative\");', 'return 0;']
                },
                {
                    id: 'exit',
                    type: 'exit',
                    returnValues: [],
                    next: null
                }
            ]
        },
        assertNormalized: (draft) => {
            const syntheticBlocks = draft.nodes.filter((node) => node.type === 'block' && (node.statements ?? []).some((statement) => statement.includes('_return_value')))
            assert.equal(syntheticBlocks.length, 2)
            assert.ok(syntheticBlocks.every((node) => node.next === 'exit'))
        }
    },
    {
        name: 'branch blocks connect to unreferenced synthetic returns',
        method: {
            name: 'conditional1_split',
            returnType: 'boolean',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            source: 'boolean conditional1_split(int x, int y) { if (x + y > 0) { print(\"positive\"); return true; } print(\"negative\"); return false; }'
        },
        draft: {
            name: 'conditional1_split',
            returnType: 'boolean',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            nodes: [
                {
                    id: 'entry',
                    type: 'entry',
                    next: 'cond'
                },
                {
                    id: 'cond',
                    type: 'conditional',
                    predicates: [
                        {
                            id: 'p1',
                            statement: 'x + y > 0',
                            onTrue: 'true_print',
                            onFalse: 'false_print'
                        }
                    ]
                },
                {
                    id: 'true_print',
                    type: 'block',
                    statements: ['print(\"positive\")']
                },
                {
                    id: 'true_return',
                    type: 'block',
                    statements: ['_return_value = true'],
                    next: 'exit'
                },
                {
                    id: 'false_print',
                    type: 'block',
                    statements: ['print(\"negative\")']
                },
                {
                    id: 'false_return',
                    type: 'block',
                    statements: ['_return_value = false'],
                    next: 'exit'
                },
                {
                    id: 'exit',
                    type: 'exit',
                    returnValues: [{ name: '_return_value', type: 'boolean' }],
                    next: null
                }
            ]
        },
        assertNormalized: (draft) => {
            const truePrint = draft.nodes.find((node) => node.id === 'true_print')
            const falsePrint = draft.nodes.find((node) => node.id === 'false_print')
            assert.ok(truePrint?.type === 'block')
            assert.ok(falsePrint?.type === 'block')
            assert.equal(truePrint.next, 'true_return')
            assert.equal(falsePrint.next, 'false_return')
        }
    },
    {
        name: 'void early returns in nested conditionals',
        method: {
            name: 'conditional2',
            returnType: 'void',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            source: 'void conditional2(int x, int y) { if (x > 0 || y < 0) { printf(\"first true\"); return; } else if (x < 0 && y > 0) { printf(\"second true\"); return; } printf(\"both false\"); return; }'
        },
        draft: {
            name: 'conditional2',
            returnType: 'void',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            nodes: [
                {
                    id: 'entry',
                    type: 'entry',
                    next: 'c1'
                },
                {
                    id: 'c1',
                    type: 'conditional',
                    predicates: [
                        {
                            id: 'p1',
                            statement: 'x > 0',
                            onTrue: 'first',
                            onFalse: 'p2'
                        },
                        {
                            id: 'p2',
                            statement: 'y < 0',
                            onTrue: 'first',
                            onFalse: 'c2'
                        }
                    ]
                },
                {
                    id: 'first',
                    type: 'block',
                    statements: ['printf(\"first true\");', 'return;']
                },
                {
                    id: 'c2',
                    type: 'conditional',
                    predicates: [
                        {
                            id: 'p3',
                            statement: 'x < 0',
                            onTrue: 'p4',
                            onFalse: 'end'
                        },
                        {
                            id: 'p4',
                            statement: 'y > 0',
                            onTrue: 'second',
                            onFalse: 'end'
                        }
                    ]
                },
                {
                    id: 'second',
                    type: 'block',
                    statements: ['printf(\"second true\");', 'return;']
                },
                {
                    id: 'end',
                    type: 'block',
                    statements: ['printf(\"both false\");', 'return;']
                },
                {
                    id: 'exit',
                    type: 'exit',
                    returnValues: [],
                    next: null
                }
            ]
        },
        assertNormalized: (draft) => {
            const branchBlocks = draft.nodes.filter((node) => node.type === 'block' && ['first', 'second', 'end'].includes(node.id))
            assert.ok(branchBlocks.every((node) => node.next === 'exit'))
            assert.ok(branchBlocks.every((node) => !(node.statements ?? []).some((statement) => statement.trim().startsWith('return'))))
        }
    },
    {
        name: 'void branch leaves normalize to exit',
        method: {
            name: 'conditional2_split',
            returnType: 'void',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            source: 'void conditional2_split(int x, int y) { if (x > 0 || y < 0) { print(\"first true\"); return; } else if (x < 0 && y > 0) { print(\"second true\"); return; } print(\"both false\"); return; }'
        },
        draft: {
            name: 'conditional2_split',
            returnType: 'void',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            nodes: [
                {
                    id: 'entry',
                    type: 'entry',
                    next: 'c1'
                },
                {
                    id: 'c1',
                    type: 'conditional',
                    predicates: [
                        {
                            id: 'p1',
                            statement: 'x > 0',
                            onTrue: 'first',
                            onFalse: 'p2'
                        },
                        {
                            id: 'p2',
                            statement: 'y < 0',
                            onTrue: 'first',
                            onFalse: 'c2'
                        }
                    ]
                },
                {
                    id: 'first',
                    type: 'block',
                    statements: ['print(\"first true\")']
                },
                {
                    id: 'c2',
                    type: 'conditional',
                    predicates: [
                        {
                            id: 'p3',
                            statement: 'x < 0',
                            onTrue: 'p4',
                            onFalse: 'end'
                        },
                        {
                            id: 'p4',
                            statement: 'y > 0',
                            onTrue: 'second',
                            onFalse: 'end'
                        }
                    ]
                },
                {
                    id: 'second',
                    type: 'block',
                    statements: ['print(\"second true\")']
                },
                {
                    id: 'end',
                    type: 'block',
                    statements: ['print(\"both false\")']
                },
                {
                    id: 'exit',
                    type: 'exit',
                    returnValues: [],
                    next: null
                }
            ]
        },
        assertNormalized: (draft) => {
            const branchBlocks = draft.nodes.filter((node) => node.type === 'block' && ['first', 'second', 'end'].includes(node.id))
            assert.ok(branchBlocks.every((node) => node.next === 'exit'))
        }
    },
    {
        name: 'dangling loop init and update blocks are rewired',
        method: {
            name: 'decrement_split',
            returnType: 'int',
            parameters: [
                { name: 'start_number', type: 'int' },
                { name: 'times', type: 'int' }
            ],
            source: 'int decrement_split(int start_number, int times) { int value = start_number; for (int i = 0; i < times; i++) { value--; } return value; }'
        },
        draft: {
            name: 'decrement_split',
            returnType: 'int',
            parameters: [
                { name: 'start_number', type: 'int' },
                { name: 'times', type: 'int' }
            ],
            nodes: [
                {
                    id: 'entry',
                    type: 'entry',
                    next: 'init_value'
                },
                {
                    id: 'init_value',
                    type: 'block',
                    statements: ['value = start_number;'],
                    next: 'loop_condition'
                },
                {
                    id: 'init_i',
                    type: 'block',
                    statements: ['i = 0;']
                },
                {
                    id: 'loop_condition',
                    type: 'loop',
                    predicates: [
                        {
                            id: 'p1',
                            statement: 'i < times',
                            onTrue: 'loop_body',
                            onFalse: 'return_block'
                        }
                    ]
                },
                {
                    id: 'loop_body',
                    type: 'block',
                    statements: ['value--;'],
                    next: 'loop_condition'
                },
                {
                    id: 'loop_increment',
                    type: 'block',
                    statements: ['i++;']
                },
                {
                    id: 'return_block',
                    type: 'block',
                    statements: ['_return_value = value;'],
                    next: 'exit'
                },
                {
                    id: 'exit',
                    type: 'exit',
                    returnValues: [{ name: '_return_value', type: 'int' }],
                    next: null
                }
            ]
        },
        assertNormalized: (draft) => {
            const initValue = draft.nodes.find((node) => node.id === 'init_value')
            const initI = draft.nodes.find((node) => node.id === 'init_i')
            const loopBody = draft.nodes.find((node) => node.id === 'loop_body')
            const loopIncrement = draft.nodes.find((node) => node.id === 'loop_increment')
            assert.ok(initValue?.type === 'block')
            assert.ok(initI?.type === 'block')
            assert.ok(loopBody?.type === 'block')
            assert.ok(loopIncrement?.type === 'block')
            assert.equal(initValue.next, 'init_i')
            assert.equal(initI.next, 'loop_condition')
            assert.equal(loopBody.next, 'loop_increment')
            assert.equal(loopIncrement.next, 'loop_condition')
        }
    },
    {
        name: 'orphan inner conditional is spliced into loop flow',
        method: {
            name: 'method005',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            source: [
                'int method005(int x, int y) {',
                '    int loopCounter = 0;',
                '    for (int i = 0; i < y; i += x) {',
                '        loopCounter++;',
                '        if (loopCounter % 5) {',
                '            loopCounter += 2;',
                '        }',
                '    }',
                '    return loopCounter;',
                '}'
            ].join('\n')
        },
        draft: {
            name: 'method005',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            nodes: [
                {
                    id: 'entry',
                    type: 'entry',
                    next: 'init_block'
                },
                {
                    id: 'init_block',
                    type: 'block',
                    statements: ['int loopCounter = 0;']
                },
                {
                    id: 'loop_node',
                    type: 'loop',
                    predicates: [
                        {
                            id: 'loop_cond',
                            statement: 'i < y',
                            onTrue: 'loop_body_block',
                            onFalse: 'return_block'
                        }
                    ],
                    iteratorStart: 'int i = 0;',
                    iteratorUpdate: 'i += x'
                },
                {
                    id: 'loop_body_block',
                    type: 'block',
                    statements: ['loopCounter++;'],
                    next: 'loop_node'
                },
                {
                    id: 'if_conditional',
                    type: 'conditional',
                    predicates: [
                        {
                            id: 'if_cond',
                            statement: 'loopCounter % 5',
                            onTrue: 'if_true_block',
                            onFalse: 'after_if_block'
                        }
                    ]
                },
                {
                    id: 'if_true_block',
                    type: 'block',
                    statements: ['loopCounter += 2;']
                },
                {
                    id: 'after_if_block',
                    type: 'block',
                    statements: []
                },
                {
                    id: 'return_block',
                    type: 'block',
                    statements: ['_return_value = loopCounter;'],
                    next: 'exit'
                },
                {
                    id: 'exit',
                    type: 'exit',
                    returnValues: [{ name: '_return_value', type: 'int' }],
                    next: null
                }
            ]
        },
        assertNormalized: (draft) => {
            const initBlock = draft.nodes.find((node) => node.id === 'init_block')
            const loopBodyBlock = draft.nodes.find((node) => node.id === 'loop_body_block')
            const ifTrueBlock = draft.nodes.find((node) => node.id === 'if_true_block')
            const afterIfBlock = draft.nodes.find((node) => node.id === 'after_if_block')
            assert.ok(initBlock?.type === 'block')
            assert.ok(loopBodyBlock?.type === 'block')
            assert.ok(ifTrueBlock?.type === 'block')
            assert.ok(afterIfBlock?.type === 'block')
            assert.equal(initBlock.next, 'loop_node')
            assert.equal(loopBodyBlock.next, 'if_conditional')
            assert.equal(ifTrueBlock.next, 'after_if_block')
            assert.equal(afterIfBlock.next, 'loop_node')
        }
    },
    {
        name: 'nested loop branches reconnect to the inner loop update',
        method: {
            name: 'method007',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            source: [
                'int method007(int x, int y) {',
                '    int loopCounter = 0;',
                '    for (int i = 0; i < y; i ++) {',
                '        for (int j = x; j >= 0; j --) {',
                '            if (j == i) {',
                '                loopCounter += 2;',
                '            } else {',
                '                loopCounter += 3;',
                '            }',
                '        }',
                '    }',
                '    return loopCounter;',
                '}'
            ].join('\n')
        },
        draft: {
            name: 'method007',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            nodes: [
                {
                    id: 'entry',
                    type: 'entry',
                    next: 'init_loop_counter'
                },
                {
                    id: 'init_loop_counter',
                    type: 'block',
                    statements: ['int loopCounter = 0;'],
                    next: 'outer_loop'
                },
                {
                    id: 'outer_loop',
                    type: 'loop',
                    predicates: [
                        {
                            id: 'p_outer_cond',
                            statement: 'i < y',
                            onTrue: 'inner_loop',
                            onFalse: 'return_block'
                        }
                    ],
                    iteratorStart: 'int i = 0;',
                    iteratorUpdate: 'i ++'
                },
                {
                    id: 'inner_loop',
                    type: 'loop',
                    predicates: [
                        {
                            id: 'p_inner_cond',
                            statement: 'j >= 0',
                            onTrue: 'if_j_eq_i',
                            onFalse: 'outer_loop_update'
                        }
                    ],
                    iteratorStart: 'int j = x;',
                    iteratorUpdate: 'j --'
                },
                {
                    id: 'if_j_eq_i',
                    type: 'conditional',
                    predicates: [
                        {
                            id: 'p_j_eq_i',
                            statement: 'j == i',
                            onTrue: 'then_block',
                            onFalse: 'else_block'
                        }
                    ]
                },
                {
                    id: 'then_block',
                    type: 'block',
                    statements: ['loopCounter += 2;']
                },
                {
                    id: 'else_block',
                    type: 'block',
                    statements: ['loopCounter += 3;']
                },
                {
                    id: 'inner_loop_update',
                    type: 'block',
                    statements: ['j --;'],
                    next: 'outer_loop'
                },
                {
                    id: 'outer_loop_update',
                    type: 'block',
                    statements: ['i ++;']
                },
                {
                    id: 'return_block',
                    type: 'block',
                    statements: ['_return_value = loopCounter;'],
                    next: 'exit'
                },
                {
                    id: 'exit',
                    type: 'exit',
                    returnValues: [{ name: '_return_value', type: 'int' }],
                    next: null
                }
            ]
        },
        assertNormalized: (draft) => {
            const thenBlock = draft.nodes.find((node) => node.id === 'then_block')
            const elseBlock = draft.nodes.find((node) => node.id === 'else_block')
            const innerLoopUpdate = draft.nodes.find((node) => node.id === 'inner_loop_update')
            const outerLoopUpdate = draft.nodes.find((node) => node.id === 'outer_loop_update')
            assert.ok(thenBlock?.type === 'block')
            assert.ok(elseBlock?.type === 'block')
            assert.ok(innerLoopUpdate?.type === 'block')
            assert.ok(outerLoopUpdate?.type === 'block')
            assert.equal(thenBlock.next, 'inner_loop_update')
            assert.equal(elseBlock.next, 'inner_loop_update')
            assert.equal(innerLoopUpdate.next, 'inner_loop')
            assert.equal(outerLoopUpdate.next, 'outer_loop')
        }
    },
    {
        name: 'constant-true loop break conditional is spliced into the loop body',
        method: {
            name: 'method009',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            source: [
                'int method009(int x, int y) {',
                '    int loopCounter = 0;',
                '    while (true) {',
                '        loopCounter++;',
                '        if (loopCounter + x == y) {',
                '            break;',
                '        }',
                '    }',
                '    return loopCounter;',
                '}'
            ].join('\n')
        },
        draft: {
            name: 'method009',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            nodes: [
                {
                    id: 'entry',
                    type: 'entry',
                    next: 'init_loop_counter'
                },
                {
                    id: 'init_loop_counter',
                    type: 'block',
                    statements: ['int loopCounter = 0;'],
                    next: 'while_true_loop'
                },
                {
                    id: 'while_true_loop',
                    type: 'loop',
                    next: 'loop_increment',
                    predicates: []
                },
                {
                    id: 'loop_increment',
                    type: 'block',
                    statements: ['loopCounter++;'],
                    next: 'while_true_loop'
                },
                {
                    id: 'check_break_condition',
                    type: 'conditional',
                    predicates: [
                        {
                            id: 'p1',
                            statement: 'loopCounter + x == y',
                            onTrue: 'break_from_loop',
                            onFalse: 'loop_increment'
                        }
                    ]
                },
                {
                    id: 'break_from_loop',
                    type: 'jump',
                    next: 'assign_return_value',
                    jumpKind: 'break'
                },
                {
                    id: 'assign_return_value',
                    type: 'block',
                    statements: ['_return_value = loopCounter;'],
                    next: 'exit'
                },
                {
                    id: 'exit',
                    type: 'exit',
                    returnValues: [{ name: '_return_value', type: 'int' }],
                    next: null
                }
            ]
        },
        assertNormalized: (draft) => {
            const loopIncrement = draft.nodes.find((node) => node.id === 'loop_increment')
            const whileTrueLoop = draft.nodes.find((node) => node.id === 'while_true_loop')
            const breakCondition = draft.nodes.find((node) => node.id === 'check_break_condition')
            const breakFromLoop = draft.nodes.find((node) => node.id === 'break_from_loop')
            assert.ok(loopIncrement?.type === 'block')
            assert.ok(whileTrueLoop?.type === 'loop')
            assert.ok(breakCondition?.type === 'conditional')
            assert.ok(breakFromLoop?.type === 'jump')
            assert.equal(whileTrueLoop.next, undefined)
            assert.equal(whileTrueLoop.predicates?.[0]?.statement, 'true')
            assert.equal(whileTrueLoop.predicates?.[0]?.onTrue, 'loop_increment')
            assert.equal(loopIncrement.next, 'check_break_condition')
            assert.equal(breakCondition.predicates?.[0]?.onFalse, 'while_true_loop')
            assert.equal(breakFromLoop.next, 'assign_return_value')
        }
    }
]

const planRegressionCases: PlanRegressionCase[] = [
    {
        name: 'plan compiler handles nested loops with an inner conditional',
        method: {
            name: 'method007',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            source: [
                'int method007(int x, int y) {',
                '    int loopCounter = 0;',
                '    for (int i = 0; i < y; i ++) {',
                '        for (int j = x; j >= 0; j --) {',
                '            if (j == i) {',
                '                loopCounter += 2;',
                '            } else {',
                '                loopCounter += 3;',
                '            }',
                '        }',
                '    }',
                '    return loopCounter;',
                '}'
            ].join('\n')
        },
        plan: {
            name: 'method007',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            body: [
                {
                    kind: 'block',
                    statements: ['int loopCounter = 0;']
                },
                {
                    kind: 'loop',
                    loopType: 'for',
                    condition: 'i < y',
                    iteratorStart: 'int i = 0;',
                    iteratorUpdate: 'i ++',
                    body: [
                        {
                            kind: 'loop',
                            loopType: 'for',
                            condition: 'j >= 0',
                            iteratorStart: 'int j = x;',
                            iteratorUpdate: 'j --',
                            body: [
                                {
                                    kind: 'if',
                                    condition: 'j == i',
                                    then: [
                                        {
                                            kind: 'block',
                                            statements: ['loopCounter += 2;']
                                        }
                                    ],
                                    else: [
                                        {
                                            kind: 'block',
                                            statements: ['loopCounter += 3;']
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    kind: 'return',
                    expression: 'loopCounter'
                }
            ]
        },
        assertCompiled: (draft) => {
            const outerLoop = draft.nodes.find((node) => node.type === 'loop' && node.iteratorStart === 'int i = 0;')
            const innerLoop = draft.nodes.find((node) => node.type === 'loop' && node.iteratorStart === 'int j = x;')
            const thenBlock = draft.nodes.find((node) => node.type === 'block' && node.statements?.includes('loopCounter += 2;'))
            const elseBlock = draft.nodes.find((node) => node.type === 'block' && node.statements?.includes('loopCounter += 3;'))
            const innerUpdate = draft.nodes.find((node) => node.type === 'block' && node.statements?.includes('j --'))
            const outerUpdate = draft.nodes.find((node) => node.type === 'block' && node.statements?.includes('i ++'))

            assert.ok(outerLoop?.type === 'loop')
            assert.ok(innerLoop?.type === 'loop')
            assert.ok(thenBlock?.type === 'block')
            assert.ok(elseBlock?.type === 'block')
            assert.ok(innerUpdate?.type === 'block')
            assert.ok(outerUpdate?.type === 'block')
            assert.equal(thenBlock.next, innerUpdate.id)
            assert.equal(elseBlock.next, innerUpdate.id)
            assert.equal(innerUpdate.next, innerLoop.id)
            assert.equal(outerUpdate.next, outerLoop.id)
        }
    },
    {
        name: 'plan compiler handles while-true loop with break',
        method: {
            name: 'method009',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            source: [
                'int method009(int x, int y) {',
                '    int loopCounter = 0;',
                '    while (true) {',
                '        loopCounter++;',
                '        if (loopCounter + x == y) {',
                '            break;',
                '        }',
                '    }',
                '    return loopCounter;',
                '}'
            ].join('\n')
        },
        plan: {
            name: 'method009',
            returnType: 'int',
            parameters: [
                { name: 'x', type: 'int' },
                { name: 'y', type: 'int' }
            ],
            body: [
                {
                    kind: 'block',
                    statements: ['int loopCounter = 0;']
                },
                {
                    kind: 'loop',
                    loopType: 'while',
                    condition: 'true',
                    iteratorStart: null,
                    iteratorUpdate: null,
                    body: [
                        {
                            kind: 'block',
                            statements: ['loopCounter++;']
                        },
                        {
                            kind: 'if',
                            condition: 'loopCounter + x == y',
                            then: [
                                {
                                    kind: 'break'
                                }
                            ],
                            else: []
                        }
                    ]
                },
                {
                    kind: 'return',
                    expression: 'loopCounter'
                }
            ]
        },
        assertCompiled: (draft) => {
            const whileLoop = draft.nodes.find((node) => node.type === 'loop' && node.predicates?.[0]?.statement === 'true')
            const incrementBlock = draft.nodes.find((node) => node.type === 'block' && node.statements?.includes('loopCounter++;'))
            const breakConditional = draft.nodes.find((node) => node.type === 'conditional' && node.predicates?.[0]?.statement === 'loopCounter + x == y')
            const breakJump = draft.nodes.find((node) => node.type === 'jump' && node.jumpKind === 'break')

            assert.ok(whileLoop?.type === 'loop')
            assert.ok(incrementBlock?.type === 'block')
            assert.ok(breakConditional?.type === 'conditional')
            assert.ok(breakJump?.type === 'jump')
            assert.equal(whileLoop.predicates?.[0]?.onTrue, incrementBlock.id)
            assert.equal(incrementBlock.next, breakConditional.id)
            assert.equal(breakConditional.predicates?.[0]?.onFalse, whileLoop.id)
            assert.notEqual(breakJump.next, whileLoop.id)
        }
    }
]

for (const testCase of regressionCases) {
    runRegressionCase(testCase)
}

for (const testCase of planRegressionCases) {
    runPlanRegressionCase(testCase)
}

{
    const source = 'def basic():\n    x = 1\n    print(x)\n'
    const hallucinatedDraft: CfgMethodDraft = {
        name: 'basic',
        returnType: 'None',
        parameters: [],
        nodes: [
            {
                id: 'entry',
                type: 'entry',
                arguments: [],
                next: 'body'
            },
            {
                id: 'body',
                type: 'block',
                statements: ['x = 1', 'print(x) extra unrelated prose'],
                next: 'exit'
            },
            {
                id: 'exit',
                type: 'exit',
                returnValues: [],
                next: null
            }
        ]
    }
    const validation = validateMethodDraft(hallucinatedDraft, source)
    assert.equal(validation.valid, false)
    assert.ok(validation.errors.some((error) => error.includes('does not appear in the source method')))
    console.log('PASS source-aware validation rejects hallucinated statements')
}

{
    const method = materializeRegressionMethod({
        name: 'missing_return_expression',
        returnType: 'int',
        parameters: [],
        source: 'int missing_return_expression() { return 1; }'
    })
    const plan: MethodPlan = {
        name: 'missing_return_expression',
        returnType: 'int',
        parameters: [],
        body: [
            {
                kind: 'return',
                expression: null
            }
        ]
    }
    const validation = validateMethodPlan(method, plan)
    assert.equal(validation.valid, false)
    assert.ok(validation.errors.some((error) => error.includes('must include an expression')))
    console.log('PASS plan validation rejects missing non-void return expressions')
}

{
    const method = materializeRegressionMethod({
        name: 'missing_condition',
        returnType: 'int',
        parameters: [],
        source: 'int missing_condition(int x) { if (x > 0) { return 1; } return 0; }'
    })
    const plan: MethodPlan = {
        name: 'missing_condition',
        returnType: 'int',
        parameters: [],
        body: [
            {
                kind: 'if',
                condition: '',
                then: [
                    {
                        kind: 'return',
                        expression: '1'
                    }
                ],
                else: [
                    {
                        kind: 'return',
                        expression: '0'
                    }
                ]
            }
        ]
    }
    const validation = validateMethodPlan(method, plan)
    assert.equal(validation.valid, false)
    assert.ok(validation.errors.some((error) => error.includes('Condition in body[0] must not be blank.')))
    console.log('PASS plan validation rejects missing conditions')
}

console.log(`PASS ${regressionCases.length + planRegressionCases.length + 3} cfg regression cases`)
