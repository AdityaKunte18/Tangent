NODES::: 35
EDGES::: 36
NODE 0: start
 -> 19
NODE 1: enter: dfsRec(adj, visited, s, res)
 -> 3
NODE 2: exit: dfsRec(adj, visited, s, res)
NODE 3: visited[s] = True
 -> 4
NODE 4: res.append(s)
 -> 5
NODE 5: _for: (True if adj[s] else False)
 -> 2
 -> 6
NODE 6: i = adj[s].shift()
 -> 7
NODE 7: _if: (not visited[i])
 -> 5
 -> 8
NODE 8: dfsRec(adj, visited, i, res)
 -> 5
NODE 9: enter: dfs(adj)
 -> 11
NODE 10: exit: dfs(adj)
NODE 11: visited = ([False] * len(adj))
 -> 12
NODE 12: res = []
 -> 13
NODE 13: dfsRec(adj, visited, 0, res)
 -> 14
NODE 14: return res
 -> 10
NODE 15: enter: addEdge(adj, u, v)
 -> 17
NODE 16: exit: addEdge(adj, u, v)
NODE 17: adj[u].append(v)
 -> 18
NODE 18: adj[v].append(u)
 -> 16
NODE 19: _if: (__name__ == '__main__')
 -> 20
 -> 34
NODE 20: V = 5
 -> 21
NODE 21: adj = []
 -> 22
NODE 22: _for: (True if range(V) else False)
 -> 23
 -> 25
NODE 23: i = range(V).shift()
 -> 24
NODE 24: adj.append([])
 -> 22
NODE 25: addEdge(adj, 1, 2)
 -> 26
NODE 26: addEdge(adj, 1, 0)
 -> 27
NODE 27: addEdge(adj, 2, 0)
 -> 28
NODE 28: addEdge(adj, 2, 3)
 -> 29
NODE 29: addEdge(adj, 2, 4)
 -> 30
NODE 30: res = dfs(adj)
 -> 31
NODE 31: _for: (True if res else False)
 -> 32
 -> 34
NODE 32: node = res.shift()
 -> 33
NODE 33: print(node, end=' ')
 -> 31
NODE 34: stop
