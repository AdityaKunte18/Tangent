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

def test_cw_statement_N2():
    a = (0, 0)
    b = (1, 0)
    c = (0, 1)
    result = module.cw(a, b, c)
    assert result is False

def test_convexHull_M3_N13a_true():
    # Objective: Take TRUE on len(up) > 1 and ccw(up[len(up) - 2], up[len(up) - 1], v[i]) (M3:N13a:true)
    # This requires 'up' to have at least two points, and the current point v[i] to form a counter-clockwise turn
    # with the last two points in 'up'.
    # Also, the 'if i == n - 1 or (not ccw(p1, v[i], p2))' condition must be true to enter the upper hull logic.

    # Points are chosen to be already sorted by x-coordinate, then y-coordinate, to simplify reasoning.
    # n = 4, p1 = (0,0), p2 = (2,0)
    v = [(0, 0), (1, 0), (1.5, 0.5), (2, 0)]

    # Trace:
    # 1. v.sort() is called (no change to v).
    # 2. n = 4. n <= 3 is False (N4a:false).
    # 3. p1 = (0,0), p2 = (2,0).
    # 4. up = [], down = [].
    # 5. up.append(tuple(p1)) -> up = [(0,0)]. down.append(p1) -> down = [(0,0)].

    # Loop for i in range(1, n):
    # i = 1, v[1] = (1,0):
    #   - N11a: i == n - 1 (1==3) is False. ccw(p1, v[1], p2) = ccw((0,0), (1,0), (2,0)) = 0 (collinear). (not ccw) is True.
    #     Condition (False or True) is True. Enter upper hull 'if' block.
    #   - N13a: len(up) > 1 (1>1) is False. While loop is skipped.
    #   - N19: up.append(tuple(v[1])) -> up = [(0,0), (1,0)].
    #   - N14a: i == n - 1 (1==3) is False. Condition (False and ...) is False. Skip lower hull 'if' block.

    # i = 2, v[2] = (1.5,0.5):
    #   - N11a: i == n - 1 (2==3) is False. ccw(p1, v[2], p2) = ccw((0,0), (1.5,0.5), (2,0)) = -1 (clockwise). (not ccw) is True.
    #     Condition (False or True) is True. Enter upper hull 'if' block.
    #   - N13a: len(up) > 1 (2>1) is True.
    #     ccw(up[len(up)-2], up[len(up)-1], v[2]) = ccw(up[0], up[1], v[2]) = ccw((0,0), (1,0), (1.5,0.5))
    #     (1-0)*(0.5-0) - (0-0)*(1.5-0) = 0.5 - 0 = 0.5. This is > 0, so ccw is True.
    #     Both conditions for N13a are True. Objective M3:N13a:true is hit.
    #   - N18: up.pop() -> up = [(0,0)].
    #   - N13a: len(up) > 1 (1>1) is False. While loop exits (N13a:false).
    #   - N19: up.append(tuple(v[2])) -> up = [(0,0), (1.5,0.5)].
    #   - N14a: i == n - 1 (2==3) is False. Condition (False and ...) is False. Skip lower hull 'if' block.

    # i = 3, v[3] = (2,0):
    #   - N11a: i == n - 1 (3==3) is True. Condition (True or ...) is True. Enter upper hull 'if' block.
    #   - N13a: len(up) > 1 (2>1) is True.
    #     ccw(up[len(up)-2], up[len(up)-1], v[3]) = ccw(up[0], up[1], v[3]) = ccw((0,0), (1.5,0.5), (2,0))
    #     (1.5-0)*(0-0) - (0.5-0)*(2-0) = 0 - 1 = -1. This is not > 0, so ccw is False.
    #     While loop is skipped.
    #   - N19: up.append(tuple(v[3])) -> up = [(0,0), (1.5,0.5), (2,0)].
    #   - N14a: i == n - 1 (3==3) is True. cw(p1, v[3], p2) = cw((0,0), (2,0), (2,0)) = 0 (collinear). (not cw) is True.
    #     Condition (True and True) is True. Enter lower hull 'if' block.
    #   - N20a: len(down) > 1 (1>1) is False. While loop is skipped.
    #   - N22: down.append(v[3]) -> down = [(0,0), (2,0)].

    # End of first for loop.
    # up = [(0,0), (1.5,0.5), (2,0)]
    # down = [(0,0), (2,0)]

    # Loop for i in range(len(down) - 2, -1, -1): (N12)
    # len(down) - 2 = 2 - 2 = 0. Range is (0, -1, -1), so i = 0.
    # i = 0:
    #   - N15: up.append(tuple(down[0])) -> up = [(0,0), (1.5,0.5), (2,0), (0,0)].

    # End of second for loop.
    # N16: up = set(up) -> up = {(0,0), (1.5,0.5), (2,0)}. up = list(up).
    # N17: Return up.

    result = module.convexHull(v)

    # The expected convex hull for these points is {(0,0), (1.5,0.5), (2,0)}.
    expected_hull_points = {(0,0), (1.5,0.5), (2,0)}
    assert isinstance(result, list)
    assert set(result) == expected_hull_points
