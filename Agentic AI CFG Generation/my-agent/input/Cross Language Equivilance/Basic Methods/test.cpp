#include <iostream>
#include <string>
#include <format>

using namespace std;


void method001() {
    int x = 1;
    int y = 2;
    cout << x + y << endl;
}

int method002(int x, int y) {
    if (x + y > 0) {
        cout << "positive" << endl;
        return 1;
    }
    cout << "negative" << endl;
    return 0;
}

string method003(int x, int y) {
    if (x > 0 || y < 0) {
        return "first true";
    } else if (x < 0 && y > 0) {
        return "second true";
    }
    return "both false";
}

string method004(int x, int y) {
    if (!(x > y) && (x + y < 0 || x*y <= 0)) {
        return format("The values of x and y are {} and {}\n", x, y);
    }
    return "other";
}

int method005(int x, int y) {
    int loopCounter = 0;
    for (int i = 0; i < y; i += x) {
        loopCounter++;
        if (loopCounter % 5) {
            loopCounter += 2;
        }
    }
    return loopCounter;
}

int method006(int x, int y) {
    int loopCounter = 0;
    if (x > 0 && y > 0) {
        while (loopCounter < (x + y)) {
            loopCounter++;
        }
        return loopCounter;
    }
    return -1;
}

int method007(int x, int y) {
    int loopCounter = 0;
    for (int i = 0; i < y; i ++) {
        for (int j = x; j >= 0; j --) {
            if (j == i) {
                loopCounter += 2;
            } else {
                loopCounter += 3;
            }
        }
    }
    return loopCounter;
}

int method008(int x, int y) {
    int loopCounter = 0;
    int other = 0;
    do {
        loopCounter ++;
        other += (loopCounter + y);
    } while (loopCounter % x == other);
    return loopCounter;
}

int method009(int x, int y) {
    int loopCounter = 0;
    while (true) {
        loopCounter++;
        if (loopCounter + x == y) {
            break;
        }
    }
    return loopCounter;
}