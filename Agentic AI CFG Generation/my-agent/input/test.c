void basic () {
    int x = 1;
    int y = 2;
    printf(x + y);
}

int decrement(int start_number, int times) {
    int value = start_number;

    for (int i = 0; i < times; i++) {
        value--;
    }

    return value;
}

int conditional1(int x, int y) {
    if (x + y > 0) {
        printf("positive");
        return 1;
    }
    printf("negative");
    return 0;
}

void conditional2(int x, int y) {
    if (x > 0 || y < 0) {
        printf("first true");
        return;
    } else if (x < 0 && y > 0) {
        printf("second true");
        return;
    }
    printf("both false");
    return;
}