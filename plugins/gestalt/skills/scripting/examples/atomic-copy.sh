#!/usr/bin/env bash
# Example: replace a file with private permissions in a trusted directory.
# Single writer only; no metadata preservation or crash-durability guarantee.
set -Eeuo pipefail

task_tmp=''
cleanup() {
    local rc=$?
    trap - EXIT
    if [[ -n $task_tmp ]]; then
        if ! rm -f -- "$task_tmp"; then
            printf 'error: temporary-file cleanup failed\n' >&2
            if ((rc == 0)); then rc=1; fi
        fi
    fi
    exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

usage() {
    printf 'Usage: %s [--dry-run] --output FILE -- INPUT\n' "${0##*/}"
}
fail() { printf 'error: %s\n' "$1" >&2; exit 2; }

main() {
    local output='' input='' dry_run=false target_dir
    while (($#)); do
        case $1 in
            --dry-run) dry_run=true; shift ;;
            --output)
                (($# >= 2)) || fail '--output needs a value'
                [[ -n $2 ]] || fail '--output must not be empty'
                output=$2
                shift 2
                ;;
            --help|-h) usage; return 0 ;;
            --) shift; break ;;
            -*) fail "unknown option: $1" ;;
            *) break ;;
        esac
    done
    (($# == 1)) || fail 'exactly one input is required'
    [[ -n $output ]] || fail '--output is required'
    input=$1
    # Prefix relative operands so a leading dash is never treated as an option.
    [[ $input == /* ]] || input=./$input
    [[ $output == /* ]] || output=./$output
    [[ -f $input && -r $input ]] || fail 'input must be a readable regular file'
    [[ ! -L $output ]] || fail 'output must not be a symbolic link'
    [[ ! -e $output || -f $output ]] || fail 'output must be a regular file'
    target_dir=${output%/*}
    [[ -d $target_dir && -w $target_dir ]] || fail 'output directory must exist and be writable'
    if [[ $dry_run == true ]]; then
        printf 'Would replace %q from %q with mode 600\n' "$output" "$input"
        return 0
    fi
    umask 077
    task_tmp=$(mktemp "$target_dir/.atomic-copy.XXXXXX") || return 1
    cat -- "$input" > "$task_tmp" || return 1
    chmod 600 "$task_tmp" || return 1
    mv -f -- "$task_tmp" "$output" || return 1
    task_tmp=''
}

main "$@"
