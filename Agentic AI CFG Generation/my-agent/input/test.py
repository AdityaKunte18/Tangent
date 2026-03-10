def basic ():
   x = 1
   y = 2
   print(x + y)

def decrement(start_number: int, times: int) -> int:
    value = start_number
    for i in range(times):
      value = value - 1
    
    return value

def conditional1(x: int, y: int) -> bool:
   if (x + y > 0):
      print("positive")
      return True
   print("negative")
   return False

def conditional2(x: int, y: int):
   if (x > 0 or y < 0):
      print("first true")
      return
   elif (x < 0 and y > 0):
      print("second true")
      return
   
   print("both false")
   return