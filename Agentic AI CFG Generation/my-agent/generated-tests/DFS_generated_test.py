import importlib.util
import pathlib
import sys
import pytest

SOURCE_PATH = pathlib.Path(r"/Users/adityakunte/Desktop/School/CS527/CS527_Project/Tangent/Agentic AI CFG Generation/my-agent/input/Real World Sampling/DFS/DFS.py")
MODULE_NAME = SOURCE_PATH.stem + "_under_test"
_spec = importlib.util.spec_from_file_location(MODULE_NAME, SOURCE_PATH)
assert _spec is not None and _spec.loader is not None
module = importlib.util.module_from_spec(_spec)
sys.modules[MODULE_NAME] = module
_spec.loader.exec_module(module)

def test_dfsRec_N3a_true_N4a_false():
    adj = {0: [1], 1: []}
    visited = {0: False, 1: True}
    res = []
    s = 0

    module.dfsRec(adj, visited, s, res)

    assert res == [0]
    assert visited[0] is True
    assert visited[1] is True

def test_dfsRec_M1_N4a_true():
    adj = {0: [1], 1: []}
    visited = {0: False, 1: False}
    s = 0
    res = []
    module.dfsRec(adj, visited, s, res)
    assert res == [0, 1]
    assert visited == {0: True, 1: True}

def test_dfs_single_node_graph():
    adj = [[]] # A graph with one node and no edges
    result = module.dfs(adj)
    assert result == [0]
