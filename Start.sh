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
        read -r -p 'Press Enter to close...' _answer || true
    fi
    exit 1
}

usage() {
    printf '%s\n' 'Usage: bash Start.sh [--python /full/path/to/python3] [--no-browser] [--debug]' \
        'Requires an interactive terminal and Python 3.12 or later.'
}

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
python_path=''
controller_args=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --python)
            [[ $# -ge 2 ]] || fail 'Check arguments' '--python requires the path to a Python interpreter.'
            python_path="$2"
            shift 2
            ;;
        --no-browser|--debug) controller_args+=("$1"); shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage; fail 'Check arguments' "Unknown argument: $1" ;;
    esac
done
[[ -t 0 && -t 1 ]] || fail 'Check terminal' 'Run this script in an interactive terminal.'

is_supported_python() {
    "$1" -c 'import sys; sys.exit(0 if sys.version_info.major == 3 and sys.version_info.minor >= 12 else 1)' \
        >/dev/null 2>&1
}

if [[ -n "$python_path" ]]; then
    if ! is_supported_python "$python_path"; then
        fail 'Check Python' 'The specified interpreter could not run or is older than Python 3.12.'
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
        fail 'Check Python' 'No supported Python installation found. Install Python 3.12 or later, or use --python with the full path to the interpreter.'
    fi
fi

controller="$project_root/backend/scripts/start_macos.py"
if [[ ! -f "$controller" ]]; then
    fail 'Check release package' "Missing file: $controller. Download and extract the complete release package."
fi
# exec makes the controller the owner monitored by app.launcher.
exec "$python_path" "$controller" ${controller_args[@]+"${controller_args[@]}"}
