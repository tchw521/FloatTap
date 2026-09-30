#!/usr/bin/env bash
# 懒人点击器 —— 手工构建流水线（不依赖 Gradle / Maven）
# 用法: ./build.sh [版本号] [版本码]
set -euo pipefail

VER_NAME="${1:-1.0.0}"
VER_CODE="${2:-1}"

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-/root/android-sdk}"
PLATFORM="$SDK/platforms/android-34"
BT="$SDK/build-tools/34.0.0"
AAPT2="$BT/aapt2"
D8="$BT/d8"
ZIPALIGN="$BT/zipalign"
APKSIGNER="$BT/apksigner"
ANDROID_JAR="$PLATFORM/android.jar"

BUILD="$ROOT/build"
OUT="$ROOT/out"
KS="$ROOT/lazytap.jks"
PKG="com.lazytap.clicker"

# 签名信息：仓库里带的是开发密钥，正式发布请换成自己的，用环境变量传进来（CI 里走 secrets）
KS_ALIAS="${KS_ALIAS:-lazytap}"
KS_PASS="${KS_PASS:-lazytap}"
KEY_PASS="${KEY_PASS:-lazytap}"

echo "==> 清理"
rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/obj" "$BUILD/dex" "$OUT"

echo "==> aapt2 编译资源"
"$AAPT2" compile --dir "$ROOT/res" -o "$BUILD/res.zip" 2>&1 | tail -3

echo "==> aapt2 链接并生成 R.java"
"$AAPT2" link \
  -I "$ANDROID_JAR" \
  --manifest "$ROOT/AndroidManifest.xml" \
  --java "$BUILD/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code "$VER_CODE" \
  --version-name "$VER_NAME" \
  --auto-add-overlay \
  -A "$ROOT/assets" \
  -o "$BUILD/link.apk" \
  "$BUILD/res.zip" 2>&1 | tail -5

echo "==> javac 编译"
find "$ROOT/src" "$BUILD/gen" -name "*.java" > "$BUILD/sources.txt"
# 编译失败必须立刻停：之前这里挂了 `|| true`，javac 报错也能一路走到打包，
# 产出一个缺类的 APK，装上去点哪崩哪，而且看不出来是编译没过。
if ! javac -nowarn -encoding UTF-8 -source 11 -target 11 -Xlint:-options \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD/obj" @"$BUILD/sources.txt" > "$BUILD/javac.log" 2>&1; then
  grep -v "^注: " "$BUILD/javac.log" | tail -30
  echo "!! javac 编译失败，已中止（不会拿缺类的半成品去打包）" >&2
  exit 1
fi

echo "==> d8 打 dex（开启瘦身）"
"$D8" --lib "$ANDROID_JAR" --min-api 24 \
  --output "$BUILD/dex" \
  $(find "$BUILD/obj" -name "*.class") 2>&1 | tail -5

echo "==> 打包"
cp "$BUILD/link.apk" "$BUILD/unsigned.apk"
cd "$BUILD/dex" && zip -qX -r "$BUILD/unsigned.apk" classes.dex && cd "$ROOT"

echo "==> 对齐"
"$ZIPALIGN" -p -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

if [ ! -f "$KS" ]; then
  echo "==> 没找到签名密钥，临时生成一个（$KS）"
  echo "    注意：自己发布时请换成固定的密钥，否则换一次密钥，老版本就没法覆盖安装了"
  keytool -genkeypair -v -keystore "$KS" -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 \
    -validity 10950 -storepass "$KS_PASS" -keypass "$KEY_PASS" \
    -dname "CN=LazyTap, OU=Dev, O=LazyTap, L=Shenzhen, ST=GD, CN=CN" >/dev/null
fi

echo "==> 签名"
"$APKSIGNER" sign --ks "$KS" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KEY_PASS" \
  --v2-signing-enabled true --v3-signing-enabled true \
  --out "$OUT/LazyTap-v$VER_NAME.apk" "$BUILD/aligned.apk"

# 校验包里的 assets 就是源目录里那份。
# -A 指向的是 $ROOT/assets（源目录），本来就是最新的；这里钉一道，
# 免得以后有人改成先拷贝到 build 再打包，拷漏了还看不出来（前端改了不生效最难查）。
APK="$OUT/LazyTap-v$VER_NAME.apk"
echo "==> 校验 assets"
BAD=0
while IFS= read -r f; do
  rel="${f#$ROOT/}"
  a=$(md5sum "$f" | cut -d' ' -f1)
  b=$(unzip -p "$APK" "$rel" 2>/dev/null | md5sum | cut -d' ' -f1)
  if [ "$a" != "$b" ]; then
    echo "!! $rel 和源目录不一致（包里 $b / 源 $a）" >&2
    BAD=1
  fi
done < <(find "$ROOT/assets" -type f)
if [ "$BAD" != "0" ]; then
  echo "!! assets 校验没过，已中止" >&2
  exit 1
fi

SIZE=$(du -h "$APK" | cut -f1)
echo "==> 完成: $OUT/LazyTap-v$VER_NAME.apk  体积 $SIZE"
"$APKSIGNER" verify --print-certs "$OUT/LazyTap-v$VER_NAME.apk" | head -6
