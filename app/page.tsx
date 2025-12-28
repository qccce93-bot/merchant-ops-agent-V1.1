'use client'

/**
 * 口径来源：基于天池 UserBehavior 行为类型 pv/cart/fav/buy（demo 口径）
 * TODO: 后续可配置行业阈值
 */

import { useState, useRef, useEffect } from 'react'
import { RefreshCw, Upload, Mail, Phone, ArrowUp, ArrowDown, Info, X, FileText, Plus, Download, FileSpreadsheet, CheckCircle2, Copy, CheckCircle, XCircle, ChevronUp, ChevronDown } from 'lucide-react'
import * as XLSX from 'xlsx'

interface UserSegment {
  id: string
  name: string
  count: number
  change7d: number
  description: string  // 分层口径说明
}

interface FunnelStep {
  step: string
  value: number
  rate: number
}

interface Task {
  id: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  priorityReason?: string  // 优先级解释
  title: string
  segment: string  // 来源分层
  channel: 'push' | 'edm' | 'sms' | null
  copyTitle: string  // 文案标题
  copyContent: string  // 文案正文
  benefits: string[]  // 权益选项
  status: 'pending' | 'viewed' | 'executed' | 'ignored'  // 任务状态：待查看 → 已查看 → 已执行/已忽略
  isManuallyEdited: boolean  // 是否手动编辑过文案（已脱离 Agent 推荐）
  createdAt: string
  viewedAt?: string  // 查看时间
  executedAt?: string  // 执行时间
  ignoredAt?: string  // 忽略时间
}

export default function Home() {
  const [activeTab, setActiveTab] = useState('internal')
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [reachMethod, setReachMethod] = useState<'push' | 'edm' | 'sms' | null>(null)
  const [benefits, setBenefits] = useState<string[]>([])
  const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' })
  const [showTooltip, setShowTooltip] = useState<string | null>(null)
  
  // 导入数据 Modal 状态
  const [showImportModal, setShowImportModal] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [importedFileName, setImportedFileName] = useState<string | null>(null)
  const [importedHeaders, setImportedHeaders] = useState<string[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Agent 工作台状态
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [isWorkspaceCollapsed, setIsWorkspaceCollapsed] = useState(false)

  // 优先级评估规则
  const getPriorityForSegment = (segmentName: string): 'P0' | 'P1' | 'P2' | 'P3' => {
    switch (segmentName) {
      case '活跃低转化':
        return 'P0'
      case '加购未购买':
        return 'P0'
      case '收藏未购买':
        return 'P1'
      case '高价值低频次':
        return 'P1'
      case '高价值高频次':
        return 'P2'
      case '沉没流失':
        return 'P2'
      default:
        return 'P3'
    }
  }

  // 优先级解释
  const getPriorityReason = (segmentName: string, count: number): string => {
    switch (segmentName) {
      case '活跃低转化':
        return `用户规模大 × 流失风险高`
      case '加购未购买':
        return `用户规模大 × 转化潜力高`
      case '收藏未购买':
        return `用户规模中等 × 购买意愿待激活`
      case '高价值低频次':
        return `用户价值高 × 复购潜力大`
      case '高价值高频次':
        return `用户价值高 × 维护关系`
      case '沉没流失':
        return `用户规模中等 × 流失风险中等`
      default:
        return `用户规模${count > 1000 ? '大' : count > 500 ? '中等' : '小'}`
    }
  }


  // 页面加载时自动生成任务
  useEffect(() => {
    // 只在组件挂载时执行一次，生成初始任务
    const initialTasks: Task[] = userSegments.map(segment => {
      const priority = getPriorityForSegment(segment.name)
      const { title: copyTitle, content: copyContent } = generateCopyContent(segment.name, 'push', ['券'])
      
      const segmentData = userSegments.find(s => s.name === segment.name)
      return {
        id: `task-${segment.id}-${Date.now()}`,
        priority,
        priorityReason: getPriorityReason(segment.name, segmentData?.count || 0),
        title: `${segment.name}召回任务`,
        segment: segment.name,
        channel: 'push',
        copyTitle,
        copyContent,
        benefits: ['券'],
        status: 'pending',
        isManuallyEdited: false,
        createdAt: new Date().toLocaleString('zh-CN')
      }
    })
    
    setTasks(initialTasks)
    
    // 默认选中「活跃低转化」
    const activeLowConversionTask = initialTasks.find(t => t.segment === '活跃低转化')
    if (activeLowConversionTask) {
      setSelectedTaskId(activeLowConversionTask.id)
      // 标记为已查看
      setTasks(prev => prev.map(t => 
        t.id === activeLowConversionTask.id 
          ? { ...t, status: 'viewed', viewedAt: new Date().toLocaleString('zh-CN') }
          : t
      ))
    }
    
    // 自动展开工作台
    setIsWorkspaceCollapsed(false)
  }, []) // 只在组件挂载时执行一次

  // 小屏默认收起工作台
  useEffect(() => {
    const checkScreenSize = () => {
      if (window.innerWidth < 768) { // md breakpoint
        setIsWorkspaceCollapsed(true)
      }
    }
    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  // 字段定义
  const requiredFields = ['user_id', 'event_type', 'timestamp']
  const optionalFields = ['item_id', 'category_id', 'amount', 'channel']
  const allFields = [...requiredFields, ...optionalFields]

  // 字段说明数据
  const fieldDescriptions = [
    { field: 'user_id', type: '必填', description: '用户唯一标识' },
    { field: 'event_type', type: '必填', description: '行为类型：pv/cart/fav/buy' },
    { field: 'timestamp', type: '必填', description: '行为发生时间戳' },
    { field: 'item_id', type: '可选', description: '商品ID' },
    { field: 'category_id', type: '可选', description: '分类ID' },
    { field: 'amount', type: '可选', description: '金额' },
    { field: 'channel', type: '可选', description: '渠道' },
  ]

  // Mock 数据：用户分层列表
  const userSegments: UserSegment[] = [
    {
      id: '1',
      name: '收藏未购买',
      count: 1250,
      change7d: 5.9,
      description: '口径示例：近30天有收藏行为但未发生购买的用户（Demo 口径，可配置）'
    },
    {
      id: '2',
      name: '加购未购买',
      count: 3420,
      change7d: -3.9,
      description: '口径示例：近30天有加购行为但未发生购买的用户（Demo 口径，可配置）'
    },
    {
      id: '3',
      name: '沉没流失',
      count: 1890,
      change7d: -1.6,
      description: '口径示例：14天前活跃，近14天未活跃的用户（Demo 口径，可配置）'
    },
    {
      id: '4',
      name: '高价值低频次',
      count: 560,
      change7d: 7.7,
      description: '口径示例：近30天消费金额 top20%，但购买频次低于平均值的用户（Demo 口径，可配置）'
    },
    {
      id: '5',
      name: '高价值高频次',
      count: 890,
      change7d: 2.3,
      description: '口径示例：近30天消费金额 top20%，且购买频次高于平均值的用户（Demo 口径，可配置）'
    },
    {
      id: '6',
      name: '活跃低转化',
      count: 2340,
      change7d: -5.2,
      description: '口径示例：近30天浏览频次 top20%，但未产生购买的用户（Demo 口径，可配置）'
    },
  ]

  // Mock 数据：用户旅程漏斗
  const funnelSteps: FunnelStep[] = [
    { step: '首页', value: 10000, rate: 100 },
    { step: '浏览', value: 8500, rate: 85 },
    { step: '加购', value: 3200, rate: 32 },
    { step: '下单', value: 1800, rate: 18 },
    { step: '支付', value: 1650, rate: 16.5 },
  ]

  const showToast = (message: string) => {
    setToast({ show: true, message })
    setTimeout(() => setToast({ show: false, message: '' }), 3000)
  }

  const handleSegmentClick = (segmentId: string) => {
    const segment = userSegments.find(s => s.id === segmentId)
    if (!segment) return
    
    // 检查是否已有该分层的任务
    const existingTask = tasks.find(t => t.segment === segment.name && t.status !== 'ignored')
    if (existingTask) {
      // 如果任务已存在且未被忽略，直接选中
      setSelectedTaskId(existingTask.id)
      if (existingTask.status === 'pending') {
        // 标记为已查看
        setTasks(prev => prev.map(t => 
          t.id === existingTask.id 
            ? { ...t, status: 'viewed', viewedAt: new Date().toLocaleString('zh-CN') }
            : t
        ))
      }
      setIsWorkspaceCollapsed(false)
      // 滚动到工作台
      setTimeout(() => {
        const workspace = document.getElementById('agent-workspace')
        if (workspace) {
          workspace.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100)
      return
    }
    
    // 生成新任务
    const priority = getPriorityForSegment(segment.name)
    const { title: copyTitle, content: copyContent } = generateCopyContent(segment.name, 'push', ['券'])
    
    const segmentData = userSegments.find(s => s.name === segment.name)
    const newTask: Task = {
      id: `task-${Date.now()}`,
      priority,
      priorityReason: getPriorityReason(segment.name, segmentData?.count || 0),
      title: `${segment.name}召回任务`,
      segment: segment.name,
      channel: 'push',
      copyTitle,
      copyContent,
      benefits: ['券'],
      status: 'pending',
      isManuallyEdited: false,
      createdAt: new Date().toLocaleString('zh-CN')
    }
    
    setTasks([...tasks, newTask])
    setSelectedTaskId(newTask.id)
    setIsWorkspaceCollapsed(false)
    showToast(`已为${segment.name}生成任务`)
    
    // 滚动到工作台
    setTimeout(() => {
      const workspace = document.getElementById('agent-workspace')
      if (workspace) {
        workspace.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 100)
  }

  const handleReachMethodChange = (method: 'push' | 'edm' | 'sms') => {
    setReachMethod(method)
  }

  const handleBenefitToggle = (benefit: string) => {
    setBenefits(prev =>
      prev.includes(benefit)
        ? prev.filter(b => b !== benefit)
        : [...prev, benefit]
    )
  }

  const handleGenerateCopy = () => {
    const segment = userSegments.find(s => s.id === selectedSegmentId)
    showToast(`已生成${segment?.name}的召回文案模板（TODO: 实际生成逻辑）`)
  }

  // 文案生成：基于「分层 × 触达方式 × 权益组合」
  const generateCopyContent = (segmentName: string, channel: string, benefits: string[]): { title: string; content: string } => {
    const channelText = channel === 'push' ? 'Push推送' : channel === 'edm' ? '邮件' : '短信'
    
    // 根据权益组合生成不同的文案
    let benefitText = ''
    let benefitAction = ''
    
    if (benefits.includes('券')) {
      benefitText = '专属优惠券'
      benefitAction = '领取优惠券'
    } else if (benefits.includes('赠品')) {
      benefitText = '精美赠品'
      benefitAction = '领取赠品'
    } else if (benefits.includes('积分')) {
      benefitText = '积分奖励'
      benefitAction = '获取积分'
    } else if (benefits.includes('晒单分享奖励')) {
      benefitText = '分享奖励'
      benefitAction = '参与分享'
    }
    
    if (benefits.length > 1) {
      benefitText = benefits.join('、')
      benefitAction = '领取权益'
    }
    
    // 根据分层生成不同的文案风格
    let segmentGreeting = ''
    let segmentAction = ''
    
    if (segmentName.includes('活跃') || segmentName.includes('加购')) {
      segmentGreeting = '尊敬的活跃用户'
      segmentAction = '立即查看'
    } else if (segmentName.includes('高价值')) {
      segmentGreeting = '尊敬的高价值用户'
      segmentAction = '尊享权益'
    } else if (segmentName.includes('流失') || segmentName.includes('沉没')) {
      segmentGreeting = '亲爱的用户'
      segmentAction = '回归有礼'
    } else {
      segmentGreeting = '尊敬的客户'
      segmentAction = '查看详情'
    }
    
    return {
      title: `${segmentName}专属${benefitText || '权益'}活动`,
      content: `${segmentGreeting}，我们为您准备了${benefitText || '专属权益'}，${segmentAction}！${benefitAction ? `点击${benefitAction}，期待您的参与。` : '点击查看详情。'}`
    }
  }

  // 自动生成文案（当权益或触达方式改变时）
  const regenerateCopyForTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.isManuallyEdited) return // 如果已手动编辑，不自动更新
    
    const { title: copyTitle, content: copyContent } = generateCopyContent(
      task.segment,
      task.channel || 'push',
      task.benefits
    )
    
    setTasks(prev => prev.map(t => 
      t.id === taskId 
        ? { ...t, copyTitle, copyContent }
        : t
    ))
  }

  const handleAddTask = () => {
    if (!selectedSegmentId || !reachMethod) {
      showToast('请先选择分层和触达方式')
      return
    }

    const segment = userSegments.find(s => s.id === selectedSegmentId)
    if (!segment) return

    const { title: copyTitle, content: copyContent } = generateCopyContent(segment.name, reachMethod, benefits)

    const newTask: Task = {
      id: `task-${Date.now()}`,
      priority: 'P0',  // 默认P0
      title: `${segment.name}召回任务`,
      segment: segment.name,
      channel: reachMethod,
      copyTitle,
      copyContent,
      benefits: [...benefits],
      status: 'pending',
      isManuallyEdited: false,
      createdAt: new Date().toLocaleString('zh-CN')
    }

    setTasks([...tasks, newTask])
    setSelectedTaskId(newTask.id)
    showToast('任务已加入工作台')
    
    // 关闭Action面板
    setSelectedSegmentId(null)
    setReachMethod(null)
    setBenefits([])
  }

  // 工作台相关函数
  const handleTaskSelect = (taskId: string) => {
    setSelectedTaskId(taskId)
    // 如果任务状态是待查看，标记为已查看
    setTasks(prev => prev.map(t => 
      t.id === taskId && t.status === 'pending'
        ? { ...t, status: 'viewed', viewedAt: new Date().toLocaleString('zh-CN') }
        : t
    ))
  }

  const handleTaskUpdate = (field: keyof Task, value: any) => {
    if (!selectedTaskId) return
    
    const task = tasks.find(t => t.id === selectedTaskId)
    if (!task) return
    
    // 如果修改的是权益或触达方式，且未手动编辑过文案，则自动更新文案
    if ((field === 'benefits' || field === 'channel') && !task.isManuallyEdited) {
      const { title: copyTitle, content: copyContent } = generateCopyContent(
        task.segment,
        field === 'channel' ? (value || 'push') : (task.channel || 'push'),
        field === 'benefits' ? value : task.benefits
      )
      setTasks(tasks.map(t => 
        t.id === selectedTaskId 
          ? { ...t, [field]: value, copyTitle, copyContent }
          : t
      ))
    } 
    // 如果修改的是文案，标记为已手动编辑
    else if (field === 'copyTitle' || field === 'copyContent') {
      setTasks(tasks.map(t => 
        t.id === selectedTaskId 
          ? { ...t, [field]: value, isManuallyEdited: true }
          : t
      ))
    }
    // 其他字段正常更新
    else {
      setTasks(tasks.map(t => 
        t.id === selectedTaskId ? { ...t, [field]: value } : t
      ))
    }
  }

  const handleCopyCopy = async () => {
    const task = tasks.find(t => t.id === selectedTaskId)
    if (!task || !task.copyContent) {
      showToast('没有可复制的文案')
      return
    }

    try {
      await navigator.clipboard.writeText(task.copyContent)
      showToast('文案已复制到剪贴板')
    } catch (error) {
      showToast('复制失败，请手动复制')
      console.error('Copy failed:', error)
    }
  }

  // 执行任务
  const handleExecute = () => {
    if (!selectedTaskId) return
    setTasks(tasks.map(t => 
      t.id === selectedTaskId 
        ? { ...t, status: 'executed', executedAt: new Date().toLocaleString('zh-CN') } 
        : t
    ))
    showToast('任务已执行')
  }

  // 忽略任务（关闭）
  const handleIgnore = () => {
    if (!selectedTaskId) return
    setTasks(tasks.map(t => 
      t.id === selectedTaskId 
        ? { ...t, status: 'ignored', ignoredAt: new Date().toLocaleString('zh-CN') } 
        : t
    ))
    setSelectedTaskId(null)
    showToast('任务已忽略')
  }

  const getStatusBadge = (status: Task['status']) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">待查看</span>
      case 'viewed':
        return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">已查看</span>
      case 'executed':
        return <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">已执行</span>
      case 'ignored':
        return <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs font-medium">已忽略</span>
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">未知</span>
    }
  }

  const getPriorityBadge = (priority: Task['priority']) => {
    return priority === 'P0' 
      ? <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">P0</span>
      : <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium">P1</span>
  }

  const selectedTask = tasks.find(t => t.id === selectedTaskId)

  const handleFunnelClick = (step: string, nextStep: string) => {
    // 所有漏斗环节点击后都生成任务
    const segmentName = `${step}→${nextStep}流失用户`
    const priority = getPriorityForSegment(segmentName) || 'P2'
    const { title: copyTitle, content: copyContent } = generateCopyContent(segmentName, 'push', ['券'])
    
    const newTask: Task = {
      id: `task-${Date.now()}`,
      priority,
      priorityReason: getPriorityReason(segmentName, 0),
      title: `${step}→${nextStep}流失召回任务`,
      segment: segmentName,
      channel: 'push',
      copyTitle,
      copyContent,
      benefits: ['券'],
      status: 'pending',
      isManuallyEdited: false,
      createdAt: new Date().toLocaleString('zh-CN')
    }
    
    setTasks([...tasks, newTask])
    setSelectedTaskId(newTask.id)
    setIsWorkspaceCollapsed(false)
    showToast(`已生成${step}→${nextStep}流失召回任务`)
    
    // 滚动到工作台
    setTimeout(() => {
      const workspace = document.getElementById('agent-workspace')
      if (workspace) {
        workspace.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 100)
  }

  // 导入数据相关函数
  const downloadTemplate = () => {
    // 生成 CSV 模板（第一行是字段名）
    const csvContent = allFields.join(',') + '\n'
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', '数据导入模版.csv')
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const validateHeaders = (headers: string[]): string[] => {
    const missingFields = requiredFields.filter(field => !headers.includes(field))
    return missingFields
  }

  const parseCSVHeader = (text: string): string[] => {
    const lines = text.split('\n')
    if (lines.length === 0) return []
    const firstLine = lines[0].trim()
    // 处理 CSV 可能的引号和转义
    return firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  }

  const parseXLSXHeader = (file: File): Promise<string[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = e.target?.result
          const workbook = XLSX.read(data, { type: 'binary' })
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
          // 只读取第一行作为表头
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as any[][]
          if (jsonData.length === 0) {
            reject(new Error('文件为空'))
            return
          }
          const headers = jsonData[0].map((h: any) => String(h).trim()).filter((h: string) => h !== '')
          resolve(headers)
        } catch (error) {
          reject(error)
        }
      }
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.readAsBinaryString(file)
    })
  }

  const handleFile = async (file: File) => {
    setValidationErrors([])
    setImportedFileName(null)
    setImportedHeaders(null)

    const isCSV = file.name.endsWith('.csv')
    const isXLSX = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')

    if (!isCSV && !isXLSX) {
      showToast('请上传 CSV 或 XLSX 文件')
      return
    }

    try {
      let headers: string[] = []

      if (isCSV) {
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (e) => resolve(e.target?.result as string)
          reader.onerror = () => reject(new Error('文件读取失败'))
          reader.readAsText(file)
        })
        headers = parseCSVHeader(text)
      } else {
        headers = await parseXLSXHeader(file)
      }

      // 校验表头
      const missingFields = validateHeaders(headers)
      if (missingFields.length > 0) {
        setValidationErrors(missingFields)
        showToast('表头校验失败，请检查缺少的字段')
        return
      }

      // 校验成功
      setImportedFileName(file.name)
      setImportedHeaders(headers)
      showToast(`已导入：${file.name}`)
    } catch (error) {
      showToast('文件解析失败，请检查文件格式')
      console.error('File parse error:', error)
    }
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0])
    }
  }

  const selectedSegment = userSegments.find(s => s.id === selectedSegmentId)

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-gray-50/50 to-slate-50/30">
      {/* Header - 深蓝海洋渐变（水波感，不偏绿） */}
      <header className="relative bg-gradient-to-r from-blue-700 via-blue-600 to-blue-800 text-white shadow-lg overflow-hidden">
        {/* 水波/光晕效果 */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-400/30 via-transparent to-blue-900/30"></div>
          <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-blue-400/20 rounded-full blur-3xl"></div>
          <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl"></div>
        </div>

        <div className="relative container mx-auto px-6 py-4 flex items-center justify-between">
          {/* 左侧：标题 */}
          <div className="flex items-center gap-6">
            <h1 className="text-2xl font-bold">商家经营分析 Copilot</h1>
          </div>

          {/* 右侧：控制栏 */}
          <div className="flex items-center gap-4">
            {/* 商家ID Select */}
            <select className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/50 text-sm">
              <option value="" className="text-gray-900">选择商家ID</option>
              <option value="1" className="text-gray-900">商家001</option>
              <option value="2" className="text-gray-900">商家002</option>
            </select>

            {/* 时间 Range */}
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg px-4 py-2">
              <input
                type="date"
                className="bg-transparent text-white placeholder-white/70 focus:outline-none text-sm w-32"
                placeholder="开始日期"
              />
              <span className="text-white/70">至</span>
              <input
                type="date"
                className="bg-transparent text-white placeholder-white/70 focus:outline-none text-sm w-32"
                placeholder="结束日期"
              />
            </div>

            {/* 刷新按钮 */}
            <button type="button" className="bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20 rounded-lg px-4 py-2 flex items-center gap-2 transition-colors text-sm">
              <RefreshCw className="w-4 h-4" />
              <span>刷新</span>
            </button>

            {/* 导入数据按钮 */}
            <button 
              type="button"
              onClick={() => setShowImportModal(true)}
              className="bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20 rounded-lg px-4 py-2 flex items-center gap-2 transition-colors text-sm"
            >
              <Upload className="w-4 h-4" />
              <span>导入数据</span>
            </button>
          </div>
        </div>
      </header>

      {/* Tabs 区域 */}
      <main className="container mx-auto px-6 py-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          {/* Tabs 导航 */}
          <div className="border-b border-gray-200">
            <div className="flex">
              <button
                type="button"
                onClick={() => setActiveTab('internal')}
                className={`px-6 py-4 font-medium transition-colors ${
                  activeTab === 'internal'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                站内运营 Agent
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('external')}
                className={`px-6 py-4 font-medium transition-colors ${
                  activeTab === 'external'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                站外增长选品 Agent
              </button>
            </div>
          </div>

          {/* Tab 内容区域 */}
          <div className="p-4">
            {activeTab === 'internal' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 左侧卡片：用户分层列表 */}
                <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200">
                  <h2 className="text-lg font-semibold text-gray-800 mb-2">用户分层列表</h2>
                  <p className="text-sm text-gray-400 mb-3">生命周期按「近期活跃度 × 历史购买价值」划分，用于判断是否触达及触达方式。</p>
                  <div className="space-y-2">
                    {userSegments.map((segment) => {
                      const isSelected = selectedSegmentId === segment.id
                      return (
                        <div
                          key={segment.id}
                          onClick={() => handleSegmentClick(segment.id)}
                          className={`p-3 rounded-lg border cursor-pointer transition-all ${
                            isSelected
                              ? 'border-blue-500 border-2 bg-blue-50 shadow-sm'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-medium text-gray-800">{segment.name}</span>
                                <div
                                  className="relative"
                                  onMouseEnter={() => setShowTooltip(segment.id)}
                                  onMouseLeave={() => setShowTooltip(null)}
                                >
                                  <Info className="w-4 h-4 text-gray-400 hover:text-blue-500 cursor-help" />
                                  {showTooltip === segment.id && (
                                    <div className="absolute left-0 top-6 z-50 w-64 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-lg">
                                      {segment.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-600">
                                  人数：<span className="font-medium text-gray-900">{segment.count.toLocaleString()}</span>
                                </span>
                                <div className="flex items-center gap-1">
                                  {segment.change7d > 0 ? (
                                    <>
                                      <ArrowUp className="w-4 h-4 text-red-500" />
                                      <span className="text-sm text-red-500 font-medium">+{segment.change7d.toFixed(1)}%</span>
                                    </>
                                  ) : (
                                    <>
                                      <ArrowDown className="w-4 h-4 text-green-500" />
                                      <span className="text-sm text-green-500 font-medium">{segment.change7d.toFixed(1)}%</span>
                                    </>
                                  )}
                                  <span className="text-xs text-gray-500 ml-1">7天</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 右侧卡片：用户旅程漏斗 */}
                <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200">
                  <h2 className="text-lg font-semibold text-gray-800 mb-3">用户旅程漏斗</h2>
                  <div className="space-y-3">
                    {funnelSteps.map((item, index) => {
                      const nextItem = funnelSteps[index + 1]
                      const isClickable = item.step === '加购' && nextItem?.step === '下单'
                      
                      return (
                        <div key={index}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-700">{item.step}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-gray-600">{item.value.toLocaleString()}</span>
                              <span className="text-xs text-gray-500">({item.rate}%)</span>
                            </div>
                          </div>
                          <div className="relative">
                            <div
                              className={`h-8 bg-gradient-to-r from-blue-500 to-blue-600 rounded-md transition-all ${
                                isClickable ? 'cursor-pointer hover:from-blue-600 hover:to-blue-700' : ''
                              }`}
                              style={{ width: `${item.rate}%` }}
                              onClick={() => isClickable && handleFunnelClick(item.step, nextItem.step)}
                            />
                          </div>
                          {nextItem && (
                            <div className="flex items-center justify-center py-1">
                              <ArrowDown className="w-4 h-4 text-gray-400" />
                              <span className="text-xs text-gray-400 ml-1">
                                {((item.value - nextItem.value) / item.value * 100).toFixed(1)}% 流失
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'external' && (
              <div className="text-gray-600">
                <p>站外增长选品 Agent 内容区域</p>
                <p className="text-sm text-gray-400 mt-2">（内容待实现）</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Agent 工作台 - 放在内容区域下方 */}
        <div id="agent-workspace" className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200">
          <div className="px-4 py-3 flex-shrink-0 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Agent 工作台</h3>
              {!isWorkspaceCollapsed && (
                <p className="text-xs text-gray-500 mt-0.5">Agent 已生成的可执行结果</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsWorkspaceCollapsed(!isWorkspaceCollapsed)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              title={isWorkspaceCollapsed ? '展开' : '最小化'}
            >
              {isWorkspaceCollapsed ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
          {isWorkspaceCollapsed && (
            <p className="text-xs text-gray-500 mt-1">
              {tasks.filter(t => t.status !== 'ignored').length > 0 
                ? `共 ${tasks.filter(t => t.status !== 'ignored').length} 个任务，${tasks.filter(t => t.status === 'pending' || t.status === 'viewed').length} 个待处理` 
                : '暂无任务'}
            </p>
          )}
          </div>
          {!isWorkspaceCollapsed && (
            <div className="px-4 py-4 flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 overflow-hidden mb-2">
            {/* 左侧：任务列表 */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* 提示信息 */}
              <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                <p className="font-medium">💡 Agent 建议</p>
                <p className="mt-1">以下为 Agent 基于用户生命周期生成的运营建议，您可以选择执行或忽略。这是建议，而非强制执行。</p>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {tasks.filter(t => t.status !== 'ignored').length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm font-medium text-gray-500">暂无任务</p>
                    <p className="text-xs mt-2 text-gray-400">所有任务已处理完成</p>
                  </div>
                ) : (
                  tasks
                    .filter(t => t.status !== 'ignored')
                    .sort((a, b) => {
                      // 按优先级排序：P0 > P1 > P2 > P3
                      const priorityOrder = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3 }
                      return priorityOrder[a.priority] - priorityOrder[b.priority]
                    })
                    .map((task) => {
                    const isSelected = selectedTaskId === task.id
                    return (
                      <div
                        key={task.id}
                        onClick={() => handleTaskSelect(task.id)}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-blue-600 border-2 bg-white shadow-md'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            {getPriorityBadge(task.priority)}
                            {getStatusBadge(task.status)}
                          </div>
                        </div>
                        <h4 className="font-medium text-gray-800 text-sm mb-0.5">{task.title}</h4>
                        {task.priorityReason && (
                          <p className="text-xs text-gray-500 mb-1">{task.priority} · {task.priorityReason}</p>
                        )}
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>{task.segment}</span>
                          <span>•</span>
                          <span>{task.channel === 'push' ? 'Push' : task.channel === 'edm' ? 'EDM' : '短信'}</span>
                          <span>•</span>
                          <span className="truncate">{task.createdAt}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* 右侧：编辑区 */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-lg p-4">
              {selectedTask ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                  {/* 标题 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">任务标题</label>
                    <input
                      type="text"
                      value={selectedTask.title}
                      onChange={(e) => handleTaskUpdate('title', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>

                  {/* 触达方式 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">触达方式</label>
                    <div className="flex gap-2">
                      {(['push', 'edm', 'sms'] as const).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => handleTaskUpdate('channel', method)}
                          className={`flex-1 px-4 py-2 rounded-lg border transition-all text-sm ${
                            selectedTask.channel === method
                              ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                              : 'border-gray-200 hover:border-gray-300 text-gray-700'
                          }`}
                        >
                          {method === 'push' ? 'Push' : method === 'edm' ? 'EDM' : '短信'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 权益选择 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">运营权益策略（将直接影响文案）</label>
                    <div className="grid grid-cols-2 gap-2">
                      {['券', '赠品', '积分', '晒单分享奖励'].map((benefit) => (
                        <button
                          key={benefit}
                          type="button"
                          onClick={() => {
                            const newBenefits = selectedTask.benefits.includes(benefit)
                              ? selectedTask.benefits.filter(b => b !== benefit)
                              : [...selectedTask.benefits, benefit]
                            handleTaskUpdate('benefits', newBenefits)
                          }}
                          className={`px-4 py-2 rounded-lg border transition-all text-sm ${
                            selectedTask.benefits.includes(benefit)
                              ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                              : 'border-gray-200 hover:border-gray-300 text-gray-700'
                          }`}
                        >
                          {benefit}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 文案标题 */}
                  <div>
                    <div className="mb-1.5 p-2 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600">
                      {selectedTask.isManuallyEdited ? (
                        <span className="text-orange-600">⚠️ 已脱离 Agent 推荐</span>
                      ) : (
                        <span>当前文案由 Agent 根据【{selectedTask.segment} × {selectedTask.channel === 'push' ? 'Push' : selectedTask.channel === 'edm' ? 'EDM' : '短信'} × {selectedTask.benefits.join('、')}】生成</span>
                      )}
                    </div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">文案标题</label>
                    <input
                      type="text"
                      value={selectedTask.copyTitle}
                      onChange={(e) => handleTaskUpdate('copyTitle', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>

                  {/* 文案正文 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">文案正文</label>
                    <textarea
                      value={selectedTask.copyContent}
                      onChange={(e) => handleTaskUpdate('copyContent', e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none"
                    />
                  </div>
                    <div className="grid grid-cols-2 gap-2">
                      {['券', '赠品', '积分', '晒单分享奖励'].map((benefit) => (
                        <button
                          key={benefit}
                          type="button"
                          onClick={() => {
                            const newBenefits = selectedTask.benefits.includes(benefit)
                              ? selectedTask.benefits.filter(b => b !== benefit)
                              : [...selectedTask.benefits, benefit]
                            handleTaskUpdate('benefits', newBenefits)
                          }}
                          className={`px-4 py-2 rounded-lg border transition-all text-sm ${
                            selectedTask.benefits.includes(benefit)
                              ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                              : 'border-gray-200 hover:border-gray-300 text-gray-700'
                          }`}
                        >
                          {benefit}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 底部操作按钮 - 固定在工作台内部底部 */}
                  <div className="sticky bottom-0 bg-white pt-3 pb-2 border-t border-gray-200 mt-3 -mx-4 px-4">
                    <div className="flex flex-col gap-2">
                      {/* 复制文案主按钮 */}
                      <button
                        type="button"
                        onClick={handleCopyCopy}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
                      >
                        <Copy className="w-4 h-4" />
                        <span>复制文案</span>
                      </button>
                      {/* 执行/忽略并排 */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleIgnore}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors text-sm border border-gray-200"
                          disabled={selectedTask?.status === 'executed' || selectedTask?.status === 'ignored'}
                        >
                          <XCircle className="w-4 h-4" />
                          <span>忽略</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleExecute}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg transition-colors text-sm border border-green-200"
                          disabled={selectedTask?.status === 'executed' || selectedTask?.status === 'ignored'}
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>执行</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-center text-gray-400">
                    <FileText className="w-12 h-12 mx-auto mb-3" />
                    <p>请从左侧选择一个任务进行编辑</p>
                  </div>
                </div>
              )}
            </div>
            </div>
            {/* 页面底部说明文字 */}
            <div className="flex-shrink-0 mt-2 pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-400 text-center">数据来源：阿里天池开源数据集（UserBehavior），仅用于展示 Agent 决策流程与交互方式。</p>
            </div>
            </div>
          )}
        </div>
      </main>

      {/* Toast 提示 */}
      {toast.show && (
        <div className="fixed top-6 right-6 bg-slate-800 text-white px-6 py-4 rounded-lg shadow-xl flex items-center gap-3 z-50 transition-all duration-300">
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast({ show: false, message: '' })}
            className="text-white/70 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 导入数据 Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal 头部 */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-800">导入数据</h2>
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false)
                  setValidationErrors([])
                  setImportedFileName(null)
                  setImportedHeaders(null)
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal 内容 */}
            <div className="p-6 space-y-6">
              {/* 字段说明表格 */}
              <div>
                <h3 className="text-lg font-medium text-gray-800 mb-4">字段说明</h3>
                <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-200">
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">字段名</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">类型</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldDescriptions.map((item, index) => (
                        <tr key={index} className="border-b border-gray-100 last:border-0">
                          <td className="py-3 px-4 text-sm text-gray-800 font-mono">{item.field}</td>
                          <td className="py-3 px-4 text-sm">
                            <span className={`px-2 py-1 rounded text-xs ${
                              item.type === '必填' 
                                ? 'bg-red-100 text-red-700' 
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {item.type}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600">{item.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 下载模板按钮 */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>下载 Excel 模版</span>
                </button>
              </div>

              {/* 拖拽上传区 */}
              <div>
                <h3 className="text-lg font-medium text-gray-800 mb-4">上传文件</h3>
                <div
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                    dragActive
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                  }`}
                >
                  <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p className="text-gray-700 mb-2">
                    拖拽文件到此处或 <span className="text-blue-600 font-medium">点击上传</span>
                  </p>
                  <p className="text-sm text-gray-500">支持 .csv 和 .xlsx 格式</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </div>
              </div>

              {/* 校验成功提示 */}
              {importedFileName && importedHeaders && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-green-800">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">已导入：{importedFileName}</span>
                  </div>
                  <p className="text-sm text-green-700 mt-2">
                    表头字段：{importedHeaders?.join(', ') || ''}
                  </p>
                </div>
              )}

              {/* 表头校验报错 */}
              {validationErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-red-800 mb-2">表头校验失败</h4>
                  <p className="text-sm text-red-700 mb-2">缺少字段：</p>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((field, index) => (
                      <li key={index} className="text-sm text-red-600 font-medium font-mono">{field}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 右下角 Demo 水印（低对比、半透明浅蓝灰） */}
      <div className="fixed right-0 bottom-0 bg-slate-200/60 backdrop-blur-sm text-slate-600 px-3 py-2 rounded-tl-lg shadow-sm flex items-center gap-2 text-xs z-50">
        <span>联系作者</span>
        <span>·</span>
        <span>myrawzm0406@163.com</span>
        <span>·</span>
        <span>微信 15301052620</span>
      </div>
    </div>
  )
}
