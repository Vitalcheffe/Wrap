'use client'

import { useState, useEffect } from 'react'
import MetricsPanel from '@/components/MetricsPanel'
import AgentStatus from '@/components/AgentStatus'
import ToolRegistry from '@/components/ToolRegistry'
import { 
  Activity, 
  Shield, 
  Zap, 
  Terminal, 
  Settings,
  RefreshCw,
  ChevronDown
} from 'lucide-react'

interface SystemStats {
  totalRequests: number
  successRate: number
  avgLatency: number
  activeAgents: number
  memoryUsage: number
  cpuUsage: number
}

export default function WarRoom() {
  const [stats, setStats] = useState<SystemStats>({
    totalRequests: 12847,
    successRate: 99.7,
    avgLatency: 127,
    activeAgents: 3,
    memoryUsage: 42,
    cpuUsage: 28,
  })
  const [isConnected, setIsConnected] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(new Date())
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'tools' | 'logs'>('overview')

  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdate(new Date())
      // Simulate stats updates
      setStats(prev => ({
        ...prev,
        totalRequests: prev.totalRequests + Math.floor(Math.random() * 5),
        avgLatency: Math.max(50, prev.avgLatency + (Math.random() - 0.5) * 20),
        memoryUsage: Math.min(95, Math.max(20, prev.memoryUsage + (Math.random() - 0.5) * 5)),
        cpuUsage: Math.min(90, Math.max(10, prev.cpuUsage + (Math.random() - 0.5) * 8)),
      }))
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-nebula-primary/20 bg-nebula-darker/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-nebula-primary to-nebula-secondary flex items-center justify-center">
                  <Shield className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold bg-gradient-to-r from-nebula-primary to-nebula-accent bg-clip-text text-transparent">
                    WRAP NEBULA
                  </h1>
                  <p className="text-xs text-gray-500">War Room v2.0</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6">
              {/* Connection Status */}
              <div className="flex items-center gap-2">
                <div className={`status-dot ${isConnected ? 'status-active' : 'status-error'}`} />
                <span className="text-sm text-gray-400">
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              {/* Last Update */}
              <div className="text-sm text-gray-500">
                Last update: {lastUpdate.toLocaleTimeString()}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button className="p-2 rounded-lg hover:bg-nebula-primary/10 transition-colors">
                  <RefreshCw className="w-5 h-5 text-gray-400" />
                </button>
                <button className="p-2 rounded-lg hover:bg-nebula-primary/10 transition-colors">
                  <Settings className="w-5 h-5 text-gray-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="border-b border-nebula-primary/10 bg-nebula-dark/50">
        <div className="container mx-auto px-4">
          <div className="flex gap-1">
            {[
              { id: 'overview', label: 'Overview', icon: Activity },
              { id: 'agents', label: 'Agents', icon: Zap },
              { id: 'tools', label: 'Tools', icon: Terminal },
              { id: 'logs', label: 'Logs', icon: ChevronDown },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`px-4 py-3 flex items-center gap-2 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'border-nebula-primary text-nebula-primary bg-nebula-primary/5'
                    : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Metrics */}
            <div className="lg:col-span-2 space-y-6">
              <MetricsPanel stats={stats} />
              
              {/* Quick Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  title="Total Requests"
                  value={stats.totalRequests.toLocaleString()}
                  icon={<Activity className="w-5 h-5" />}
                  trend="+12%"
                  trendUp
                />
                <StatCard
                  title="Success Rate"
                  value={`${stats.successRate}%`}
                  icon={<Shield className="w-5 h-5" />}
                  trend="+0.2%"
                  trendUp
                />
                <StatCard
                  title="Avg Latency"
                  value={`${Math.round(stats.avgLatency)}ms`}
                  icon={<Zap className="w-5 h-5" />}
                  trend="-8%"
                  trendUp
                />
                <StatCard
                  title="Active Agents"
                  value={stats.activeAgents.toString()}
                  icon={<Terminal className="w-5 h-5" />}
                />
              </div>
            </div>

            {/* Right Column - Status */}
            <div className="space-y-6">
              <AgentStatus />
              <SystemHealth memory={stats.memoryUsage} cpu={stats.cpuUsage} />
            </div>
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AgentStatus detailed />
            <div className="card-glass rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Agent Activity</h3>
              <p className="text-gray-400">Agent activity logs and performance metrics will appear here.</p>
            </div>
          </div>
        )}

        {activeTab === 'tools' && (
          <ToolRegistry />
        )}

        {activeTab === 'logs' && (
          <div className="card-glass rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">System Logs</h3>
            <div className="terminal-text text-sm bg-black/30 rounded-lg p-4 max-h-[600px] overflow-auto">
              <div className="text-green-400">[INFO] System initialized successfully</div>
              <div className="text-green-400">[INFO] Connected to Core Engine at localhost:3777</div>
              <div className="text-blue-400">[DEBUG] Loading policy from default.yaml</div>
              <div className="text-green-400">[INFO] Policy loaded: 12 rules active</div>
              <div className="text-green-400">[INFO] Rust Governor bridge established</div>
              <div className="text-yellow-400">[WARN] High memory usage detected: 78%</div>
              <div className="text-green-400">[INFO] Circuit breaker healthy for all providers</div>
              <div className="text-blue-400">[DEBUG] Tool execution: web_search completed in 234ms</div>
              <div className="text-green-400">[INFO] Audit trail: 1,284 entries recorded</div>
              <div className="text-gray-500">[TRACE] WebSocket heartbeat sent</div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-nebula-primary/10 bg-nebula-darker/50 py-4">
        <div className="container mx-auto px-4 flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center gap-4">
            <span>WRAP NEBULA v2.0.0</span>
            <span>•</span>
            <span>Zero Trust Architecture</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Core Engine: localhost:3777</span>
            <div className="status-dot status-active" />
          </div>
        </div>
      </footer>
    </div>
  )
}

// Stat Card Component
function StatCard({ 
  title, 
  value, 
  icon, 
  trend, 
  trendUp 
}: { 
  title: string
  value: string
  icon: React.ReactNode
  trend?: string
  trendUp?: boolean
}) {
  return (
    <div className="card-glass rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div className="p-2 rounded-lg bg-nebula-primary/10 text-nebula-primary">
          {icon}
        </div>
        {trend && (
          <span className={`text-xs font-medium ${trendUp ? 'text-green-400' : 'text-red-400'}`}>
            {trend}
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-gray-500">{title}</div>
      </div>
    </div>
  )
}

// System Health Component
function SystemHealth({ memory, cpu }: { memory: number; cpu: number }) {
  return (
    <div className="card-glass rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4">System Health</h3>
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">Memory Usage</span>
            <span className="text-white">{Math.round(memory)}%</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 rounded-full ${
                memory > 80 ? 'bg-red-500' : memory > 60 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${memory}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">CPU Usage</span>
            <span className="text-white">{Math.round(cpu)}%</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 rounded-full ${
                cpu > 80 ? 'bg-red-500' : cpu > 60 ? 'bg-yellow-500' : 'bg-blue-500'
              }`}
              style={{ width: `${cpu}%` }}
            />
          </div>
        </div>
        <div className="pt-2 border-t border-gray-800">
          <div className="flex items-center gap-2 text-sm">
            <div className="status-dot status-active" />
            <span className="text-green-400">All systems operational</span>
          </div>
        </div>
      </div>
    </div>
  )
}
