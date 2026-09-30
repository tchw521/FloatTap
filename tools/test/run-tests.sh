#!/usr/bin/env bash
# 纯 Java 单测：只要装了 JDK 就能跑，不需要 Android SDK、不需要模拟器、不联网。
#
#   C.java —— 条件判断的语义（and/or/count、重复检查、参数夹取、停止中断）
#             注意：它把 ScriptRunner 的条件逻辑原样搬了一份，改 ScriptRunner#execCond /
#             checkCond / oneCond 之后，记得同步改这里。
#   S.java —— 分享码编解码（直接调 src 里的 Share.java，是真代码不是拷贝）
#
# org.json 在 android.jar 里只是空壳（跑起来抛 Stub!），所以带了一份真的实现：json.jar。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$ROOT/../.." && pwd)"
OUT="$ROOT/out"

cd "$ROOT"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> 条件系统语义（C.java）"
javac -nowarn -encoding UTF-8 -cp json.jar -d "$OUT" C.java
java -Dfile.encoding=UTF-8 -cp "$OUT:json.jar" C | tail -3

echo "==> 分享码编解码（S.java + 真实 Share.java）"
# Share.java 带 package 声明，剥掉才能和默认包里的测试类一起编（不改源文件，只改副本）
sed 's/^package com\.lazytap\.clicker;//' \
  "$PROJ/src/com/lazytap/clicker/Share.java" > "$OUT/Share.java"
javac -nowarn -encoding UTF-8 -cp json.jar -d "$OUT" "$OUT/Share.java" S.java
java -Dfile.encoding=UTF-8 -cp "$OUT:json.jar" S | tail -3

echo "==> 单测全部通过"
