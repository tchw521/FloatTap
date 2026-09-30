#!/usr/bin/env bash
# 纯 Java 单测：只要装了 JDK 就能跑，不需要 Android SDK、不需要模拟器、不联网。
#
# 尽量测仓库里的真源码而不是副本：Expr / Vars / Share 都是从 src 剥掉 package 后直接编译来测的
# （剥 package 只是为了和默认包里的测试类一起编，不改源文件）。
# 例外：C.java（条件系统）和 EngineTest.java（引擎主循环）是把逻辑搬过来仿真的，
# 因为 ScriptRunner 依赖 AccessibilityService / Bitmap，JDK 下编不了 —— 这两个文件头都写了
# 「改 ScriptRunner 时要同步改这里」。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$ROOT/../.." && pwd)"
SRC="$PROJ/src/com/lazytap/clicker"
OUT="$ROOT/out"
CP="json.jar"

cd "$ROOT"
rm -rf "$OUT"
mkdir -p "$OUT"

# 把要测的源码剥掉 package 放到 out/ 下，测的是真代码
for f in Expr Vars Share; do
  sed 's/^package com\.lazytap\.clicker;//' "$SRC/$f.java" > "$OUT/$f.java"
done

echo "==> 表达式求值器（ExprTest）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" "$OUT/Expr.java" "$OUT/Vars.java" ExprTest.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" ExprTest | tail -2

echo "==> 变量插值（VarsTest）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" VarsTest.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" VarsTest | tail -2

echo "==> 引擎主循环仿真（EngineTest）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" EngineTest.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" EngineTest | tail -2

echo "==> 条件系统（C）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" C.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" C | tail -2

echo "==> 动作分组（G）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" G.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" G | tail -2

echo "==> 分享码（S + 真实 Share）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" "$OUT/Share.java" S.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" S | tail -2

echo
echo "==> 单测全部通过"
