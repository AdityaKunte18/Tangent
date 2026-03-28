import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class PCP {
    static boolean cw(int[] a, int[] b, int[] c) {
        int p = a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1])
                + c[0] * (a[1] - b[1]);

        return p < 0;
    }

    static boolean ccw(int[] a, int[] b, int[] c) {
        int p = a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1])
                + c[0] * (a[1] - b[1]);

        return p > 0;
    }

    static int[][] convexHull(int[][] v) {
        Arrays.sort(v, (a, b) -> a[0] - b[0]);

        int n = v.length;
        if (n <= 3) {
            return v;
        }

        int[] p1 = v[0];
        int[] p2 = v[n - 1];

        List<int[]> up = new ArrayList<int[]>();
        List<int[]> down = new ArrayList<int[]>();

        up.add(p1);
        down.add(p1);

        for (int i = 1; i < n; i++) {
            if (i == n - 1 || !ccw(p1, v[i], p2)) {
                while (up.size() > 1
                       && ccw(up.get(up.size() - 2),
                              up.get(up.size() - 1),
                              v[i])) {
                    up.remove(up.size() - 1);
                }

                up.add(v[i]);
            }

            if (i == n - 1 || !cw(p1, v[i], p2)) {
                while (down.size() > 1
                       && cw(down.get(down.size() - 2),
                             down.get(down.size() - 1),
                             v[i])) {
                    down.remove(down.size() - 1);
                }

                down.add(v[i]);
            }
        }

        for (int i = down.size() - 2; i >= 0; i--) {
            up.add(down.get(i));
        }

        return up.toArray(new int[0][]);
    }


    static boolean isInside(int[][] points, int[] query) {
        int[][] points1 = new int[points.length + 1][];
        for (int i = 0; i < points.length; i++)
            points1[i] = points[i];
        points1[points.length] = query;

        points = convexHull(points);

        for (int[] x : points) {
            if (Arrays.equals(x, query))
                return false;
        }

        return true;
    }

    public static void main(String[] args){
        int n = 7;
        int[][] points
            = { new int[] { 1, 1 }, new int[] { 2, 1 },
                new int[] { 3, 1 }, new int[] { 4, 1 },
                new int[] { 4, 2 }, new int[] { 4, 3 },
                new int[] { 4, 4 } };
                
        int[] query = { 3, 2 };

        if (isInside(points, query)) {
            System.out.println("YES");
        }
        else {
            System.out.println("NO");
        }
    }
}