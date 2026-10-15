# -*- coding: utf-8 -*-
"""Static lint: every CFG key must be referenced as CFG.KEY (catch missing 'CFG.' typos)."""
import os
import re

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "douyin_lite_auto.js")
src = open(PATH, encoding="utf-8").read()
lines = src.split("\n")

block = re.search(r"var CFG = \{(.*?)\n\};", src, re.S).group(1)
keys = re.findall(r"^\s*([A-Z][A-Z0-9_]*)\s*:", block, re.M)
print("CFG 里的键共", len(keys), "个\n")

bad = 0
for k in keys:
    for mo in re.finditer(r"(?<![.\w$])" + k + r"\b", src):
        ln = src[:mo.start()].count("\n") + 1
        line = lines[ln - 1]
        if re.match(r"\s*" + k + r"\s*:", line):     # 定义行
            continue
        bad += 1
        print(f"  [缺少 CFG. 前缀?] line {ln}: {line.strip()[:90]}")

print("\n其他可疑的裸标识符（大写常量样式，且未加 CFG.）:")
pat = re.compile(r"(?<![.\w$])([A-Z][A-Z0-9_]{3,})\b")
known = set(keys) | {"JSON", "RGB", "HSV", "UNKNOWN", "RED", "GOLD", "NONE", "NO_WIDGET",
                     "TIMEOUT", "URL", "ID", "OK", "API"}
extra = 0
for mo in pat.finditer(src):
    name = mo.group(1)
    if name in known:
        continue
    ln = src[:mo.start()].count("\n") + 1
    line = lines[ln - 1]
    if re.match(r"\s*(//|\*|/\*)", line.strip()):
        continue
    if '"' + name in line or name + '"' in line:
        continue          # 字符串里的枚举值
    extra += 1
    print(f"  line {ln}: {name}   {line.strip()[:90]}")

print("\n结论:", "未发现漏写 CFG. 的问题" if bad == 0 else f"发现 {bad} 处漏写 CFG.")
