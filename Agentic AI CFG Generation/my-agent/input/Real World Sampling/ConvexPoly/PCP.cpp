#include <algorithm>
#include <iostream>
#include <utility>
#include <vector>
using namespace std;

bool cmp(pair<int, int>& a, pair<int, int>& b) {
  
    if (a.first == b.first) {
        return a.second < b.second;
    }
    return a.first < b.first;
}
  
int cw(pair<int, int>& a, pair<int, int>& b, pair<int, int>& c) {
  
    int p = a.first * (b.second - c.second) + b.first * (c.second - a.second) + c.first * (a.second - b.second);
  
    return p < 0ll;
}
  

int ccw(pair<int, int>& a, pair<int, int>& b, pair<int, int>& c) {
  
    int p = a.first * (b.second - c.second) + b.first * (c.second - a.second) + c.first * (a.second - b.second);
  
    return p > 0ll;
}

vector<pair<int, int> > convexHull(vector<pair<int, int> >& v) {
    sort(v.begin(), v.end(), cmp);
  
    int n = v.size();
    if (n <= 3)
        return v;
  
    pair<int, int> p1 = v[0];
    pair<int, int> p2 = v[n - 1];
  
    vector<pair<int, int>> up, down;
  
    up.push_back(p1);
    down.push_back(p1);
  
    for (int i = 1; i < n; i++) {
  
        if (i == n - 1 || !ccw(p1, v[i], p2)) {
  
            while (up.size() > 1 && ccw(up[up.size() - 2], up[up.size() - 1], v[i])) {
                up.pop_back();
            }
            up.push_back(v[i]);
        }
  
        if (i == n - 1 || !cw(p1, v[i], p2)) {
            while (down.size() > 1&& cw(down[down.size() - 2], down[down.size() - 1], v[i])) {
  
                down.pop_back();
            }
            down.push_back(v[i]);
        }
    }
  
    for (int i = down.size() - 2;i > 0; i--) {
        up.push_back(down[i]);
    }
  
    up.resize(unique(up.begin(), up.end())- up.begin());

    return up;
}

bool isInside(vector<pair<int, int> > points, pair<int, int> query) {

    points.push_back(query);

    points = convexHull(points);

    for (auto x : points) {
        if (x == query) {
            return false;
        }
    }
    return true;
}
  

int main(){
  
    int n = 7;
    vector<pair<int, int> > points;
  
    points = { { 1, 1 }, { 2, 1 }, { 3, 1 }, { 4, 1 }, { 4, 2 }, { 4, 3 }, { 4, 4 } };
  

    pair<int, int> query = { 3, 2 };
  
    if (isInside(points, query)) {
        cout << "YES" << endl;
    }
    else {
        cout << "NO" << endl;
    }
  
    return 0;
}
