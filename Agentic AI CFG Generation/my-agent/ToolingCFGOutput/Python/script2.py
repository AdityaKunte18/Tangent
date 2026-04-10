from staticfg import CFGBuilder

builder = CFGBuilder()
files = ['DFS.py', 'PCP.py', 'test.py']

for file in files:
    cfg = builder.build_from_file('MyGraph', file)
    cfg.build_visual(file, 'dot')