import { stringify } from 'yaml'
import { FinalCfgDocument } from './schema.js'

export function exportCfgDocument(document: FinalCfgDocument): string {
    return stringify(document, {
        indent: 4,
        lineWidth: 0,
        sortMapEntries: false
    }).trimEnd() + '\n'
}
