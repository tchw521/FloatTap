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
javac -nowarn -encoding UTF-8 -source 11 -target 11 -Xlint:-options \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD/obj" @"$BUILD/sources.txt" 2>&1 | grep -v "^注: " | tail -25 || true

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
  echo "==> 生成签名密钥"
  keytool -genkeypair -v -keystore "$KS" -alias lazytap -keyalg RSA -keysize 2048 \
    -validity 10950 -storepass lazytap -keypass lazytap \
    -dname "CN=LazyTap, OU=Dev, O=LazyTap, L=Shenzhen, ST=GD, CN=CN" >/dev/null
fi

echo "==> 签名"
"$APKSIGNER" sign --ks "$KS" --ks-key-alias lazytap \
  --ks-pass pass:lazytap --key-pass pass:lazytap \
  --v2-signing-enabled true --v3-signing-enabled true \
  --out "$OUT/LazyTap-v$VER_NAME.apk" "$BUILD/aligned.apk"

SIZE=$(du -h "$OUT/LazyTap-v$VER_NAME.apk" | cut -f1)
echo "==> 完成: $OUT/LazyTap-v$VER_NAME.apk  体积 $SIZE"
"$APKSIGNER" verify --print-certs "$OUT/LazyTap-v$VER_NAME.apk" | head -6
