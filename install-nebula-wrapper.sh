#!/bin/bash
NEBULA_DIR="$HOME/.nebula"

if [ ! -d "$NEBULA_DIR" ]; then
    echo "NEBULA not installed. Run: curl -fsSL https://raw.githubusercontent.com/Vitalcheffe/Wrap/main/install.sh | bash"
    exit 1
fi

# Load .env if exists
if [ -f "$NEBULA_DIR/.env" ]; then
    set -a; source "$NEBULA_DIR/.env"; set +a
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

check() {
    if [ $2 -eq 0 ]; then
        echo -e "  ${GREEN}✓${NC} $1"
    else
        echo -e "  ${RED}✗${NC} $1"
    fi
}

check_val() {
    if [ -n "$2" ]; then
        echo -e "  ${GREEN}✓${NC} $1: $2"
    else
        echo -e "  ${YELLOW}⚠${NC} $1: not set"
    fi
}

case "$1" in
    init)
        cd "$NEBULA_DIR"
        node -e "
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const yaml = require('yaml');
const os = require('os');

console.log(chalk.cyan('\n  WRAP NEBULA — Setup Wizard\n'));

(async () => {
  const answers = await inquirer.prompt([
    { type: 'list', name: 'model', message: 'AI backend:',
      choices: [
        { name: 'Ollama (free, local) — recommended', value: 'ollama' },
        { name: 'Claude (Anthropic API key)', value: 'anthropic' },
        { name: 'GPT-4 (OpenAI API key)', value: 'openai' }
      ]},
    { type: 'password', name: 'apiKey', message: 'API key:', mask: '*', when: (a) => a.model !== 'ollama' },
    { type: 'input', name: 'agentName', message: 'Agent name:', default: 'Aria' },
    { type: 'confirm', name: 'enableTelegram', message: 'Enable Telegram?', default: false },
    { type: 'input', name: 'tgToken', message: 'Telegram bot token:', when: (a) => a.enableTelegram }
  ]);

  const config = {
    model: {
      provider: answers.model,
      model: answers.model === 'anthropic' ? 'claude-sonnet-4-20250514' : answers.model === 'openai' ? 'gpt-4o' : 'llama3',
      apiKey: answers.apiKey || ''
    },
    agent: { name: answers.agentName, language: 'English' },
    channels: answers.enableTelegram ? [{ type: 'telegram', enabled: true, token: answers.tgToken }] : []
  };

  fs.writeFileSync(os.homedir() + '/.nebula/config.yaml', yaml.stringify(config));
  const soul = '# SOUL.md\n\nName: ' + answers.agentName + '\nPersonality: Curious and direct assistant\n\nSkills enabled:\n- web.search\n- files.read\n- files.write\n- code.run\n- reminder.set\n\nRules:\n- Never share API keys\n- Ask before deleting files\n- Keep answers concise\n';
  fs.writeFileSync(os.homedir() + '/.nebula/SOUL.md', soul);
  const env = 'OLLAMA_BASE_URL=http://localhost:11434\nOLLAMA_MODEL=' + config.model.model + '\n' + (answers.apiKey ? (answers.model === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY') + '=' + answers.apiKey + '\n' : '') + (answers.tgToken ? 'TELEGRAM_BOT_TOKEN=' + answers.tgToken + '\n' : '');
  fs.writeFileSync(os.homedir() + '/.nebula/.env', env);
  console.log(chalk.green('\n  Done! Config saved.\n'));
  console.log(chalk.yellow('  Next: nebula start\n'));
})();
"
        ;;
    start)
        source "$NEBULA_DIR/.env" 2>/dev/null
        cd "$NEBULA_DIR"
        npx tsx "$NEBULA_DIR/start-agent.ts"
        ;;
    stop)
        pkill -f "start-agent" 2>/dev/null && echo -e "${GREEN}✓${NC} Stopped" || echo "Not running"
        ;;
    status)
        if pgrep -f "start-agent" > /dev/null; then
            echo -e "${GREEN}✓${NC} NEBULA is running"
        else
            echo -e "${YELLOW}○${NC} NEBULA is stopped"
        fi
        if [ -f "$NEBULA_DIR/config.yaml" ]; then
            echo ""
            cat "$NEBULA_DIR/config.yaml"
        fi
        ;;
    doctor)
        echo -e "${CYAN}"
        echo "  🔍 WRAP NEBULA Health Check"
        echo -e "${NC}"

        # Node
        node_ver=$(node --version 2>/dev/null)
        node_major=$(echo "$node_ver" | sed 's/v//' | cut -d. -f1)
        if [ -n "$node_major" ] && [ "$node_major" -ge 18 ] 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} Node.js $node_ver"
        else
            echo -e "  ${RED}✗${NC} Node.js 18+ required (found: ${node_ver:-none})"
        fi

        # npm
        npm_ver=$(npm --version 2>/dev/null)
        check_val "npm" "$npm_ver"

        # Config
        [ -f "$NEBULA_DIR/config.yaml" ]
        check "config.yaml" $?

        # SOUL.md
        [ -f "$NEBULA_DIR/SOUL.md" ]
        check "SOUL.md" $?

        # .env
        [ -f "$NEBULA_DIR/.env" ]
        check ".env" $?

        # Provider
        provider=$(grep 'provider:' "$NEBULA_DIR/config.yaml" 2>/dev/null | awk '{print $2}')
        model=$(grep 'model:' "$NEBULA_DIR/config.yaml" 2>/dev/null | head -1 | awk '{print $2}')
        echo ""
        echo -e "  ${CYAN}Provider:${NC} ${provider:-ollama} (${model:-llama3})"

        if [ "$provider" = "ollama" ] || [ -z "$provider" ]; then
            if curl -s --max-time 3 "http://localhost:11434/api/tags" > /dev/null 2>&1; then
                echo -e "  ${GREEN}✓${NC} Ollama is running"
                models=$(curl -s "http://localhost:11434/api/tags" | python3 -c "import sys,json; [print('    -',m['name']) for m in json.load(sys.stdin).get('models',[])]" 2>/dev/null)
                if [ -n "$models" ]; then
                    echo "  Available models:"
                    echo "$models"
                fi
            else
                echo -e "  ${RED}✗${NC} Ollama not running"
                echo -e "  ${YELLOW}Fix:${NC} ollama serve"
            fi
        elif [ "$provider" = "anthropic" ]; then
            if grep -q "ANTHROPIC_API_KEY=." "$NEBULA_DIR/.env" 2>/dev/null; then
                echo -e "  ${GREEN}✓${NC} Anthropic API key set"
            else
                echo -e "  ${RED}✗${NC} ANTHROPIC_API_KEY not set"
            fi
        elif [ "$provider" = "openai" ]; then
            if grep -q "OPENAI_API_KEY=." "$NEBULA_DIR/.env" 2>/dev/null; then
                echo -e "  ${GREEN}✓${NC} OpenAI API key set"
            else
                echo -e "  ${RED}✗${NC} OPENAI_API_KEY not set"
            fi
        fi

        # Telegram
        if grep -q "TELEGRAM_BOT_TOKEN=." "$NEBULA_DIR/.env" 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} Telegram configured"
        else
            echo -e "  ${YELLOW}⚠${NC} Telegram not configured"
        fi

        # Memory
        if [ -f "$NEBULA_DIR/memory.json" ]; then
            entries=$(python3 -c "import json; print(len(json.load(open('$NEBULA_DIR/memory.json'))))" 2>/dev/null || echo 0)
            echo -e "  ${GREEN}✓${NC} Memory: $entries entries"
        else
            echo -e "  ${YELLOW}⚠${NC} Memory: empty"
        fi

        # Disk space
        avail=$(df -h "$NEBULA_DIR" | tail -1 | awk '{print $4}')
        echo -e "  ${GREEN}✓${NC} Disk: $avail available"

        echo ""
        ;;
    version|--version|-v)
        echo "NEBULA v8.0.0"
        ;;
    help|--help|-h|*)
        echo -e "${CYAN}"
        echo "  WRAP NEBULA — Zero Trust AI Agent Framework"
        echo -e "${NC}"
        echo "  Usage: nebula <command>"
        echo ""
        echo "  Commands:"
        echo "    init      Setup wizard"
        echo "    start     Start the agent"
        echo "    stop      Stop the agent"
        echo "    status    Show status"
        echo "    doctor    Health check"
        echo "    skill     Manage skills"
        echo "    agents    Multi-agent info"
        echo ""
        echo "  Examples:"
        echo "    nebula init"
        echo "    nebula start"
        echo "    nebula doctor"
        ;;
esac
