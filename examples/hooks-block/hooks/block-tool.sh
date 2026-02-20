#!/usr/bin/env bash
# BeforeTool hook that blocks the "secret_greet" tool.
# Allowed tools pass through; blocked tools return decision=deny with a reason.
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name')

if [ "$TOOL" = "secret_greet" ]; then
  echo '{"decision":"deny","reason":"secret_greet is restricted by security policy"}'
  exit 0
fi

echo '{}'
