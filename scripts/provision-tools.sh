#!/usr/bin/env bash
# ==============================================================================
# yoof1337 — Agent Environment & Tools Provisioning Script
#
# Usage:
#   bash scripts/provision-tools.sh
# ==============================================================================

set -euo pipefail

echo "========================================================"
echo "  🛠️  Provisioning yoof1337 Agent Tooling Environment"
echo "========================================================"

# 1. Install CLI utilities commonly used by agent tools
echo "📦 Checking and installing system utilities..."
if command -v apt-get &> /dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq jq ripgrep curl git python3
elif command -v brew &> /dev/null; then
    brew install jq ripgrep
fi

# 2. Ensure custom tools directory exists
mkdir -p .yoof1337

# 3. Seed starter custom tools if not already present
CUSTOM_TOOLS_FILE=".yoof1337/custom-tools.json"
if [ ! -f "$CUSTOM_TOOLS_FILE" ]; then
    echo "📝 Initializing starter custom tools..."
    cat <<EOF > "$CUSTOM_TOOLS_FILE"
{
  "run_lint": {
    "name": "run_lint",
    "description": "Run the project linter / type checker across files.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "Optional file path or directory" }
      }
    },
    "commandTemplate": "npm run lint -- {{path}}",
    "mutating": false,
    "category": "PROJECT TOOLS"
  },
  "run_tests": {
    "name": "run_tests",
    "description": "Run test suite, optionally targeting a specific test file or filter.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "filter": { "type": "string", "description": "Optional test name or path filter" }
      }
    },
    "commandTemplate": "npm test -- {{filter}}",
    "mutating": false,
    "category": "PROJECT TOOLS"
  }
}
EOF
    echo "✓ Seeded starter custom tools in $CUSTOM_TOOLS_FILE"
fi

echo "========================================================"
echo "  ✅ Tooling Environment Provisioned Successfully!"
echo "========================================================"
