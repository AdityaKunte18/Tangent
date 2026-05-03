public class test {
    public static void method001() {
        int x = 1;
        int y = 2;

        System.out.println(x + y);
    }

    public static boolean method002(int x, int y) {
        if (x + y > 0) {
            System.out.println("positive");
            return true;
        }
        System.out.println("negative");
        return false;
    }

    public static String method003(int x, int y) {
        if (x > 0 || y < 0) {
            return "first true";
        } else if (x < 0 && y > 0) {
            return "second true";
        }
        return "both false";
    }

    public static String method004(int x, int y) {
        if (!(x > y) && (x + y < 0 || x * y <=0)) {
            return "The values of x and y are " + x + " and " + y + "\n"; // return f"The values of x and y are {x} and {y}\n";
        }
        return "other";
    }

    public static int method005(int x, int y) {
        int loopCounter = 0;
        for (int i = 0; i < y; i += x) {
            loopCounter++;
            if (loopCounter % 5 != 0) {
                loopCounter += 2;
            }
        }
        return loopCounter;
    }

    public static int method006(int x, int y) {
        int loopCounter = 0;
        if (x > 0 && y > 0) {
            while (loopCounter < (x + y)) {
                loopCounter ++;
            }
            return loopCounter;
        }
        return -1;
    }

    public static int method007(int x, int y) {
        int loopCounter = 0;
        for (int i = 0; i < y; i++) {
            for (int j = x; j >= 0; j--) {
                if (j == i) {
                    loopCounter += 2;
                } else {
                    loopCounter += 3;
                }
            }
        }
        return loopCounter;
    }

    public static int method008(int x, int y) {
        int loopCounter = 0;
        int other = 0;
        do {
            loopCounter++;
            other += (loopCounter + y);
        } while (loopCounter % x == other);
        return loopCounter;
    }

    public static int method009(int x, int y) {
        int loopCounter = 0;
        while (true) {
            loopCounter++;
            if (loopCounter + x == y) {
                break;
            }
        }
        return loopCounter;
    }
}
