public class test {
    public static void basic() {
        int x = 1;
        int y = 2;
        System.out.println(x + y);
    }

    public static int decrement(int start_number, int times) {
        int value = start_number;
        for (int i = 0; i < times; i++) {
            value--;
        }
        return value;
    }

    public static boolean conditional1(int x, int y) {
        if (x + y > 0) {
            System.out.println("positive");
            return true;
        }
        System.out.println("negative");
        return false;
    }

    public static void conditional2(int x, int y) {
        if (x > 0 || y < 0) {
            System.out.println("first true");
            return;
        } else if (x < 0 && y > 0) {
            System.out.println("second true");
            return;
        }
        System.out.println("both false");
        return;
    }

}