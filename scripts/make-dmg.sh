#!/usr/bin/env bash
# 把 pack.js 产出的 macOS zip 转成「拖进 Applications」安装的 DMG。
# 只能在 macOS 上运行：hdiutil / HFS+ 才能保留 .app 的符号链接与可执行位。
#
#   bash scripts/make-dmg.sh arm64     → dist/FloatingTeleprompter-mac-arm64.dmg
#   bash scripts/make-dmg.sh x64       → dist/FloatingTeleprompter-mac-x64.dmg
#
# 生成后会重新挂载 DMG 自检：Applications 快捷方式、主二进制可执行位、
# Frameworks 符号链接、updater.js 与使用说明都在，再卸载。
set -euo pipefail

ARCH="${1:-arm64}"
case "$ARCH" in
  arm64|x64) ;;
  *) echo "用法: bash scripts/make-dmg.sh <arm64|x64>" >&2; exit 2 ;;
esac
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "只能在 macOS 上生成 DMG（Windows 会破坏 .app 的符号链接与可执行位）" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="飓风提词器"
ZIP="$ROOT/dist/FloatingTeleprompter-mac-$ARCH.zip"
OUT="$ROOT/dist/FloatingTeleprompter-mac-$ARCH.dmg"
# 卷名用英文：部分旧版 Finder 对中文卷名显示不稳定，Release 附件也用英文名
VOLNAME="Floating Teleprompter"

[[ -s "$ZIP" ]] || { echo "缺少 $ZIP，请先运行 pack.js --platform darwin --arch $ARCH" >&2; exit 1; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/tp-dmg.XXXXXX")"
cleanup() {
  if [[ -d "$STAGE/mnt" ]] && hdiutil info 2>/dev/null | grep -Fq "$STAGE/mnt"; then
    hdiutil detach "$STAGE/mnt" -force >/dev/null 2>&1 || true
  fi
  rm -rf "$STAGE"
}
trap cleanup EXIT

# 从已经过校验的 zip 解出内容，保证 DMG 与 zip 是同一份 .app
mkdir -p "$STAGE/unzipped" "$STAGE/root"
unzip -q "$ZIP" -d "$STAGE/unzipped"
SRC="$(find "$STAGE/unzipped" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -d "$SRC/$NAME.app" ]] || { echo "FAIL: zip 里找不到 $NAME.app" >&2; exit 1; }

# 内容直接放到 DMG 根目录，用户打开就能看见 .app 和 Applications 快捷方式
mv "$SRC"/* "$STAGE/root/"
rm -rf "$STAGE/root/data"                    # 只读 DMG 里不需要空 data 占位
find "$STAGE/root" -name '.DS_Store' -delete
ln -s /Applications "$STAGE/root/Applications"

hdiutil create -volname "$VOLNAME" -srcfolder "$STAGE/root" -ov -format UDZO "$OUT" >/dev/null

# 挂回来验证：DMG 里所有 Unix 元数据必须还活着
mkdir -p "$STAGE/mnt"
hdiutil attach "$OUT" -readonly -nobrowse -mountpoint "$STAGE/mnt" >/dev/null
APP="$STAGE/mnt/$NAME.app"
[[ -L "$STAGE/mnt/Applications" ]]              || { echo "FAIL: Applications 快捷方式丢失" >&2; exit 1; }
[[ -x "$APP/Contents/MacOS/$NAME" ]]            || { echo "FAIL: 主二进制丢失可执行位" >&2; exit 1; }
[[ -f "$APP/Contents/Resources/app/updater.js" ]] || { echo "FAIL: 缺 updater.js" >&2; exit 1; }
[[ -f "$APP/Contents/Resources/app/main.js" ]]  || { echo "FAIL: 缺 main.js" >&2; exit 1; }
[[ -f "$STAGE/mnt/使用说明.txt" ]]                || { echo "FAIL: 缺使用说明.txt" >&2; exit 1; }
LINKS="$(find "$APP/Contents/Frameworks" -type l | wc -l | tr -d ' ')"
[[ "$LINKS" -gt 0 ]]                            || { echo "FAIL: Frameworks 符号链接丢失 ($LINKS)" >&2; exit 1; }
# 签名必须能穿过「zip → 解压 → hdiutil 打包 → 只读挂载」整条链路活下来。
# 缺了 CodeResources 就会在用户机器上被 Gatekeeper 判成「已损坏」。
[[ -f "$APP/Contents/_CodeSignature/CodeResources" ]] || { echo "FAIL: DMG 里签名封印资源丢失" >&2; exit 1; }
codesign --verify --deep "$APP" >/dev/null 2>&1  || { echo "FAIL: DMG 里 .app 签名无效" >&2; exit 1; }
hdiutil detach "$STAGE/mnt" >/dev/null

echo "DMG_OK | $OUT | symlinks=$LINKS | adhoc_signature=valid | $(du -h "$OUT" | cut -f1)"
shasum -a 256 "$OUT"
