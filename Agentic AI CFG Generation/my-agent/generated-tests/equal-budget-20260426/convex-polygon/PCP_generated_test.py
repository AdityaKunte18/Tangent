import importlib.util
import pathlib
import sys
import pytest

SOURCE_PATH = pathlib.Path(r"/Users/adityakunte/Desktop/School/CS527/CS527_Project/Tangent/Agentic AI CFG Generation/my-agent/input/Real World Sampling/Point Lies Inside Given N points of a Convex Polygon/PCP.py")
MODULE_NAME = SOURCE_PATH.stem + "_under_test"
_spec = importlib.util.spec_from_file_location(MODULE_NAME, SOURCE_PATH)
assert _spec is not None and _spec.loader is not None
module = importlib.util.module_from_spec(_spec)
sys.modules[MODULE_NAME] = module
_spec.loader.exec_module(module)

def test_cw_clockwise_points():
    a = [0, 0]
    b = [0, 1]
    c = [1, 0]
    result = module.cw(a, b, c)
    assert result is True

def test_convexHull_pop_upper_hull_ccw():
    # Points chosen to trigger the 'up.pop()' condition in the upper hull construction.
    # v[0]=(0,0), v[1]=(1,0), v[2]=(1,1), v[3]=(2,0)
    # After i=1, up = [(0,0), (1,0)]
    # For i=2, the while loop condition checks ccw(up[0], up[1], v[2]) which is ccw((0,0), (1,0), (1,1)).
    # This is a counter-clockwise turn, so the condition becomes true, leading to up.pop().
    v = [(0, 0), (1, 0), (1, 1), (2, 0)]
    
    result = module.convexHull(v)
    
    # The expected convex hull points are (0,0), (1,1), (2,0).
    # (1,0) is inside the hull and should be removed.
    expected_hull = {(0, 0), (1, 1), (2, 0)}
    assert set(result) == expected_hull
