#include "llvm/IR/Function.h"
#include "llvm/IR/CFG.h"
#include "llvm/IR/Module.h"
#include "llvm/IRReader/IRReader.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/raw_ostream.h"

using namespace llvm;

int main(int argc, char **argv) {
    if (argc < 2) return 1;

    LLVMContext Context;
    SMDiagnostic Err;

    auto M = parseIRFile(argv[1], Err, Context);
    if (!M) {
        Err.print(argv[0], errs());
        return 1;
    }

    for (auto &F : *M) {
        if (F.isDeclaration()) continue;
        
        outs() << "Function: " << F.getName() << "\n";
        for (auto &BB : F) {
            outs() << " Block: " << BB.getName() << "\n";

            for (auto *Succ: successors(&BB)) {
                outs() << "    -> " << Succ->getName() << "\n";
            }
        }
    }
    return 0;
}