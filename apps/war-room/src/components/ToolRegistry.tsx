'use client'

import { useState } from 'react'
import { 
  Wrench, 
  Search, 
  FileCode, 
  Database,
  Globe,
  Terminal,
  Shield,
  Image,
  Calculator,
  Mail,
  Cloud,
  MoreHorizontal,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react'

interface Tool {
  id: string
  name: string
  description: string
  category: 'web' | 'code' | 'data' | 'system' | 'ai'
  status: 'available' | 'disabled' | 'error'
  calls: number
  avgLatency: number
  lastUsed: string
  icon: React.ReactNode
}

const tools: Tool[] = [
  {
    id: 'web_search',
    name: 'Web Search',
    description: 'Search the web for information',
    category: 'web',
    status: 'available',
    calls: 1247,
    avgLatency: 234,
    lastUsed: '2m ago',
    icon: <Search className="w-5 h-5" />,
  },
  {
    id: 'file_read',
    name: 'File Read',
    description: 'Read files from the virtual filesystem',
    category: 'code',
    status: 'available',
    calls: 892,
    avgLatency: 12,
    lastUsed: '5m ago',
    icon: <FileCode className="w-5 h-5" />,
  },
  {
    id: 'file_write',
    name: 'File Write',
    description: 'Write files to the virtual filesystem',
    category: 'code',
    status: 'available',
    calls: 456,
    avgLatency: 8,
    lastUsed: '8m ago',
    icon: <FileCode className="w-5 h-5" />,
  },
  {
    id: 'database_query',
    name: 'Database Query',
    description: 'Execute database queries',
    category: 'data',
    status: 'available',
    calls: 234,
    avgLatency: 45,
    lastUsed: '15m ago',
    icon: <Database className="w-5 h-5" />,
  },
  {
    id: 'http_request',
    name: 'HTTP Request',
    description: 'Make HTTP requests to external APIs',
    category: 'web',
    status: 'available',
    calls: 567,
    avgLatency: 189,
    lastUsed: '3m ago',
    icon: <Globe className="w-5 h-5" />,
  },
  {
    id: 'shell_exec',
    name: 'Shell Execute',
    description: 'Execute shell commands in sandbox',
    category: 'system',
    status: 'available',
    calls: 123,
    avgLatency: 156,
    lastUsed: '20m ago',
    icon: <Terminal className="w-5 h-5" />,
  },
  {
    id: 'secrets_get',
    name: 'Secrets Manager',
    description: 'Retrieve secrets from vault',
    category: 'system',
    status: 'available',
    calls: 45,
    avgLatency: 5,
    lastUsed: '1h ago',
    icon: <Shield className="w-5 h-5" />,
  },
  {
    id: 'image_gen',
    name: 'Image Generation',
    description: 'Generate images using AI',
    category: 'ai',
    status: 'disabled',
    calls: 0,
    avgLatency: 0,
    lastUsed: 'Never',
    icon: <Image className="w-5 h-5" />,
  },
  {
    id: 'code_exec',
    name: 'Code Execution',
    description: 'Execute code in sandboxed environment',
    category: 'code',
    status: 'available',
    calls: 89,
    avgLatency: 234,
    lastUsed: '30m ago',
    icon: <Calculator className="w-5 h-5" />,
  },
  {
    id: 'email_send',
    name: 'Email Send',
    description: 'Send emails via SMTP',
    category: 'web',
    status: 'error',
    calls: 12,
    avgLatency: 0,
    lastUsed: '2h ago',
    icon: <Mail className="w-5 h-5" />,
  },
  {
    id: 'cloud_storage',
    name: 'Cloud Storage',
    description: 'Interact with cloud storage providers',
    category: 'data',
    status: 'available',
    calls: 234,
    avgLatency: 78,
    lastUsed: '10m ago',
    icon: <Cloud className="w-5 h-5" />,
  },
]

const categoryColors: Record<Tool['category'], string> = {
  web: 'text-blue-400 bg-blue-400/10',
  code: 'text-green-400 bg-green-400/10',
  data: 'text-purple-400 bg-purple-400/10',
  system: 'text-orange-400 bg-orange-400/10',
  ai: 'text-pink-400 bg-pink-400/10',
}

export default function ToolRegistry() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredTools = tools.filter(tool => {
    const matchesCategory = !selectedCategory || tool.category === selectedCategory
    const matchesSearch = !searchQuery || 
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  const categories = Array.from(new Set(tools.map(t => t.category)))

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-black/30 border border-gray-800 rounded-lg text-sm focus:outline-none focus:border-nebula-primary"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              !selectedCategory 
                ? 'bg-nebula-primary text-white' 
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors ${
                selectedCategory === cat 
                  ? 'bg-nebula-primary text-white' 
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Tools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTools.map(tool => (
          <div 
            key={tool.id}
            className="card-glass rounded-xl p-4 hover:border-nebula-primary/50 transition-colors"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`p-2 rounded-lg ${categoryColors[tool.category]}`}>
                {tool.icon}
              </div>
              <div className="flex items-center gap-1">
                {tool.status === 'available' && (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                )}
                {tool.status === 'disabled' && (
                  <XCircle className="w-4 h-4 text-gray-500" />
                )}
                {tool.status === 'error' && (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <button className="p-1 hover:bg-white/5 rounded ml-1">
                  <MoreHorizontal className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            </div>

            <h4 className="font-medium text-sm mb-1">{tool.name}</h4>
            <p className="text-xs text-gray-500 mb-3">{tool.description}</p>

            <div className="flex items-center justify-between text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {tool.lastUsed}
              </span>
              <span className="flex items-center gap-1">
                <Wrench className="w-3 h-3" />
                {tool.calls.toLocaleString()} calls
              </span>
            </div>

            {tool.status === 'available' && tool.avgLatency > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-800 text-xs text-gray-500">
                Avg latency: {tool.avgLatency}ms
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="card-glass rounded-xl p-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-gray-400">Total Tools: </span>
              <span className="font-medium">{tools.length}</span>
            </div>
            <div>
              <span className="text-gray-400">Available: </span>
              <span className="font-medium text-green-400">
                {tools.filter(t => t.status === 'available').length}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Disabled: </span>
              <span className="font-medium text-gray-400">
                {tools.filter(t => t.status === 'disabled').length}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Errors: </span>
              <span className="font-medium text-red-400">
                {tools.filter(t => t.status === 'error').length}
              </span>
            </div>
          </div>
          <div className="text-gray-500">
            Total calls today: {tools.reduce((acc, t) => acc + t.calls, 0).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  )
}
