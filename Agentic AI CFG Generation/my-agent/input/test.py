import json
import pandas as pd
import os
import matplotlib.pyplot as plt
import ast
import re
import shlex
from pathlib import Path

def count_tool_use(model_name: str, instance_id: str) -> dict: # This cannot be changed
  model_directory = model_name.replace("_", "-").replace("gpt5", "gpt-5")
  # model_directory = model_name.replace("_", "-").replace("deepseek_v3", "deepseek-v3")
  if "gpt-5" in model_directory:
    new_model_directory = "gpt-5-mini"
  else:
    new_model_directory = "deepseek-v3"

  model_directory = new_model_directory

  BASE_DIR = os.path.dirname(os.path.abspath(__file__))
  path = os.path.join(BASE_DIR, "..", "Trajectories", model_directory, f"{instance_id.strip()}.traj")

  with open(path, "r") as file:
    read_file = file.read()

  data = json.loads(read_file, strict = False)

  steps = data["trajectory"]

  counts = {
    "view": 0,
    "create": 0,
    "str_replace": 0,
    "insert": 0,
    "undo_edit": 0
  }

  for step in steps:
    action = step["action"].strip()
    tokens = action.split()
    if (len(tokens) < 2):
      continue
    command = tokens[1]
    if command in counts.keys():
      counts[command] += 1
  

  return counts

def write_count_tool_use_to_file():
  dataframe = pd.read_csv("CS527_MP.csv")
  results = {}

  for _, row in dataframe.iterrows():
    model = row["model"]
    mapping = {
      "gpt5_mini": "gpt-5-mini",
      "deepseek_v3": "deepseek-v3"
    }
    model = mapping[model]
    instance_id = row["instance"]

    counts = count_tool_use(model, instance_id)
    if model not in results:
      results[model] = {}

    results[model][instance_id] = counts

  with open("count_tool_use.json", "w") as file:
    json.dump(results, file, indent= 2)