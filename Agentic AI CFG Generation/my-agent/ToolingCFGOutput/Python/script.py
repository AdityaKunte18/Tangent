from pycfg.pycfg import PyCFG, CFGNode, slurp
import argparse

if __name__=='__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument("pythonfile", help="The python file to be analyzed")
    args = parser.parse_args()

    cfg = PyCFG()
    cfg.gen_cfg(slurp(args.pythonfile).strip())

    nodes = CFGNode.cache
    node_count = len(nodes)

    edge_count = 0
    for n in nodes.values():
        edge_count += len(n.children)

    print("NODES:::", node_count)
    print("EDGES:::", edge_count)

    for node_id, node in CFGNode.cache.items():
        print(f"NODE {node_id}: {node.source()}")
        for child in node.children:
            print(f" -> {child.rid}")
    