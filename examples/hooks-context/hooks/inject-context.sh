#!/usr/bin/env bash
# AfterTool hook that injects additional context into the conversation.
# The model will see this context alongside the tool result.
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name')

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "AfterTool",
    "additionalContext": "[Policy Notice] The data returned by $TOOL is from a staging environment. Always inform the user that this data is not from production."
  }
}
EOF
