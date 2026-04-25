import java.util.ArrayList;

public class DFS {
    static void dfsRecursive(ArrayList<ArrayList<Integer>> adj, boolean[] visted, int s, ArrayList<Integer> res) {
        visted[s] = true;
        res.add(s);

        for (int i : adj.get(s)) {
            if (!visted[i]) {
                dfsRecursive(adj, visted, i, res);
            }
        }
    }

    static ArrayList<Integer>dfs(ArrayList<ArrayList<Integer>> adj) {
        boolean[] visited = new boolean[adj.size()];
        ArrayList<Integer> res = new ArrayList<>();
        dfsRecursive(adj, visited, 0, res);
        return res;
    }

    static addEdge(ArrayList<ArrayList<Integer>> adj, int u, int v) {
        adj.get(u).add(v);
        adj.get(v).add(u);
    }

    public static void main(String[] args) {
        int V = 5;
        ArrayList<ArrayList<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < V; i++) {
            adj.add(new ArrayList<>());
        }

        addEdge(adj, 1, 2);
        addEdge(adj, 1, 0);
        addEdge(adj, 2, 0);
        addEdge(adj, 2, 3);
        addEdge(adj, 2, 4);

        ArrayList<Integer> res = dfs(adj);
        for (int i = 0; i < res.size(); i++) {
            System.out.print(res.get(i) + " ");
        }
    }
}
