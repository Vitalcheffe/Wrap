'use client'

import { useEffect, useRef, useState } from 'react'
import { 
  TrendingUp, 
  TrendingDown, 
  Activity,
  Clock,
  Target,
  BarChart3
} from 'lucide-react'

interface MetricsPanelProps {
  stats: {
    totalRequests: number
    successRate: number
    avgLatency: number
    activeAgents: number
    memoryUsage: number
    cpuUsage: number
  }
}

interface DataPoint {
  time: number
  value: number
}

export default function MetricsPanel({ stats }: MetricsPanelProps) {
  const [chartData, setChartData] = useState<DataPoint[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // Generate initial chart data
    const now = Date.now()
    const initialData = Array.from({ length: 20 }, (_, i) => ({
      time: now - (19 - i) * 3000,
      value: 80 + Math.random() * 40,
    }))
    setChartData(initialData)
  }, [])

  useEffect(() => {
    // Update chart data periodically
    const interval = setInterval(() => {
      setChartData(prev => {
        const newData = [...prev.slice(1), {
          time: Date.now(),
          value: 80 + Math.random() * 40,
        }]
        return newData
      })
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Draw chart on canvas
    const canvas = canvasRef.current
    if (!canvas || chartData.length < 2) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = width * window.devicePixelRatio
    canvas.height = height * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    // Clear canvas
    ctx.clearRect(0, 0, width, height)

    // Draw grid
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.1)'
    ctx.lineWidth = 1
    for (let i = 0; i < 5; i++) {
      const y = (height / 5) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    // Draw line chart
    const values = chartData.map(d => d.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)')
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0)')

    ctx.beginPath()
    ctx.moveTo(0, height)

    chartData.forEach((point, i) => {
      const x = (width / (chartData.length - 1)) * i
      const y = height - ((point.value - min) / range) * height * 0.8 - height * 0.1
      if (i === 0) {
        ctx.lineTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })

    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()

    // Draw line
    ctx.beginPath()
    chartData.forEach((point, i) => {
      const x = (width / (chartData.length - 1)) * i
      const y = height - ((point.value - min) / range) * height * 0.8 - height * 0.1
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.strokeStyle = '#6366f1'
    ctx.lineWidth = 2
    ctx.stroke()

    // Draw end point
    const lastPoint = chartData[chartData.length - 1]
    const lastX = width
    const lastY = height - ((lastPoint.value - min) / range) * height * 0.8 - height * 0.1
    ctx.beginPath()
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#6366f1'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(lastX, lastY, 8, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(99, 102, 241, 0.3)'
    ctx.fill()

  }, [chartData])

  return (
    <div className="card-glass rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-nebula-primary" />
          Performance Metrics
        </h3>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="flex items-center gap-1">
            <TrendingUp className="w-4 h-4 text-green-400" />
            +15.3%
          </span>
          <span className="text-gray-600">vs last hour</span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative h-48 mb-4">
        <canvas 
          ref={canvasRef} 
          className="w-full h-full"
        />
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-800">
        <MetricItem
          icon={<Activity className="w-4 h-4" />}
          label="Requests/min"
          value="342"
          change="+12"
          positive
        />
        <MetricItem
          icon={<Target className="w-4 h-4" />}
          label="Success Rate"
          value={`${stats.successRate}%`}
          change="+0.2"
          positive
        />
        <MetricItem
          icon={<Clock className="w-4 h-4" />}
          label="Avg Latency"
          value={`${Math.round(stats.avgLatency)}ms`}
          change="-8"
          positive
        />
        <MetricItem
          icon={<TrendingUp className="w-4 h-4" />}
          label="Throughput"
          value="2.4k/s"
          change="+5"
          positive
        />
      </div>
    </div>
  )
}

function MetricItem({ 
  icon, 
  label, 
  value, 
  change, 
  positive 
}: { 
  icon: React.ReactNode
  label: string
  value: string
  change: string
  positive: boolean
}) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 text-gray-400 mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
      <div className={`text-xs ${positive ? 'text-green-400' : 'text-red-400'}`}>
        {positive ? '↑' : '↓'} {change}
      </div>
    </div>
  )
}
