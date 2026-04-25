import { runBatchFromInputDirectory } from './cfg-generator.js'

async function main() {
    const result = await runBatchFromInputDirectory()

    if (result.failedFiles.length > 0) {
        process.exitCode = 1
    }
}

main()
    .then(() => {
        process.exit(process.exitCode ?? 0)
    })
    .catch((error) => {
        console.error('Fatal error while generating CFGs')
        console.error(error)
        process.exit(1)
    })
