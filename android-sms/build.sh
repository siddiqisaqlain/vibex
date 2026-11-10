#!/bin/bash
# Builds Vibe X Payments (an .apk) without Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner.
# The website address and key are NOT in this repo. They come from ~/.vibex-sms/<site>.env:
#   URL=https://test.vibexindia.com/api/pay/sms
#   TOKEN=<the PAY_SMS_TOKEN set on that Render service>
# The signing key lives in ~/.vibex-sms/ too: keep it, or later versions can't update the installed app.
# Usage: ./build.sh test   ->  out/vibex-payments-test.apk
set -euo pipefail
SITE="${1:-test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CFG="$HOME/.vibex-sms/$SITE.env"
SDK="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
JAVA_HOME="${JAVA_HOME:-$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home}"; export PATH="$JAVA_HOME/bin:$PATH"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
[ -f "$CFG" ] || { echo "Missing $CFG (URL= and TOKEN=)"; exit 1; }
source "$CFG"
[ -n "${URL:-}" ] && [ -n "${TOKEN:-}" ] || { echo "$CFG needs URL= and TOKEN="; exit 1; }

B="$HERE/build"; rm -rf "$B"; mkdir -p "$B/gen/com/vibexindia/payments" "$B/classes" "$HERE/out"
cat > "$B/gen/com/vibexindia/payments/Config.java" <<JAVA
package com.vibexindia.payments;
final class Config { static final String URL = "$URL"; static final String TOKEN = "$TOKEN"; }
JAVA

"$BT/aapt2" compile --dir "$HERE/res" -o "$B/res.zip"
"$BT/aapt2" link -o "$B/base.apk" -I "$JAR" --manifest "$HERE/AndroidManifest.xml" \
  --min-sdk-version 21 --target-sdk-version 34 --java "$B/gen" "$B/res.zip"
javac -nowarn -source 8 -target 8 -bootclasspath "$JAR" -classpath "$JAR" -d "$B/classes" \
  $(find "$HERE/src" "$B/gen" -name '*.java') 2>&1 | grep -v "bootstrap classpath\|^1 warning\|^warning: \[options\]\|^Note:" || true
"$BT/d8" --min-api 21 --lib "$JAR" --output "$B" $(find "$B/classes" -name '*.class')
(cd "$B" && cp base.apk unsigned.apk && zip -q unsigned.apk classes.dex)
"$BT/zipalign" -f 4 "$B/unsigned.apk" "$B/aligned.apk"

KS="$HOME/.vibex-sms/release.keystore"; PW="$HOME/.vibex-sms/keystore-pass"
if [ ! -f "$KS" ]; then
  umask 077; openssl rand -hex 24 > "$PW"
  keytool -genkeypair -keystore "$KS" -storepass "$(cat "$PW")" -keypass "$(cat "$PW")" -alias vibex \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Vibe X Payments" >/dev/null 2>&1
fi
OUT="$HERE/out/vibex-payments-$SITE.apk"
"$BT/apksigner" sign --ks "$KS" --ks-pass "file:$PW" --ks-key-alias vibex --v4-signing-enabled false --out "$OUT" "$B/aligned.apk"
rm -rf "$B"
echo "Built $OUT"
