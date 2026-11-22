#!/bin/bash
# Compatible with the Bash 3.2 shipped with macOS; no Homebrew tools required.
set -eu

fail() {
    if [[ -t 2 ]]; then
        printf '\033[31m✗ %s  %s\033[0m\n' "$1" "$2" >&2
    else
        printf '✗ %s  %s\n' "$1" "$2" >&2
    fi
    if [[ -t 0 ]]; then
        read -r -p '按 Enter 关闭……' _answer || true
    fi
    exit 1
}

usage() {
    printf '%s\n' '用法：bash Start.sh [--python /完整路径/python3] [--no-browser] [--debug]' \
        '要求交互式终端和预先安装的 Python 3.12+。'
}

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
python_path=''
controller_args=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --python)
            [[ $# -ge 2 ]] || fail '检查参数' '--python 需要解释器路径。'
            python_path="$2"
            shift 2
            ;;
        --no-browser|--debug) controller_args+=("$1"); shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage; fail '检查参数' "未知参数：$1" ;;
    esac
done
[[ -t 0 && -t 1 ]] || fail '检查终端' '请在交互式终端中运行本脚本。'

is_supported_python() {
    "$1" -c 'import sys; sys.exit(0 if sys.version_info.major == 3 and sys.version_info.minor >= 12 else 1)' \
        >/dev/null 2>&1
}

if [[ -n "$python_path" ]]; then
    if ! is_supported_python "$python_path"; then
        fail '检查 Python' '指定的解释器不可用或版本低于 Python 3.12。'
    fi
else
    # Skip Apple's system stub, which may prompt to install developer tools.
    for candidate in python3 python3.14 python3.13 python3.12 python \
        /opt/homebrew/bin/python3 /usr/local/bin/python3 \
        /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
        executable="$(command -v "$candidate" || true)"
        [[ -n "$executable" && "$executable" != /usr/bin/python3 ]] || continue
        if is_supported_python "$executable"; then
            python_path="$executable"
            break
        fi
    done
    if [[ -z "$python_path" ]]; then
        fail '检查 Python' '未找到 Python 3.12+。请安装 Python，或用 --python 指定解释器的完整路径。'
    fi
fi

controller="$project_root/backend/scripts/start_macos.py"
if [[ ! -f "$controller" ]]; then
    fail '检查发布包' "发布包缺少文件：$controller"
fi
# exec makes the controller the owner monitored by app.launcher.
exec "$python_path" "$controller" ${controller_args[@]+"${controller_args[@]}"}
