# -*- coding: utf-8 -*-
"""Strict check: strip comments/strings, then verify the CODE region is pure ASCII ES5."""
import os
import re

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "douyin_lite_auto.js")
text = open(PATH, "rb").read().decode("utf-8")

out, i, n, state = [], 0, len(text), "code"
while i < n:
    ch = text[i]
    nxt = text[i + 1] if i + 1 < n else ""
    if state == "code":
        if ch == "/" and nxt == "/":
            state = "line"; out.append("  ")
        elif ch == "/" and nxt == "*":
            state = "block"; out.append("  ")
        elif ch == '"':
            state = "dq"; out.append(" ")
        elif ch == "'":
            state = "sq"; out.append(" ")
        else:
            out.append(ch)
    elif state == "line":
        if ch == "\n":
            state = "code"; out.append("\n")
    elif state == "block":
        if ch == "*" and nxt == "/":
            state = "code"; out.append("  ")
        elif ch == "\n":
            out.append("\n")
    else:  # string
        if ch == "\\":
            out.append(" "); i += 1
            if i < n:
                out.append(" " if text[i] != "\n" else "\n")
            i += 1
            continue
        if (state == "dq" and ch == '"') or (state == "sq" and ch == "'"):
            state = "code"; out.append(" ")
        elif ch == "\n":
            state = "code"; out.append("\n")
    i += 1

code = "".join(out)
non_ascii = [(ln, c) for ln, line in enumerate(code.split("\n"), 1) for c in line if ord(c) > 127]
print("代码区非 ASCII 字符数:", len(non_ascii), non_ascii[:10])

checks = {
    "const/let 声明": re.findall(r"\b(?:const|let)\s+[A-Za-z_$]", code),
    "箭头函数 =>": re.findall(r"=>", code),
    "模板字符串": re.findall(r"`", code),
    "展开 ...": re.findall(r"\.\.\.", code),
    "Uint8Array": re.findall(r"Uint8Array", code),
    'ui 指令': re.findall(r'"ui"', code),
    "尾随逗号": re.findall(r",\s*[\]}]", code),
    "for..of": re.findall(r"for\s*\([^)]*\bof\b", code),
    "解构声明": re.findall(r"(?:var|const|let)\s*[\[{]", code),
    "class/import/export": re.findall(r"\b(?:class|import|export)\b", code),
    "async/await": re.findall(r"\b(?:async|await)\b", code),
    "可选链/空值合并": re.findall(r"\?\.|\?\?", code),
}
print("\n代码区 ES6+ 构造体检:")
bad = 0
for k, v in checks.items():
    flag = "" if not v else "   <== 需处理"
    if v:
        bad += 1
    print(f"  {k:22s} {len(v)}{flag}")

print("\n结论:", "代码区 = 纯 ASCII + 严格 ES5，Rhino 可解析" if (not non_ascii and bad == 0) else "仍有残留，需处理")
