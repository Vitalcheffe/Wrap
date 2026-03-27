#!/bin/bash
#
# WRAP NEBULA v2.0 - Demo Script
# Demonstrates the complete system functionality
#

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     WRAP NEBULA v2.0 - Zero Trust AI Agent Framework         ║"
echo "║                   Demonstration Script                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print section header
section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Function to print success
success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print error
error() {
    echo -e "${RED}✗ $1${NC}"
}

# Function to print info
info() {
    echo -e "${BLUE}→ $1${NC}"
}

# Check prerequisites
section "Checking Prerequisites"

if command -v node &> /dev/null; then
    success "Node.js $(node --version) installed"
else
    error "Node.js not installed"
    exit 1
fi

if command -v python3 &> /dev/null; then
    success "Python $(python3 --version) installed"
else
    error "Python not installed"
    exit 1
fi

if command -v cargo &> /dev/null; then
    success "Rust/Cargo $(cargo --version) installed"
else
    info "Rust not installed (Governor will use fallback)"
fi

# Project structure
section "Project Structure"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
info "Project directory: $PROJECT_DIR"

echo ""
echo "Directory structure:"
ls -la "$PROJECT_DIR" 2>/dev/null || echo "  (Project files)"

# Count lines of code
section "Lines of Code"

TOTAL_LINES=0

if [ -d "$PROJECT_DIR/packages/core/src" ]; then
    CORE_LINES=$(find "$PROJECT_DIR/packages/core/src" -name "*.ts" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    info "Core TypeScript: $CORE_LINES lines"
    TOTAL_LINES=$((TOTAL_LINES + CORE_LINES))
fi

if [ -d "$PROJECT_DIR/packages/python-sdk/wrap_ghost" ]; then
    PYTHON_LINES=$(find "$PROJECT_DIR/packages/python-sdk/wrap_ghost" -name "*.py" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    info "Python SDK: $PYTHON_LINES lines"
    TOTAL_LINES=$((TOTAL_LINES + PYTHON_LINES))
fi

if [ -d "$PROJECT_DIR/packages/js-sdk/src" ]; then
    JS_LINES=$(find "$PROJECT_DIR/packages/js-sdk/src" -name "*.ts" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    info "JavaScript SDK: $JS_LINES lines"
    TOTAL_LINES=$((TOTAL_LINES + JS_LINES))
fi

if [ -d "$PROJECT_DIR/apps/war-room/src" ]; then
    WARROOM_LINES=$(find "$PROJECT_DIR/apps/war-room/src" -name "*.tsx" -o -name "*.ts" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    info "War Room Dashboard: $WARROOM_LINES lines"
    TOTAL_LINES=$((TOTAL_LINES + WARROOM_LINES))
fi

if [ -d "$PROJECT_DIR/crates/governor/src" ]; then
    RUST_LINES=$(find "$PROJECT_DIR/crates/governor/src" -name "*.rs" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    info "Rust Governor: $RUST_LINES lines"
    TOTAL_LINES=$((TOTAL_LINES + RUST_LINES))
fi

echo ""
success "Total: $TOTAL_LINES lines of code"

# Features
section "WRAP NEBULA Features"

echo "✓ WRAP Primitive: Context + Tools + Boundaries + Output"
echo "✓ Zero Trust Architecture with Rust Safety Governor"
echo "✓ Input Sanitization (Prompt Injection, PII, Profanity)"
echo "✓ Policy Engine with Hot-Reload"
echo "✓ Audit Trail with Ed25519 Signatures"
echo "✓ Circuit Breaker for Provider Failover"
echo "✓ Secrets Management (Env, File, Vault)"
echo "✓ OpenTelemetry Integration"
echo "✓ MCP 2.0 Protocol Support"
echo "✓ Virtual File System with Sandbox"
echo "✓ Multi-Provider Support (Anthropic, OpenAI, Google, Ollama)"
echo "✓ WebSocket Streaming"
echo "✓ Next.js War Room Dashboard"

# Usage examples
section "Usage Examples"

echo ""
echo -e "${YELLOW}Python SDK:${NC}"
echo ""
cat << 'EOF'
from wrap_ghost import Ghost, GhostConfig

# Initialize client
config = GhostConfig(
    endpoint="http://localhost:3777",
    model="claude-3-opus"
)

async with Ghost(config) as ghost:
    # Execute a task
    response = await ghost.run(
        "Research the latest AI agent frameworks",
        max_iterations=10
    )
    print(response.content)
EOF

echo ""
echo -e "${YELLOW}JavaScript SDK:${NC}"
echo ""
cat << 'EOF'
import { Ghost } from '@wrap-nebula/ghost-sdk';

const ghost = new Ghost({
  endpoint: 'http://localhost:3777',
  model: 'claude-3-opus'
});

// Execute a task
const response = await ghost.run('Build a REST API', {
  maxIterations: 20
});
console.log(response.content);
EOF

echo ""
echo -e "${YELLOW}TypeScript Core:${NC}"
echo ""
cat << 'EOF'
import { CoreServer, AgentRuntime } from '@wrap-nebula/core';

// Start the server
const server = new CoreServer({ port: 3777 });
await server.start();

// Create an agent
const agent = new AgentRuntime({
  id: 'research-agent',
  model: { provider: 'anthropic', model: 'claude-3-opus' }
});

// Run a task
const result = await agent.run('Analyze market trends');
EOF

# Security features
section "Security Features"

echo "✓ Input Sanitization at SDK Level (BEFORE LLM call)"
echo "✓ Rust Safety Governor for Zero Trust enforcement"
echo "✓ Policy Engine with YAML hot-reload"
echo "✓ Audit Trail with Ed25519 hash chain"
echo "✓ Sandbox execution with resource limits"
echo "✓ Secrets management (never inline API keys)"
echo "✓ PII detection and masking"
echo "✓ Prompt injection detection"

# Completion
section "Demo Complete"

echo -e "${GREEN}WRAP NEBULA v2.0 is ready for use!${NC}"
echo ""
echo "Next steps:"
echo "  1. Install dependencies: npm install / pip install -e ."
echo "  2. Start the Core server: npm run start"
echo "  3. Start the War Room: cd apps/war-room && npm run dev"
echo "  4. Connect with SDK and start building agents!"
echo ""
echo "Documentation: README.md"
echo "Issues: https://github.com/wrap-nebula/wrap-nebula/issues"
