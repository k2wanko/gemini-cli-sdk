#!/usr/bin/env bash
LOGFILE="$(dirname "$0")/../hook.log"
INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')
TOOL=$(echo "$INPUT" | jq -r '.tool_name // "N/A"')
echo "[Hook] $EVENT — tool=$TOOL" >> "$LOGFILE"
echo '{}'
