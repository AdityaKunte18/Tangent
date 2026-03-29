NODES::: 53
EDGES::: 60
NODE 0: start
 -> 46
NODE 1: enter: cw(a, b, c)
 -> 3
NODE 2: exit: cw(a, b, c)
NODE 3: p = (((a[0] * (b[1] - c[1])) + (b[0] * (c[1] - a[1]))) + (c[0] * (a[1] - b[1])))
 -> 4
NODE 4: return (p < 0)
 -> 2
NODE 5: enter: ccw(a, b, c)
 -> 7
NODE 6: exit: ccw(a, b, c)
NODE 7: p = (((a[0] * (b[1] - c[1])) + (b[0] * (c[1] - a[1]))) + (c[0] * (a[1] - b[1])))
 -> 8
NODE 8: return (p > 0)
 -> 6
NODE 9: enter: convexHull(v)
 -> 11
NODE 10: exit: convexHull(v)
NODE 11: v.sort()
 -> 12
NODE 12: n = len(v)
 -> 13
NODE 13: _if: (n <= 3)
 -> 14
 -> 15
NODE 14: return v
 -> 10
NODE 15: p1 = v[0]
 -> 16
NODE 16: p2 = v[(n - 1)]
 -> 17
NODE 17: up = []
 -> 18
NODE 18: down = []
 -> 19
NODE 19: up.append(tuple(p1))
 -> 20
NODE 20: down.append(p1)
 -> 21
NODE 21: _for: (True if range(1, n) else False)
 -> 22
 -> 31
NODE 22: i = range(1, n).shift()
 -> 23
NODE 23: _if: ((i == (n - 1)) or (not ccw(p1, v[i], p2)))
 -> 24
 -> 27
NODE 24: _while: ((len(up) > 1) and ccw(up[(len(up) - 2)], up[(len(up) - 1)], v[i]))
 -> 25
 -> 26
NODE 25: up.pop()
 -> 24
 -> 27
NODE 26: up.append(tuple(v[i]))
 -> 27
NODE 27: _if: ((i == (n - 1)) and (not cw(p1, v[i], p2)))
 -> 21
 -> 28
NODE 28: _while: ((len(down) > 1) and cw(down[(len(down) - 2)], down[(len(down) - 1)], v[i]))
 -> 29
 -> 30
NODE 29: down.pop()
 -> 21
 -> 28
NODE 30: down.append(v[i])
 -> 21
NODE 31: _for: (True if range((len(down) - 2), (- 1), (- 1)) else False)
 -> 32
 -> 34
NODE 32: i = range((len(down) - 2), (- 1), (- 1)).shift()
 -> 33
NODE 33: up.append(tuple(down[i]))
 -> 31
NODE 34: up = set(up)
 -> 35
NODE 35: up = list(up)
 -> 36
NODE 36: return up
 -> 10
NODE 37: enter: isInside(points, query)
 -> 39
NODE 38: exit: isInside(points, query)
NODE 39: points.append(query)
 -> 40
NODE 40: points = convexHull(points)
 -> 41
NODE 41: _for: (True if points else False)
 -> 42
 -> 45
NODE 42: x = points.shift()
 -> 43
NODE 43: _if: (x == query)
 -> 41
 -> 44
NODE 44: return False
 -> 38
NODE 45: return True
 -> 38
NODE 46: n = 7
 -> 47
NODE 47: points = [[1, 1], [2, 1], [3, 1], [4, 1], [4, 2], [4, 3], [4, 4]]
 -> 48
NODE 48: query = [3, 2]
 -> 49
NODE 49: _if: isInside(points, query)
 -> 50
 -> 51
NODE 50: print('YES')
 -> 52
NODE 51: print('NO')
 -> 52
NODE 52: stop
