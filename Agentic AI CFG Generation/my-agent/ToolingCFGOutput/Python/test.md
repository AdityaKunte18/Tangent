NODES::: 64
EDGES::: 68
NODE 0: start
 -> 63
NODE 1: enter: method001()
 -> 3
NODE 2: exit: method001()
NODE 3: x = 1
 -> 4
NODE 4: y = 2
 -> 5
NODE 5: print((x + y))
 -> 2
NODE 6: enter: method002(x, y)
 -> 8
NODE 7: exit: method002(x, y)
NODE 8: _if: ((x + y) > 0)
 -> 9
 -> 11
NODE 9: print('positive')
 -> 10
NODE 10: return True
 -> 7
NODE 11: print('negative')
 -> 12
NODE 12: return False
 -> 7
NODE 13: enter: method003(x, y)
 -> 15
NODE 14: exit: method003(x, y)
NODE 15: _if: ((x > 0) or (y < 0))
 -> 16
 -> 17
NODE 16: return 'first true'
 -> 14
NODE 17: _if: ((x < 0) and (y > 0))
 -> 18
 -> 19
NODE 18: return 'second true'
 -> 14
NODE 19: return 'both false'
 -> 14
NODE 20: enter: method004(x, y)
 -> 22
NODE 21: exit: method004(x, y)
NODE 22: _if: ((not (x > y)) and (((x + y) < 0) or ((x * y) <= 0)))
 -> 23
 -> 24
NODE 23: return f'The values of x and y are {x} and {y}'
 -> 21
NODE 24: return 'other'
 -> 21
NODE 25: enter: method005(x, y)
 -> 27
NODE 26: exit: method005(x, y)
NODE 27: loopCounter = 0
 -> 28
NODE 28: _for: (True if range(0, y, x) else False)
 -> 29
 -> 31
NODE 29: i = range(0, y, x).shift()
 -> 30
NODE 30: _if: (loopCounter % 5)
 -> 28
NODE 31: return loopCounter
 -> 26
NODE 32: enter: method006(x, y)
 -> 34
NODE 33: exit: method006(x, y)
NODE 34: loopCounter = 0
 -> 35
NODE 35: _if: ((x > 0) and (y > 0))
 -> 36
 -> 38
NODE 36: _while: (loopCounter < (x + y))
 -> 36
 -> 37
 -> 38
NODE 37: return loopCounter
 -> 33
NODE 38: return (- 1)
 -> 33
NODE 39: enter: method007(x, y)
 -> 41
NODE 40: exit: method007(x, y)
NODE 41: loopCounter = 0
 -> 42
NODE 42: _for: (True if range(0, y, 1) else False)
 -> 43
 -> 47
NODE 43: i = range(0, y, 1).shift()
 -> 44
NODE 44: _for: (True if range(x, 0, (- 1)) else False)
 -> 42
 -> 45
NODE 45: j = range(x, 0, (- 1)).shift()
 -> 46
NODE 46: _if: (j == i)
 -> 44
NODE 47: return loopCounter
 -> 40
NODE 48: enter: method008(x, y)
 -> 50
NODE 49: exit: method008(x, y)
NODE 50: loopCounter = 0
 -> 51
NODE 51: other = 0
 -> 52
NODE 52: _while: True
 -> 53
 -> 55
NODE 53: _if: ((loopCounter % x) == other)
 -> 52
 -> 54
NODE 54: break
 -> 55
NODE 55: return loopCounter
 -> 49
NODE 56: enter: method009(x, y)
 -> 58
NODE 57: exit: method009(x, y)
NODE 58: loopCounter = 0
 -> 59
NODE 59: _while: True
 -> 60
 -> 62
NODE 60: _if: ((loopCounter + x) == y)
 -> 59
 -> 61
NODE 61: break
 -> 62
NODE 62: return loopCounter
 -> 57
NODE 63: stop
