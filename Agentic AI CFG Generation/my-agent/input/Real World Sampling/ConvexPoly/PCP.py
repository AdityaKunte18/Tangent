def cw(a, b, c):
    p = a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]);
  
    return p < 0;

def ccw(a, b, c):
    p = a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]);
  
    return p > 0;

def convexHull(v):

    v.sort();
    
  
    n = len(v);
    if (n <= 3):
        return v;
  
    p1 = v[0];
    p2 = v[n - 1];
  
  
    up = []
    down = [];

    up.append(tuple(p1));
    down.append(p1);

    for i in range(1, n):
        
        if i == n - 1 or (not ccw(p1, v[i], p2)):

            while len(up) > 1 and ccw(up[len(up) - 2], up[len(up) - 1], v[i]): 
                up.pop();
            
  
            up.append(tuple(v[i]));
        
  
        if i == n - 1 and  (not cw(p1, v[i], p2)): 
  
            while (len(down) > 1) and cw(down[len(down) - 2], down[len(down) - 1], v[i]):
                down.pop();
            
            down.append(v[i]);
        
    for i in range(len(down) - 2, -1, -1):
        up.append(tuple(down[i]));
  
    up = set(up)
    up = list(up)
  
    return up;

def isInside( points, query):
    points.append(query);
  
    points = convexHull(points);
  
    for x in points: 
        if x == query:
            return False;
    
    return True;


n = 7;
points = [[1, 1 ], [2, 1 ], [ 3, 1 ], [ 4, 1 ], [ 4, 2 ], [4, 3 ], [ 4, 4 ]];
  
query = [ 3, 2 ];
  
if (isInside(points, query)) :
    print("YES");
    
else :
    print("NO");
    