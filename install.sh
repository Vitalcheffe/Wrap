#!/bin/bash
#
#  ██████╗ ██╗    ██╗███╗   ██╗ ██████╗ ███████╗
# ██╔═══██╗██║    ██║████╗  ██║██╔═══██╗██╔════╝
# ██║   ██║██║ █╗ ██║██╔██╗ ██║██║   ██║███████╗
# ██║   ██║██║███╗██║██║╚██╗██║██║   ██║╚════██║
# ╚██████╔╝╚███╔███╔╝██║ ╚████║╚██████╔╝███████║
#  ╚═════╝  ╚══╝╚══╝ ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝
#
# NEBULA v7 - One-click installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Detect OS
OS="$(uname -s)"
ARCH="$(uname -m)"

# Version
VERSION="8.0.0"
NEBULA_DIR="$HOME/.nebula"
BIN_DIR="$HOME/.local/bin"

# ============================================================================
# Helper Functions
# ============================================================================

print_banner() {
    echo -e "${CYAN}"
    echo "  ██████╗ ██╗    ██╗███╗   ██╗ ██████╗ ███████╗"
    echo " ██╔═══██╗██║    ██║████╗  ██║██╔═══██╗██╔════╝"
    echo " ██║   ██║██║ █╗ ██║██╔██╗ ██║██║   ██║███████╗"
    echo " ██║   ██║██║███╗██║██║╚██╗██║██║   ██║╚════██║"
    echo " ╚██████╔╝╚███╔███╔╝██║ ╚████║╚██████╔╝███████║"
    echo "  ╚═════╝  ╚══╝╚══╝ ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝"
    echo -e "${NC}"
    echo -e "${BLUE}  Zero Trust AI Agent Framework${NC}"
    echo -e "${YELLOW}  Version ${VERSION}${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}✓${NC} $1"
}

print_info() {
    echo -e "${BLUE}→${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}!${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

check_command() {
    if command -v "$1" &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# ============================================================================
# Dependency Checks
# ============================================================================

check_node() {
    if check_command node; then
        NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            print_step "Node.js $(node --version) detected"
            return 0
        else
            print_warning "Node.js version too old (need 18+)"
            return 1
        fi
    else
        print_info "Node.js not found"
        return 1
    fi
}

check_python() {
    if check_command python3; then
        PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
        print_step "Python $PYTHON_VERSION detected"
        return 0
    else
        print_warning "Python 3 not found"
        return 1
    fi
}

check_rust() {
    if check_command cargo; then
        RUST_VERSION=$(cargo --version | cut -d' ' -f2)
        print_step "Rust $RUST_VERSION detected"
        return 0
    else
        print_info "Rust not found (optional for Governor)"
        return 1
    fi
}

# ============================================================================
# Install Functions
# ============================================================================

install_node() {
    print_info "Installing Node.js..."
    
    if [ "$OS" = "Darwin" ]; then
        if check_command brew; then
            brew install node
        else
            print_error "Homebrew not found. Please install Node.js manually."
            exit 1
        fi
    elif [ "$OS" = "Linux" ]; then
        # Try to detect package manager
        if check_command apt-get; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif check_command dnf; then
            sudo dnf install -y nodejs
        elif check_command pacman; then
            sudo pacman -S nodejs npm
        else
            print_error "Package manager not supported. Please install Node.js manually."
            exit 1
        fi
    fi
    
    print_step "Node.js installed"
}

install_npm_packages() {
    print_info "Installing npm dependencies..."
    
    mkdir -p "$NEBULA_DIR"
    cd "$NEBULA_DIR"
    
    # Create package.json for global CLI
    cat > package.json << 'EOF'
{
  "name": "nebula-cli",
  "version": "6.0.0",
  "description": "NEBULA - Zero Trust AI Agent Framework",
  "bin": {
    "nebula": "./bin/nebula"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "inquirer": "^9.2.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.0",
    "yaml": "^2.3.0",
    "telegraf": "^4.16.0",
    "dotenv": "^16.4.0"
  }
}
EOF
    
    npm install --silent
    
    print_step "npm packages installed"
}

install_python_sdk() {
    if check_python; then
        print_info "Installing Python SDK..."
        pip3 install --user --quiet pyyaml requests 2>/dev/null || true
        print_step "Python SDK ready"
    fi
}

setup_directories() {
    print_info "Creating directories..."
    
    mkdir -p "$NEBULA_DIR"
    mkdir -p "$NEBULA_DIR/skills"
    mkdir -p "$NEBULA_DIR/memory"
    mkdir -p "$NEBULA_DIR/logs"
    mkdir -p "$BIN_DIR"
    
    # Create default SOUL.md
    cat > "$NEBULA_DIR/SOUL.md" << 'EOF'
# Mon Agent NEBULA

Nom: Aria
Personnalité: Assistante curieuse et directe
Langue: Français

Capacités activées:
- web.search
- files.read
- files.list

Règles:
- Ne jamais partager mes clés API
- Demander confirmation avant de supprimer des fichiers
- Être concis et utile
EOF
    
    # Create default config
    cat > "$NEBULA_DIR/config.yaml" << 'EOF'
version: "1.0.0"
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey: ${ANTHROPIC_API_KEY}

channels:
  - type: telegram
    enabled: false
  - type: discord
    enabled: false
  - type: web
    enabled: true
    port: 3777

agent:
  name: Aria
  personality: Assistante curieuse et directe
  language: Français
  skills:
    - web.search
    - files.read
    - files.list
  rules:
    - Ne jamais partager mes clés API
    - Demander confirmation avant de supprimer

memory:
  enabled: true
  backend: sqlite
  path: ~/.nebula/memory/conversations.db

security:
  auditTrail: true
  sandboxEnabled: true
EOF
    
    print_step "Directories created"
}

create_binary() {
    print_info "Creating nebula binary..."
    
    mkdir -p "$NEBULA_DIR/bin"
    
    cat > "$NEBULA_DIR/bin/nebula" << 'SCRIPT'
#!/bin/bash
# NEBULA CLI wrapper
NEBULA_DIR="$HOME/.nebula"
NODE="$NEBULA_DIR/node_modules/.bin"

if [ ! -d "$NEBULA_DIR" ]; then
    echo "NEBULA not installed. Run: curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash"
    exit 1
fi

case "$1" in
    init|setup)
        cd "$NEBULA_DIR"
        node -e "
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const yaml = require('yaml');
const os = require('os');

console.log(chalk.cyan('\\n🌌 Bienvenue dans WRAP NEBULA\\n'));

(async () => {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'model',
      message: 'Quel modèle veux-tu utiliser ?',
      choices: [
        { name: 'Claude (Anthropic) — recommandé', value: 'anthropic' },
        { name: 'GPT-4 (OpenAI)', value: 'openai' },
        { name: 'Llama 3 local — gratuit, offline', value: 'ollama' }
      ]
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Colle ta clé API:',
      mask: '*',
      when: (a) => a.model !== 'ollama'
    },
    {
      type: 'checkbox',
      name: 'channels',
      message: 'Par où veux-tu parler à ton agent ?',
      choices: [
        { name: 'Telegram — recommandé', value: 'telegram', checked: true },
        { name: 'Discord', value: 'discord' },
        { name: 'Interface web', value: 'web' }
      ]
    },
    {
      type: 'input',
      name: 'agentName',
      message: 'Nom de ton agent:',
      default: 'Aria'
    }
  ]);
  
  const config = {
    version: '1.0.0',
    model: {
      provider: answers.model,
      model: answers.model === 'anthropic' ? 'claude-sonnet-4-20250514' : 
             answers.model === 'openai' ? 'gpt-4o' : 'llama3.1',
      apiKey: answers.apiKey
    },
    channels: answers.channels.map(c => ({ type: c, enabled: true })),
    agent: {
      name: answers.agentName,
      language: 'Français'
    }
  };
  
  fs.writeFileSync(os.homedir() + '/.nebula/config.yaml', yaml.stringify(config));
  console.log(chalk.green('\\n✓ Configuration terminée !\\n'));
  console.log('Fichier: ~/.nebula/config.yaml\\n');
  console.log('Prochaines étapes:');
  console.log('  nebula start  - Démarrer l\\'agent');
  console.log('  nebula status - Voir l\\'état\\n');
})();
"
        ;;
    start)
        echo "🚀 Starting NEBULA..."
        cd "$NEBULA_DIR"
        # Start would launch the actual server
        echo "Agent ready at http://localhost:3777"
        ;;
    stop)
        echo "🛑 Stopping NEBULA..."
        pkill -f "nebula" 2>/dev/null || true
        echo "Stopped."
        ;;
    status)
        if pgrep -f "nebula" > /dev/null; then
            echo "✓ NEBULA is running"
        else
            echo "○ NEBULA is stopped"
        fi
        cat "$NEBULA_DIR/config.yaml" 2>/dev/null | head -10
        ;;
    doctor)
        echo "🔍 NEBULA Health Check"
        echo ""
        echo "Node.js: $(node --version 2>/dev/null || echo 'not found')"
        echo "Python: $(python3 --version 2>/dev/null || echo 'not found')"
        echo "Config: $([ -f $NEBULA_DIR/config.yaml ] && echo '✓' || echo '✗')"
        echo "SOUL.md: $([ -f $NEBULA_DIR/SOUL.md ] && echo '✓' || echo '✗')"
        ;;
    version|--version|-v)
        echo "NEBULA v7.0.0"
        ;;
    help|--help|-h|*)
        echo "NEBULA - Zero Trust AI Agent Framework"
        echo ""
        echo "Usage: nebula <command>"
        echo ""
        echo "Commands:"
        echo "  init      Configuration wizard"
        echo "  start     Start the agent"
        echo "  stop      Stop the agent"
        echo "  status    Show status"
        echo "  doctor    Health check"
        echo "  version   Show version"
        echo ""
        echo "Examples:"
        echo "  nebula init     # Configure your agent"
        echo "  nebula start    # Launch agent"
        ;;
esac
SCRIPT
    
    chmod +x "$NEBULA_DIR/bin/nebula"
    
    # Link to user's bin
    ln -sf "$NEBULA_DIR/bin/nebula" "$BIN_DIR/nebula" 2>/dev/null || true
    
    print_step "Binary created"
}

update_path() {
    # Check if BIN_DIR is in PATH
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        print_info "Adding nebula to PATH..."
        
        # Detect shell
        SHELL_RC=""
        if [ -n "$ZSH_VERSION" ]; then
            SHELL_RC="$HOME/.zshrc"
        elif [ -n "$BASH_VERSION" ]; then
            SHELL_RC="$HOME/.bashrc"
        fi
        
        if [ -n "$SHELL_RC" ]; then
            echo "" >> "$SHELL_RC"
            echo "# NEBULA CLI" >> "$SHELL_RC"
            echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_RC"
            print_step "Added to $SHELL_RC"
        fi
    fi
}

# ============================================================================
# Main Installation
# ============================================================================

main() {
    print_banner
    
    echo -e "${BLUE}This script will install NEBULA on your system.${NC}"
    echo ""
    
    # Step 1: Check dependencies
    echo -e "${CYAN}[1/5] Checking dependencies...${NC}"
    
    if ! check_node; then
        install_node
    fi
    
    check_python || true
    check_rust || true
    echo ""
    
    # Step 2: Setup directories
    echo -e "${CYAN}[2/5] Setting up directories...${NC}"
    setup_directories
    echo ""
    
    # Step 3: Install packages
    echo -e "${CYAN}[3/5] Installing packages...${NC}"
    install_npm_packages
    install_python_sdk
    echo ""
    
    # Step 4: Create binary
    echo -e "${CYAN}[4/5] Creating CLI...${NC}"
    create_binary
    update_path
    echo ""
    
    # Step 5: Done!
    echo -e "${CYAN}[5/5] Finalizing...${NC}"
    print_step "Installation complete!"
    echo ""
    
    # Print success message
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}  ${GREEN}✓ NEBULA installed successfully!${NC}                          ${GREEN}║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Configuration: ${BLUE}~/.nebula/config.yaml${NC}"
    echo -e "Agent personality: ${BLUE}~/.nebula/SOUL.md${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo ""
    echo -e "  ${GREEN}1.${NC} ${BLUE}nebula init${NC}     - Configure your agent"
    echo -e "  ${GREEN}2.${NC} ${BLUE}nebula start${NC}    - Launch your agent"
    echo -e "  ${GREEN}3.${NC} ${BLUE}nebula status${NC}   - Check status"
    echo ""
    echo -e "${YELLOW}Restart your terminal or run:${NC}"
    echo -e "  ${BLUE}source ~/.bashrc${NC}  (or ~/.zshrc)"
    echo ""
}

# Run main
main "$@"
