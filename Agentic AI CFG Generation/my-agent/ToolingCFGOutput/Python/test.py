def method001():
    x = 1
    y = 2
    print(x + y)

def method002(x, y):
    if x + y > 0:
        print("positive")
        return True
    print("negative")
    return False

def method003(x, y):
    if x > 0 or y < 0:
        return "first true"
    elif x < 0 and y > 0:
        return "second true"
    return "both false"

def method004(x, y):
    if not (x > y) and (x + y < 0 or x * y <= 0):
        return f"The values of x and y are {x} and {y}"
    return "other"

def method005(x, y):
    loopCounter = 0
    for i in range(0, y, x):
        loopCounter += 1
        if (loopCounter % 5):
            loopCounter += 2

    return loopCounter

def method006(x, y):
    loopCounter = 0
    if x > 0 and y > 0:
        while (loopCounter < (x + y)):
            loopCounter += 1
        return loopCounter
    
    return -1

def method007(x, y):
    loopCounter = 0
    for i in range(0, y, 1):
        for j in range(x, 0, -1):
            if (j == i):
                loopCounter += 2
            else:
                loopCounter += 3

    return loopCounter

def method008(x, y):
    loopCounter = 0
    other = 0
    while True:
        loopCounter += 1
        other += (loopCounter + y)
        if loopCounter % x == other:
            break
    return loopCounter

def method009(x, y):
    loopCounter = 0
    while True:
        loopCounter += 1
        if (loopCounter + x == y):
            break
    return loopCounter
     