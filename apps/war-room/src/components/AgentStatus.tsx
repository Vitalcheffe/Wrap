'use client'

import { useState } from 'react'
import { 
  Zap, 
  Bot, 
  Brain,
  Cpu,
  MemoryStick,
  MoreVertical,
  Pause,
  Play,
  RotateCcw,
  Terminal
} from 'lucide-react'

interface Agent {
  id: string
  name: string
  status: 'active' | 'idle' | 'error' | 'stopped'
  provider: string
  model: string
  requests: number
  lastActivity: string
  memory: number
  tokens: number
}

const mockAgents: Agent[] = [
  {
    id: 'agent-1',
    name: 'Primary Agent',
    status: 'active',
    provider: 'anthropic',
    model: 'claude-3-opus',
    requests: 847,
    lastActivity: '2s ago',
    memory: 128,
    tokens: 145230,
  },
  {
    id: 'agent-2',
    name: 'Research Agent',
    status: 'active',
    provider: 'openai',
    model: 'gpt-4-turbo',
    requests: 234,
    lastActivity: '15s ago',
    memory: 64,
    tokens: 45890,
  },
  {
    id: 'agent-3',
    name: 'Code Agent',
    status: 'idle',
    provider: 'anthropic',
    model: 'claude-3-sonnet',
    requests: 156,
    lastActivity: '5m ago',
    memory: 32,
    tokens: 23456,
  },
]

interface AgentStatusProps {
  detailed?: boolean
}

export default function AgentStatus({ detailed = false }: AgentStatusProps) {
  const [agents, setAgents] = useState(mockAgents)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  const toggleAgent = (id: string) => {
    setAgents(prev => prev.map(agent => 
      agent.id === id 
        ? { ...agent, status: agent.status === 'active' ? 'stopped' : 'active' }
        : agent
    ))
  }

  const getStatusColor = (status: Agent['status']) => {
    switch (status) {
      case 'active': return 'status-active'
      case 'idle': return 'status-warning'
      case 'error': return 'status-error'
      case 'stopped': return 'bg-gray-500'
    }
  }

  const getStatusLabel = (status: Agent['status']) => {
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  return (
    <div className={`card-glass rounded-xl p-6 ${detailed ? 'col-span-1' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Bot className="w-5 h-5 text-nebula-primary" />
          Agent Status
        </h3>
        <span className="text-sm text-gray-400">
          {agents.filter(a => a.status === 'active').length} / {agents.length} active
        </span>
      </div>

      <div className="space-y-3">
        {agents.map(agent => (
          <div 
            key={agent.id}
            className={`p-3 rounded-lg border transition-all cursor-pointer ${
              selectedAgent === agent.id 
                ? 'border-nebula-primary bg-nebula-primary/10' 
                : 'border-gray-800 hover:border-gray-700 bg-black/20'
            }`}
            onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`status-dot ${getStatusColor(agent.status)}`} />
                <div>
                  <div className="font-medium text-sm">{agent.name}</div>
                  <div className="text-xs text-gray-500">{agent.model}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded ${
                  agent.status === 'active' ? 'bg-green-500/20 text-green-400' :
                  agent.status === 'idle' ? 'bg-yellow-500/20 text-yellow-400' :
                  agent.status === 'error' ? 'bg-red-500/20 text-red-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {getStatusLabel(agent.status)}
                </span>
                <button 
                  className="p-1 hover:bg-white/5 rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleAgent(agent.id)
                  }}
                >
                  {agent.status === 'active' ? (
                    <Pause className="w-4 h-4 text-gray-400" />
                  ) : (
                    <Play className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            {/* Expanded Details */}
            {(selectedAgent === agent.id || detailed) && (
              <div className="mt-3 pt-3 border-t border-gray-800 grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2 text-gray-400">
                  <Terminal className="w-3 h-3" />
                  <span>{agent.requests} requests</span>
                </div>
                <div className="flex items-center gap-2 text-gray-400">
                  <Cpu className="w-3 h-3" />
                  <span>{agent.provider}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-400">
                  <MemoryStick className="w-3 h-3" />
                  <span>{agent.memory}MB</span>
                </div>
                <div className="flex items-center gap-2 text-gray-400">
                  <Brain className="w-3 h-3" />
                  <span>{(agent.tokens / 1000).toFixed(1)}k tokens</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {detailed && (
        <div className="mt-4 pt-4 border-t border-gray-800">
          <h4 className="text-sm font-medium mb-3">Quick Actions</h4>
          <div className="grid grid-cols-2 gap-2">
            <button className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-nebula-primary/10 text-nebula-primary hover:bg-nebula-primary/20 transition-colors text-sm">
              <RotateCcw className="w-4 h-4" />
              Restart All
            </button>
            <button className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-sm">
              <Zap className="w-4 h-4" />
              Scale Up
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
