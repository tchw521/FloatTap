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
for f in Expr Vars Share LogLine HotKey Timing NodeMatch RunState SubCall RunSlot Bus RunnerPool LogStore Match GlobalVars Locks Rnd; do
  sed 's/^package com\.lazytap\.clicker;//' "$SRC/$f.java" > "$OUT/$f.java"
done

echo "==> 表达式求值器（ExprTest）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" "$OUT/Expr.java" "$OUT/Vars.java" "$OUT/GlobalVars.java" ExprTest.java
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

echo "==> 运行日志（L + 真实 LogLine）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" "$OUT/LogLine.java" "$OUT/RunSlot.java" L.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" L | tail -2

echo "==> 音量键急停（K + 真实 HotKey）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" "$OUT/HotKey.java" K.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" K | tail -2

echo "==> 运行三态（R + 真实 RunState，含真线程的挂起/唤醒）"
javac -nowarn -encoding UTF-8 -d "$OUT" "$OUT/RunState.java" R.java
java -Dfile.encoding=UTF-8 -cp "$OUT" R | tail -2

echo "==> 运行会话与多播（SlotTest + 真实 RunSlot/Bus/LogLine）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" "$OUT/RunSlot.java" "$OUT/Bus.java" "$OUT/LogLine.java" SlotTest.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" SlotTest | tail -2

echo "==> 运行会话池（PoolTest + 真实 RunnerPool/LogStore/RunSlot/Bus/LogLine）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" "$OUT/RunnerPool.java" "$OUT/LogStore.java" "$OUT/RunSlot.java" "$OUT/Bus.java" "$OUT/LogLine.java" PoolTest.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" PoolTest | tail -2

echo "==> 模板匹配（MatchTest + 真实 Match，零 Android 依赖）"
javac -nowarn -encoding UTF-8 -d "$OUT" "$OUT/Match.java" MatchTest.java
java -Dfile.encoding=UTF-8 -cp "$OUT" MatchTest | tail -2

echo "==> 共享变量表（GlobalVarsTest + 真实 GlobalVars）"
javac -nowarn -encoding UTF-8 -d "$OUT" "$OUT/GlobalVars.java" GlobalVarsTest.java
java -Dfile.encoding=UTF-8 -cp "$OUT" GlobalVarsTest | tail -2

echo "==> 互斥锁（LocksTest + 真实 Locks，含真线程竞争）"
javac -nowarn -encoding UTF-8 -d "$OUT" "$OUT/Locks.java" LocksTest.java
java -Dfile.encoding=UTF-8 -cp "$OUT" LocksTest | tail -2

echo "==> 子脚本调用（SuTest + 真实 SubCall）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" "$OUT/SubCall.java" SuTest.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" SuTest | tail -2

echo "==> 等待与超时（W + 真实 Timing）"
javac -nowarn -encoding UTF-8 -cp "$OUT:$CP" -d "$OUT" "$OUT/Timing.java" W.java
java -Dfile.encoding=UTF-8 -cp "$OUT:$CP" W | tail -2

echo "==> 防检测随机（RndT + 真实 Rnd，采样验证边界）"
javac -nowarn -encoding UTF-8 -d "$OUT" "$OUT/Rnd.java" RndT.java
java -Dfile.encoding=UTF-8 -cp "$OUT" RndT | tail -2

echo "==> 节点匹配（N + 真实 NodeMatch）"
# NodeMatch 连 org.json 都不碰，所以这步不用挂 json.jar
javac -nowarn -encoding UTF-8 -d "$OUT" "$OUT/NodeMatch.java" N.java
java -Dfile.encoding=UTF-8 -cp "$OUT" N | tail -2

# 字段对账直接读 app.js 和 ScriptRunner.java 两份源文件，不编译真源码。
# 失败时要能看到具体是哪个字段，所以不 tail。
echo "==> 字段对账（表单 vs 引擎）"
javac -nowarn -encoding UTF-8 -d "$OUT" F.java
java -Dfile.encoding=UTF-8 -cp "$OUT" F "$PROJ"

echo
echo "==> 单测全部通过"
