#!/usr/bin/env bash
# 从 CHANGELOG.md 抽取每版说明，为 out/ 下的每个版本 APK 建 GitHub Release。
#
# 用法：
#   GH_TOKEN=<PAT> bash tools/release-gh.sh              # 全部版本（sort -V 顺序，最后一个标 latest）
#   GH_TOKEN=<PAT> bash tools/release-gh.sh 3.0.0        # 只发指定版本
#
# 说明：
#   - Release 正文 = CHANGELOG 该版本的一句话简介 + 「### 新增」段 + 下载链接；
#     早期版本（v1.3.0 及以前）没有分节，退化为整段正文（截 1500 字）。
#   - 优先把 APK 作为 Release 附件上传（正常网络下自动生效）；上传不可达时
#     退化为「不带附件创建 + 正文里给仓库 raw 直链」，保证每版都有可下载入口。
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="tchw521/FloatTap"
BRANCH="master"
NOTES_DIR="$(mktemp -d)"

# ---------- 1. 抽取每版 Release 正文 ----------
python3 - "$NOTES_DIR" "$REPO" "$BRANCH" <<'PY'
import re, os, sys
out, repo, branch = sys.argv[1], sys.argv[2], sys.argv[3]
src = open('CHANGELOG.md', encoding='utf-8').read()
blocks = re.split(r'^## ', src, flags=re.M)
n = 0
for b in blocks[1:]:
    head = b.split('\n', 1)[0]
    m = re.match(r'v(\d+\.\d+\.\d+)', head)
    if not m:
        continue
    ver = m.group(1)
    body = b.split('\n', 1)[1] if '\n' in b else ''
    intro = ''
    for line in body.split('\n'):
        if line.startswith('**'):
            intro = line.strip('*').strip()
            break
    adds = ''
    mm = re.search(r'^### 新增[^\n]*\n(.*?)(?=^### |\Z)', body, flags=re.M | re.S)
    if mm:
        adds = mm.group(1).strip()
    notes = ''
    if intro:
        notes += intro + '\n\n'
    if adds:
        notes += '### 新增\n\n' + adds + '\n'
    else:
        rest = body.replace(intro, '', 1).strip() if intro else body.strip()
        notes += rest[:1500]
    apk = 'out/LazyTap-v%s.apk' % ver
    size = os.path.getsize(apk) if os.path.exists(apk) else 0
    notes += '\n\n## 下载安装\n\n'
    if size:
        notes += '- [%s](https://github.com/%s/raw/%s/%s)（%s，已用 lazytap.jks 签名，可直接安装）\n' % (
            os.path.basename(apk), repo, branch, apk, '{:,}'.format(size).replace(',', ' ') + ' 字节')
    notes += '- 全部版本打包：[out/LazyTap-全部版本.zip](https://github.com/%s/raw/%s/out/LazyTap-全部版本.zip)\n' % (repo, branch)
    notes += '\n---\n完整更新日志见仓库 `CHANGELOG.md`。低版本覆盖安装到高版本会被系统拒绝，需卸载重装。'
    open(os.path.join(out, 'v%s.md' % ver), 'w', encoding='utf-8').write(notes)
    n += 1
print('抽取 Release 正文：%d 个版本' % n)
PY

# ---------- 2. 逐个建 Release ----------
if [ $# -gt 0 ]; then
  VERSIONS=("$@")
else
  # shellcheck disable=SC2207
  VERSIONS=($(ls out/LazyTap-v*.apk 2>/dev/null | sed -E 's#out/LazyTap-v(.*)\.apk#\1#' | sort -V))
fi
LAST="${VERSIONS[${#VERSIONS[@]}-1]}"

for v in "${VERSIONS[@]}"; do
  apk="out/LazyTap-v$v.apk"
  if [ ! -f "$apk" ]; then echo "⏭  跳过 v$v（无 APK）"; continue; fi
  nf="$NOTES_DIR/v$v.md"
  [ -f "$nf" ] || echo "# v$v" > "$nf"
  latest=()
  [ "$v" = "$LAST" ] && latest=(--latest)

  # 先试「带附件」；附件上传不可达时再退化为「不带附件 + 正文直链」
  if gh release create "v$v" "$apk" --repo "$REPO" --title "v$v" --notes-file "$nf" "${latest[@]}" > /dev/null 2>&1; then
    echo "✅ v$v 已发布（含 APK 附件）"
  elif gh release create "v$v" --repo "$REPO" --title "v$v" --notes-file "$nf" "${latest[@]}" > /dev/null 2>&1; then
    echo "✅ v$v 已发布（正文内 APK 直链，附件上传不可达）"
  else
    echo "❌ v$v 创建失败"
  fi
done

echo "完成：https://github.com/$REPO/releases"
