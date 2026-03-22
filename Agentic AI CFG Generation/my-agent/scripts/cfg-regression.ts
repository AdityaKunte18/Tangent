import assert from 'node:assert/strict'
import { normalizeDraft } from '../cfg/normalize.js'
import { validateMethodDraft } from '../cfg/validate.js'
import { CfgMethodDraft, DiscoveredMethod } from '../cfg/schema.js'

interface CfgRegressionCase {
    name: string
    method: DiscoveredMethod
    draft: CfgMethodDraft
    assertNormalized: (draft: CfgMethodDraft) => void
}

function runRegressionCase(testCase: CfgRegressionCase): void {
    const normalized = normalizeDraft(testCase.method, testCase.draft)
    const validation = validateMethodDraft(normalized)

    assert.equal(validation.valid, true, `${testCase.name} should validate. Errors: ${validation.errors.join(' | ')}`)
    testCase.assertNormalized(normalized)
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
    }
]

for (const testCase of regressionCases) {
    runRegressionCase(testCase)
}

console.log(`PASS ${regressionCases.length} cfg regression cases`)
