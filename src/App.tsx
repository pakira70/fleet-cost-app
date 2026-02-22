import { useState, useEffect, useRef } from 'react'
import LZString from 'lz-string'
import { Share2, Download, MoreHorizontal, SlidersHorizontal, Settings2, Pencil, Copy, RotateCcw, Trash2 } from 'lucide-react'

interface TodayInputs {
  totalVehicles: number
  nonRegisteredVehicles: number
  baselineAnnualPurchase: number
  baselineResale: number
  fuelAnnual: number
  insurance: number
  maintenance: number
  registration: number
  outsideRental: number
  planon: number
  labor: number
  telematics: number
}

interface Scenario {
  id: string
  name: string
  totalVehicles: number
  nonRegisteredVehicles: number
  strategicSavings: number
  resale: number
  lifecycle: number
}

interface FleetMixType {
  name: string
  share: number
  unitCost: number
}

interface FutureAssumptions {
  serviceLifeYears: number
  fleetMix: FleetMixType[]
  fuelEfficiency: number
  laborAnnual: number
  telematicsCostPerVehicle: number
  planonAnnual: number
  avgVehiclePrice: number
}

// ----- Share / URL state (no backend) -----
const SHARE_STATE_VERSION = 1
const WORKSPACE_STORAGE_KEY = 'fleet-cost-app-workspace'
const SHARED_SESSION_KEY = 'fleet-cost-app-shared-session'
const STATE_PARAM = 'state'

/** Returns the canonical root URL (no state param in hash or query). */
function getCanonicalRootUrl(): string {
  const sp = new URLSearchParams(window.location.search)
  sp.delete(STATE_PARAM)
  const query = sp.toString()
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ''}`
}

interface SerializableState {
  todayInputs: TodayInputs
  futureAssumptions: FutureAssumptions
  scenarios: Scenario[]
  selectedScenarioIndex: number
  viewingBaseline: boolean
}

interface SharePayload {
  v: number
  state: SerializableState
}

const defaultTodayInputs: TodayInputs = {
  totalVehicles: 650,
  nonRegisteredVehicles: 50,
  baselineAnnualPurchase: 1844207,
  baselineResale: 15700,
  fuelAnnual: 859634,
  insurance: 585796,
  maintenance: 874086,
  registration: 100000,
  outsideRental: 0,
  planon: 0,
  labor: 150000,
  telematics: 195000,
}

const defaultFleetMix: FleetMixType[] = [
  { name: 'SUV', share: 20, unitCost: 45000 },
  { name: 'Cargo Van', share: 25, unitCost: 55000 },
  { name: 'Pickup', share: 20, unitCost: 44000 },
  { name: 'Box Truck', share: 20, unitCost: 62500 },
  { name: 'Kubota / ATV', share: 15, unitCost: 17500 },
]

const defaultFutureAssumptions: FutureAssumptions = {
  serviceLifeYears: 7,
  fleetMix: defaultFleetMix,
  fuelEfficiency: 0,
  laborAnnual: 323750,
  telematicsCostPerVehicle: 300,
  planonAnnual: 20000,
  avgVehiclePrice: 45000,
}

const DEFAULT_SCENARIO: Scenario = {
  id: '1',
  name: 'Scenario 1',
  totalVehicles: 650,
  nonRegisteredVehicles: 50,
  strategicSavings: 0,
  resale: 0,
  lifecycle: 7,
}

/** Tries to read encoded state from ?state=... or #state=...; returns payload or null. */
function parseStateFromUrl(): SharePayload | null {
  const tryDecode = (encoded: string | null): SharePayload | null => {
    if (!encoded) return null
    try {
      const json = LZString.decompressFromEncodedURIComponent(encoded)
      if (!json) return null
      const payload = JSON.parse(json) as SharePayload
      if (payload == null || typeof payload.v !== 'number' || payload.v !== SHARE_STATE_VERSION) return null
      if (payload.state == null || typeof payload.state !== 'object') return null
      return payload
    } catch {
      return null
    }
  }
  const fromQuery = new URLSearchParams(window.location.search).get(STATE_PARAM)
  const fromHash = (() => {
    const h = window.location.hash.slice(1)
    return h ? new URLSearchParams(h).get(STATE_PARAM) : null
  })()
  return tryDecode(fromQuery) ?? tryDecode(fromHash) ?? null
}

/** True if URL currently has a state param (query or hash). */
function urlHasStateParam(): boolean {
  if (new URLSearchParams(window.location.search).get(STATE_PARAM)) return true
  const h = window.location.hash.slice(1)
  return !!(h && new URLSearchParams(h).get(STATE_PARAM))
}

function loadSharedSessionFromStorage(): SharePayload | null {
  try {
    const raw = sessionStorage.getItem(SHARED_SESSION_KEY)
    if (!raw) return null
    const payload = JSON.parse(raw) as SharePayload
    if (payload?.v !== SHARE_STATE_VERSION || payload?.state == null) return null
    return payload
  } catch {
    return null
  }
}

function saveSharedSessionToStorage(payload: SharePayload): void {
  sessionStorage.setItem(SHARED_SESSION_KEY, JSON.stringify(payload))
}

function clearSharedSessionStorage(): void {
  sessionStorage.removeItem(SHARED_SESSION_KEY)
}

// ----- CSV export (no backend) -----
const APP_VERSION = '0.0.0'

function escapeCsvCell(val: string | number): string {
  const s = String(val)
  if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Currency for CSV: $1,844,207 or -$15,700 (thousands sep, no decimals, minus before $). No trailing spaces. */
function formatCurrencyForCsv(value: number): string {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(value)).trim()
  return (value < 0 ? `-${formatted}` : formatted).trim()
}

/** Currency delta for CSV: +$100,000 or -$50,000 or $0. No trailing spaces. */
function formatCurrencyDeltaForCsv(delta: number): string {
  if (delta === 0) return '$0'
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(delta)).trim()
  return (delta > 0 ? `+${formatted}` : `-${formatted}`).trim()
}

/** Integer for CSV: 650 or 2,310. Comma separators, no trailing spaces. */
function formatIntegerForCsv(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value).trim()
}

/** Percent for CSV: 0% or 15%. Consistent with UI. */
function formatPercentForCsv(value: number): string {
  return `${formatIntegerForCsv(value)}%`
}

// Utility functions for formatting
const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

const formatInteger = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

const formatPercent = (value: number): string => {
  return `${value}%`
}

/** Short currency for deltas: $331K, $2.9M, -$50K. */
function formatCurrencyShort(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`
  return `${sign}$${Math.round(abs)}`
}

// Unified numeric input: same size, padding, font, radius, and premium focus (Baseline + Future Assumptions + Primary Levers)
const inputNumericClass = 'h-7 w-20 min-w-20 max-w-20 px-1.5 py-0.5 text-right text-xs bg-white border border-gray-300 rounded-md transition-[border-color,box-shadow] duration-150 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:ring-offset-0 focus:outline-none'

// Compact lever row: label + value right, slider below; bubble above thumb, contained in slider wrapper (no overflow).
function LeverControl({
  label,
  value,
  displayString,
  formatBubble,
  min,
  max,
  step,
  disabled,
  isEditing,
  onSliderChange,
  onValueClick,
  onInputChange,
  onInputBlur,
  onInputKeyDown,
}: {
  label: string
  value: number
  displayString: string
  formatBubble: (v: number) => string
  min: number
  max: number
  step: number
  disabled: boolean
  isEditing: boolean
  onSliderChange: (v: number) => void
  onValueClick: () => void
  onInputChange: (s: string) => void
  onInputBlur: () => void
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, blur: () => void) => void
}) {
  const percent = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0
  const [showBubble, setShowBubble] = useState(false)
  return (
    <div className="py-2 border-b border-gray-100 last:border-b-0 min-w-0">
      <div className="w-full max-w-[420px] min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label className="text-xs font-medium text-gray-500 truncate">{label}</label>
          <div className="shrink-0 w-20 text-right">
            {isEditing ? (
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={displayString}
                onChange={(e) => onInputChange(e.target.value)}
                onBlur={onInputBlur}
                onKeyDown={(e) => onInputKeyDown(e, onInputBlur)}
                className="w-full px-1 py-0.5 text-right text-sm text-gray-900 border-b border-gray-300 rounded-none bg-transparent focus:outline-none focus:border-blue-500"
              />
            ) : (
              <button
                type="button"
                onClick={onValueClick}
                disabled={disabled}
                className="w-full text-right text-sm font-medium text-gray-900 tabular-nums rounded px-1 py-0.5 hover:bg-gray-100 focus:outline-none focus:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent cursor-text"
              >
                {displayString}
              </button>
            )}
          </div>
        </div>
        <div
          className="relative w-full min-w-0"
          onMouseEnter={() => setShowBubble(true)}
          onMouseLeave={() => setShowBubble(false)}
        >
          <div className="relative h-5 flex items-center">
            {showBubble && (
              <span
                className="absolute text-[11px] font-medium text-white bg-gray-800 rounded px-1.5 py-0.5 whitespace-nowrap shadow-sm pointer-events-none z-10 -top-5 transition-opacity"
                style={{ left: `${percent}%`, transform: 'translateX(-50%)' }}
              >
                {formatBubble(value)}
              </span>
            )}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => onSliderChange(Number(e.target.value))}
              onFocus={() => setShowBubble(true)}
              onBlur={() => setShowBubble(false)}
              disabled={disabled}
              className="w-full h-1.5 rounded-full appearance-none bg-gray-200 disabled:opacity-60 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:border-0"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// Reusable Control Component: label + input (value shown in input); optional slider below. No separate formatted span to avoid gap.
const NumberControl = ({ 
  label, 
  stringValue, 
  onChange, 
  onBlur, 
  min, 
  max, 
  step,
  showSlider = false,
  sliderValue,
  onSliderChange,
  handleKeyDown,
  containerClassName = '',
  inputClassName = inputNumericClass
}: {
  label: string
  value: number
  stringValue: string
  onChange: (value: string) => void
  onBlur: () => void
  min?: number
  max?: number
  step?: number
  showSlider?: boolean
  sliderValue?: number
  onSliderChange?: (value: number) => void
  suffix?: string
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, onBlur: () => void) => void
  formattedValue?: string
  containerClassName?: string
  inputClassName?: string
}) => (
  <div className={`space-y-1 ${containerClassName}`}>
    <label className="text-xs font-medium text-gray-600 block">{label}</label>
    <input
      type="text"
      inputMode="numeric"
      value={stringValue}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => handleKeyDown(e, onBlur)}
      placeholder="0"
      className={`${inputClassName} text-gray-800 placeholder:text-gray-400`}
    />
    {showSlider && sliderValue !== undefined && onSliderChange && (
      <input
        type="range"
        min={min ?? 0}
        max={max ?? 100}
        step={step ?? 1}
        value={sliderValue}
        onChange={(e) => onSliderChange(Number(e.target.value))}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
      />
    )}
  </div>
)

function App() {
  const [todayInputs, setTodayInputs] = useState<TodayInputs>({
    totalVehicles: 650,
    nonRegisteredVehicles: 50,
    baselineAnnualPurchase: 1844207,
    baselineResale: 15700,
    fuelAnnual: 859634,
    insurance: 585796,
    maintenance: 874086,
    registration: 100000,
    outsideRental: 0,
    planon: 0,
    labor: 150000,
    telematics: 195000,
  })

  // Single default scenario on fresh load; migration replaces legacy seed if loaded from storage
  const defaultScenario: Scenario = {
    id: '1',
    name: 'Scenario 1',
    totalVehicles: 650,
    nonRegisteredVehicles: 50,
    strategicSavings: 0,
    resale: 0,
    lifecycle: 7,
  }
  const legacySeedScenarios: Scenario[] = [
    { id: '1', name: 'Scenario 1', totalVehicles: 120, nonRegisteredVehicles: 60, strategicSavings: 10, resale: 30, lifecycle: 5 },
    { id: '2', name: 'Scenario 2', totalVehicles: 150, nonRegisteredVehicles: 75, strategicSavings: 15, resale: 35, lifecycle: 6 },
  ]
  /** Call when restoring scenarios from localStorage; replaces legacy 120/150 seed with single 650 default when applicable. */
  function migrateScenariosIfNeeded(loaded: Scenario[]): Scenario[] {
    if (loaded.length !== legacySeedScenarios.length) return loaded
    const match = loaded.every((s, i) => {
      const leg = legacySeedScenarios[i]
      return s.totalVehicles === leg.totalVehicles && s.nonRegisteredVehicles === leg.nonRegisteredVehicles &&
        s.strategicSavings === leg.strategicSavings && s.resale === leg.resale && s.lifecycle === leg.lifecycle
    })
    if (match) return [{ ...defaultScenario, id: loaded[0].id, name: loaded[0].name }]
    return loaded
  }
  const [scenarios, setScenarios] = useState<Scenario[]>(() => [defaultScenario])

  // Global Future Assumptions (applies to all scenarios)
  const [futureAssumptions, setFutureAssumptions] = useState<FutureAssumptions>({
    serviceLifeYears: 7,
    fleetMix: [
      { name: 'SUV', share: 20, unitCost: 45000 },
      { name: 'Cargo Van', share: 25, unitCost: 55000 },
      { name: 'Pickup', share: 20, unitCost: 44000 },
      { name: 'Box Truck', share: 20, unitCost: 62500 },
      { name: 'Kubota / ATV', share: 15, unitCost: 17500 },
    ],
    fuelEfficiency: 0,
    laborAnnual: 323750,
    telematicsCostPerVehicle: 300, // $25/vehicle/month = $300/vehicle/year
    planonAnnual: 20000,
    avgVehiclePrice: 45000,
  })

  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState(0)
  const [viewingBaseline, setViewingBaseline] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isFutureAssumptionsDrawerOpen, setIsFutureAssumptionsDrawerOpen] = useState(false)
  const [sharedMode, setSharedMode] = useState(false)

  // Local string state for Today inputs (formatted for display; allow raw typing during edit)
  const [todayInputStrings, setTodayInputStrings] = useState({
    totalVehicles: formatInteger(650),
    nonRegisteredVehicles: formatInteger(50),
    baselineAnnualPurchase: formatCurrency(1844207),
    baselineResale: formatCurrency(15700),
    fuelAnnual: formatCurrency(859634),
    insurance: formatCurrency(585796),
    maintenance: formatCurrency(874086),
    registration: formatCurrency(100000),
    outsideRental: formatCurrency(0),
    planon: formatCurrency(0),
    labor: formatCurrency(150000),
    telematics: formatCurrency(195000),
  })

  // Toast notification state with timer management
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false })
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Results visualization: which metric to show in bar chart (A = Total Program Cost, B = Cost/Vehicle/Month ex fuel)
  // Cost drivers section: default collapsed
  const [resultsViewMode, setResultsViewMode] = useState<'score' | 'costDrivers'>('score')

  const showToast = (message: string) => {
    // Clear existing timer if any
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }
    
    setToast({ message, visible: true })
    
    // Set new timer for 3.5 seconds
    toastTimerRef.current = setTimeout(() => {
      setToast({ message: '', visible: false })
      toastTimerRef.current = null
    }, 3500)
  }

  const exportState = (): SharePayload => ({
    v: SHARE_STATE_VERSION,
    state: {
      todayInputs,
      futureAssumptions,
      scenarios,
      selectedScenarioIndex,
      viewingBaseline,
    },
  })

  // Field bounds configuration for scenario fields (primary levers)
  const scenarioBounds = {
    totalVehicles: { min: 0, max: 3000, step: 10, type: 'integer' as const },
    nonRegisteredVehicles: { min: 0, max: (scenario: Scenario) => scenario.totalVehicles, step: 5, type: 'integer' as const },
    strategicSavings: { min: 0, max: 100, step: 1, type: 'percent' as const },
    resale: { min: 0, max: 100, step: 1, type: 'percent' as const },
    lifecycle: { min: 3, max: 20, step: 1, type: 'integer' as const },
  } as const

  // Field bounds configuration for future assumptions (global)
  const futureAssumptionBounds = {
    serviceLifeYears: { min: 1, max: 20, step: 1, type: 'integer' as const },
    fuelEfficiency: { min: 0, max: 50, step: 1, type: 'percent' as const },
    laborAnnual: { min: 0, max: 10000000, step: 1000, type: 'integer' as const },
    telematicsCostPerVehicle: { min: 0, max: 5000, step: 10, type: 'integer' as const },
    planonAnnual: { min: 0, max: 10000000, step: 1000, type: 'integer' as const },
    avgVehiclePrice: { min: 0, max: 500000, step: 1000, type: 'integer' as const },
  } as const

  // Shared update function with bounds enforcement for scenario fields
  const updateScenarioField = (field: FutureField, rawValue: number): { value: number; wasClamped: boolean; message?: string } => {
    if (!selectedScenario) return { value: rawValue, wasClamped: false }
    const bounds = scenarioBounds[field]
    const maxValue = typeof bounds.max === 'function' ? bounds.max(selectedScenario) : bounds.max
    
    const clampedValue = Math.max(bounds.min, Math.min(rawValue, maxValue))
    const wasClamped = clampedValue !== rawValue
    
    // Special handling for totalVehicles - auto-reduce golf carts if needed
    if (field === 'totalVehicles' && selectedScenario.nonRegisteredVehicles > clampedValue) {
      // This will be handled separately, but we still clamp totalVehicles
    }
    
    // Generate toast message if clamped
    let message: string | undefined
    if (wasClamped) {
      if (rawValue > maxValue) {
        const fieldName = field === 'nonRegisteredVehicles' ? 'Golf carts' : 
                         field === 'totalVehicles' ? 'Total vehicles' :
                         field === 'strategicSavings' ? 'Strategic savings' :
                         field === 'resale' ? 'Resale' :
                         field === 'lifecycle' ? 'Lifecycle years' : field
        message = `${fieldName} adjusted to ${clampedValue}${bounds.type === 'percent' ? '%' : ''} (maximum allowed).`
      } else if (rawValue < bounds.min) {
        const fieldName = field === 'nonRegisteredVehicles' ? 'Golf carts' : 
                         field === 'totalVehicles' ? 'Total vehicles' :
                         field === 'strategicSavings' ? 'Strategic savings' :
                         field === 'resale' ? 'Resale' :
                         field === 'lifecycle' ? 'Lifecycle years' : field
        message = `${fieldName} adjusted to ${clampedValue}${bounds.type === 'percent' ? '%' : ''} (minimum allowed).`
      }
    }
    
    return { value: clampedValue, wasClamped, message }
  }

  // Inline scenario rename state
  const [editingScenarioName, setEditingScenarioName] = useState<string | null>(null)
  const [editingScenarioNameValue, setEditingScenarioNameValue] = useState('')
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null)
  const [globalOverflowOpen, setGlobalOverflowOpen] = useState(false)
  const [editingLeverField, setEditingLeverField] = useState<'totalVehicles' | 'lifecycle' | 'strategicSavings' | 'resale' | null>(null)
  const leversSectionRef = useRef<HTMLDivElement>(null)

  // Local string state for Future inputs (allows empty during typing)
  // Keyed by scenario ID to maintain separate state per scenario (only primary levers)
  const [futureInputStringsMap, setFutureInputStringsMap] = useState<Record<string, {
    totalVehicles: string
    nonRegisteredVehicles: string
    strategicSavings: string
    resale: string
    lifecycle: string
  }>>({})

  // Local string state for Future Assumptions (formatted for display)
  const [futureAssumptionsStrings, setFutureAssumptionsStrings] = useState({
    serviceLifeYears: formatInteger(7),
    fuelEfficiency: formatPercent(0),
    laborAnnual: formatCurrency(323750),
    telematicsCostPerVehicle: formatCurrency(300),
    planonAnnual: formatCurrency(20000),
    avgVehiclePrice: formatCurrency(45000),
  })

  const selectedScenario = scenarios[selectedScenarioIndex]
  const baselineLeverValues = { totalVehicles: todayInputs.totalVehicles, nonRegisteredVehicles: todayInputs.nonRegisteredVehicles, strategicSavings: 0, resale: 0, lifecycle: 7 }
  // When viewingBaseline or no scenario selected, levers show baseline values
  const effectiveLeverScenario = (viewingBaseline || !selectedScenario) ? baselineLeverValues : selectedScenario

  type FutureInputStrings = {
    totalVehicles: string
    nonRegisteredVehicles: string
    strategicSavings: string
    resale: string
    lifecycle: string
  }

  const getFutureInputStrings = (): FutureInputStrings => {
    if (!selectedScenario) {
      return {
        totalVehicles: formatInteger(todayInputs.totalVehicles),
        nonRegisteredVehicles: formatInteger(todayInputs.nonRegisteredVehicles),
        strategicSavings: '0',
        resale: '0',
        lifecycle: '7',
      }
    }
    const defaults: FutureInputStrings = {
      totalVehicles: formatInteger(selectedScenario.totalVehicles),
      nonRegisteredVehicles: formatInteger(selectedScenario.nonRegisteredVehicles),
      strategicSavings: formatPercent(selectedScenario.strategicSavings),
      resale: formatPercent(selectedScenario.resale),
      lifecycle: formatInteger(selectedScenario.lifecycle),
    }
    const stored = futureInputStringsMap[selectedScenario.id]
    if (stored) return { ...defaults, ...stored }
    return defaults
  }

  const futureInputStrings = getFutureInputStrings()

  // Calculate derived avgVehicleCost from fleet mix (weighted average)
  const calculateAvgVehicleCost = (): number => {
    const totalShare = futureAssumptions.fleetMix.reduce((sum, type) => sum + type.share, 0)
    if (totalShare === 0) return 0
    const weightedSum = futureAssumptions.fleetMix.reduce((sum, type) => sum + (type.share / 100) * type.unitCost, 0)
    return Math.round(weightedSum)
  }

  const derivedAvgVehicleCost = calculateAvgVehicleCost()

  // ---------- Single source of truth: computed case (Baseline + each Scenario) ----------
  interface ScenarioCostBreakdown {
    purchase: number
    resale: number
    insurance: number
    registration: number
    maintenance: number
    telematics: number
    planon: number
    labor: number
    fuel: number
  }

  /** Sum of cost components: purchase - resale + all others. Matches Cost Drivers and defines totalProgramCostAnnual. */
  function sumBreakdown(b: ScenarioCostBreakdown): number {
    return b.purchase - b.resale + b.insurance + b.registration + b.maintenance + b.telematics + b.planon + b.labor + b.fuel
  }

  interface ComputedCase {
    totalProgramCostAnnual: number
    costPerVehPerMonthExFuel: number
    totalVehicles: number
    lifecycleYears: number | null
    breakdown: ScenarioCostBreakdown
  }

  /** Baseline: breakdown from todayInputs; total = sum(breakdown); cost/veh/mo ex fuel = (total - fuel) / vehicles / 12. */
  function getBaselineComputed(): ComputedCase {
    const breakdown: ScenarioCostBreakdown = {
      purchase: todayInputs.baselineAnnualPurchase,
      resale: todayInputs.baselineResale,
      insurance: todayInputs.insurance,
      registration: todayInputs.registration,
      maintenance: todayInputs.maintenance,
      telematics: todayInputs.telematics,
      planon: 0,
      labor: 0,
      fuel: todayInputs.fuelAnnual,
    }
    const totalProgramCostAnnual = sumBreakdown(breakdown)
    const costPerVehPerMonthExFuel =
      todayInputs.totalVehicles > 0
        ? (totalProgramCostAnnual - breakdown.fuel) / todayInputs.totalVehicles / 12
        : 0
    return {
      totalProgramCostAnnual,
      costPerVehPerMonthExFuel,
      totalVehicles: todayInputs.totalVehicles,
      lifecycleYears: null,
      breakdown,
    }
  }

  const baselineComputed = getBaselineComputed()

  function computeScenarioCosts(scenario: Scenario): {
    totalProgramCostAnnual: number
    costPerVehicleMonthExFuel: number
    breakdown: ScenarioCostBreakdown
    replacementVolume: number
    annualPurchase: number
    annualResale: number
  } {
    const lifecycleYears = Math.max(1, scenario.lifecycle)
    const replacementVolume = scenario.totalVehicles / lifecycleYears
    const avgVehicleCost = derivedAvgVehicleCost
    const purchaseReductionPct = scenario.strategicSavings / 100
    const resaleRecoveryPct = scenario.resale / 100

    const annualPurchase = replacementVolume * avgVehicleCost * (1 - purchaseReductionPct)
    const annualResale = replacementVolume * avgVehicleCost * resaleRecoveryPct

    const todayRegistered = Math.max(0, todayInputs.totalVehicles - todayInputs.nonRegisteredVehicles)
    const futureRegistered = Math.max(0, scenario.totalVehicles - scenario.nonRegisteredVehicles)

    const insuranceUnit = todayRegistered > 0 ? todayInputs.insurance / todayRegistered : 0
    const futureInsurance = insuranceUnit * futureRegistered

    const registrationUnit = todayRegistered > 0 ? todayInputs.registration / todayRegistered : 0
    const futureRegistration = registrationUnit * futureRegistered

    const maintenanceUnit = todayInputs.totalVehicles > 0 ? todayInputs.maintenance / todayInputs.totalVehicles : 0
    const futureMaintenance = maintenanceUnit * scenario.totalVehicles

    const futureTelematics = futureAssumptions.telematicsCostPerVehicle * scenario.totalVehicles
    const planonCost = futureAssumptions.planonAnnual
    const futureLaborAnnual = futureAssumptions.laborAnnual

    const futureFuel =
      todayInputs.totalVehicles > 0
        ? (todayInputs.fuelAnnual / todayInputs.totalVehicles) *
          scenario.totalVehicles *
          (1 - futureAssumptions.fuelEfficiency / 100)
        : 0

    const totalProgramCostAnnual =
      annualPurchase -
      annualResale +
      futureInsurance +
      futureRegistration +
      futureMaintenance +
      futureTelematics +
      planonCost +
      futureLaborAnnual +
      futureFuel

    const costPerVehicleMonthExFuel =
      scenario.totalVehicles > 0
        ? (totalProgramCostAnnual - futureFuel) / scenario.totalVehicles / 12
        : 0

    const breakdown: ScenarioCostBreakdown = {
      purchase: annualPurchase,
      resale: annualResale,
      insurance: futureInsurance,
      registration: futureRegistration,
      maintenance: futureMaintenance,
      telematics: futureTelematics,
      planon: planonCost,
      labor: futureLaborAnnual,
      fuel: futureFuel,
    }
    return {
      totalProgramCostAnnual,
      costPerVehicleMonthExFuel,
      breakdown,
      replacementVolume,
      annualPurchase,
      annualResale,
    }
  }

  /** Scenario: use breakdown from computeScenarioCosts; total = sum(breakdown) so Score and Cost Drivers match. */
  function getScenarioComputed(scenario: Scenario): ComputedCase {
    const raw = computeScenarioCosts(scenario)
    const totalProgramCostAnnual = sumBreakdown(raw.breakdown)
    const costPerVehPerMonthExFuel =
      scenario.totalVehicles > 0
        ? (totalProgramCostAnnual - raw.breakdown.fuel) / scenario.totalVehicles / 12
        : 0
    return {
      totalProgramCostAnnual,
      costPerVehPerMonthExFuel,
      totalVehicles: scenario.totalVehicles,
      lifecycleYears: scenario.lifecycle,
      breakdown: raw.breakdown,
    }
  }

  // Dev-only: assert sum(breakdown) matches total (within rounding)
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    const tol = 1
    const b = baselineComputed
    const sumB = sumBreakdown(b.breakdown)
    if (Math.abs(sumB - b.totalProgramCostAnnual) > tol) {
      console.warn('[dev] Baseline sum(breakdown) vs totalProgramCostAnnual mismatch', sumB, b.totalProgramCostAnnual)
    }
    scenarios.forEach((s) => {
      const c = getScenarioComputed(s)
      const sumC = sumBreakdown(c.breakdown)
      if (Math.abs(sumC - c.totalProgramCostAnnual) > tol) {
        console.warn('[dev] Scenario sum(breakdown) vs totalProgramCostAnnual mismatch', s.name, sumC, c.totalProgramCostAnnual)
      }
    })
  }

  function exportToCsv(): void {
    const rows: string[] = []
    const push = (cells: (string | number)[]) => {
      rows.push(cells.map(escapeCsvCell).join(','))
    }

    // Metadata
    push(['exported_at', new Date().toISOString()])
    push(['app_version', APP_VERSION])
    push([])

    // Future Assumptions (labels match UI)
    const faLabels: { key: keyof FutureAssumptions; label: string }[] = [
      { key: 'serviceLifeYears', label: 'Service life years' },
      { key: 'fuelEfficiency', label: 'Fuel efficiency (%)' },
      { key: 'laborAnnual', label: 'Labor annual' },
      { key: 'telematicsCostPerVehicle', label: 'Telematics cost per vehicle' },
      { key: 'planonAnnual', label: 'Planon (annual)' },
      { key: 'avgVehiclePrice', label: 'Avg vehicle price' },
    ]
    push(['Future Assumptions', 'Value'])
    faLabels.forEach(({ key, label }) => {
      const v = futureAssumptions[key]
      if (typeof v !== 'number') {
        push([label, Array.isArray(v) ? '' : String(v)])
        return
      }
      if (key === 'serviceLifeYears') push([label, formatIntegerForCsv(v)])
      else if (key === 'fuelEfficiency') push([label, formatPercentForCsv(v)])
      else push([label, formatCurrencyForCsv(v)])
    })
    push(['Fleet Mix - Name', 'Share %', 'Unit Cost'])
    futureAssumptions.fleetMix.forEach((t) => push([t.name, formatPercentForCsv(t.share), formatCurrencyForCsv(t.unitCost)]))
    push([])

    // Baseline inputs (order matches drawer)
    const baselineLabels: { key: keyof TodayInputs; label: string }[] = [
      { key: 'totalVehicles', label: 'Total Vehicles' },
      { key: 'baselineAnnualPurchase', label: 'Annual Purchase (Baseline Year)' },
      { key: 'baselineResale', label: 'Baseline Resale' },
      { key: 'nonRegisteredVehicles', label: 'Golf Carts / Non-Registered Vehicles' },
      { key: 'fuelAnnual', label: 'Fuel Annual' },
      { key: 'insurance', label: 'Insurance' },
      { key: 'maintenance', label: 'Maintenance' },
      { key: 'registration', label: 'Registration' },
      { key: 'outsideRental', label: 'Outside Rental' },
      { key: 'planon', label: 'Planon' },
      { key: 'labor', label: 'Labor' },
      { key: 'telematics', label: 'Telematics' },
    ]
    push(['Baseline inputs', 'Value'])
    baselineLabels.forEach(({ key, label }) => {
      const v = todayInputs[key]
      if (key === 'totalVehicles' || key === 'nonRegisteredVehicles') push([label, formatIntegerForCsv(v)])
      else push([label, formatCurrencyForCsv(v)])
    })
    push([])

    // Score metrics: Case, Total Vehicles, Lifecycle Years, Total Program Cost (Annual), Cost/Veh/Mo (ex fuel)
    push(['Case', 'Total Vehicles', 'Lifecycle Years', 'Total Program Cost (Annual)', 'Cost/Veh/Mo (ex fuel)'])
    push([
      'Today (Baseline)',
      formatIntegerForCsv(baselineComputed.totalVehicles),
      baselineComputed.lifecycleYears != null ? formatIntegerForCsv(baselineComputed.lifecycleYears) : 'N/A',
      formatCurrencyForCsv(baselineComputed.totalProgramCostAnnual),
      formatCurrencyForCsv(baselineComputed.costPerVehPerMonthExFuel),
    ])
    scenarios.forEach((scenario) => {
      const c = getScenarioComputed(scenario)
      push([
        scenario.name,
        formatIntegerForCsv(c.totalVehicles),
        c.lifecycleYears != null ? formatIntegerForCsv(c.lifecycleYears) : 'N/A',
        formatCurrencyForCsv(c.totalProgramCostAnnual),
        formatCurrencyForCsv(c.costPerVehPerMonthExFuel),
      ])
    })
    push([])

    // Cost Drivers - Values: Component, Baseline, Scenario 1, Scenario 2, ... (column order matches UI; plain hyphen in header)
    const costDriverKeys = ['purchase', 'resale', 'insurance', 'registration', 'maintenance', 'telematics', 'planon', 'labor', 'fuel'] as const
    const costDriverRowLabels: { key: 'totalProgramCost' | 'totalVehicles' | 'lifecycleYears'; label: string }[] = [
      { key: 'totalProgramCost', label: 'Total Program Cost' },
      { key: 'totalVehicles', label: 'Total Vehicles' },
      { key: 'lifecycleYears', label: 'Lifecycle Years' },
    ]
    push(['Cost Drivers - Values'])
    const valueHeader = ['Component', 'Baseline', ...scenarios.map((s) => s.name)]
    push(valueHeader)
    costDriverRowLabels.forEach((row) => {
      const baseVal = row.key === 'totalProgramCost' ? baselineComputed.totalProgramCostAnnual : row.key === 'totalVehicles' ? baselineComputed.totalVehicles : baselineComputed.lifecycleYears
      const baseStr = baseVal != null ? (row.key === 'totalProgramCost' ? formatCurrencyForCsv(baseVal) : formatIntegerForCsv(baseVal as number)) : (row.key === 'lifecycleYears' ? 'N/A' : '')
      const cells: string[] = [row.label, baseStr]
      scenarios.forEach((scenario) => {
        const c = getScenarioComputed(scenario)
        const val = row.key === 'totalProgramCost' ? c.totalProgramCostAnnual : row.key === 'totalVehicles' ? c.totalVehicles : c.lifecycleYears
        cells.push(val != null ? (row.key === 'totalProgramCost' ? formatCurrencyForCsv(val) : formatIntegerForCsv(val as number)) : '')
      })
      push(cells)
    })
    costDriverKeys.forEach((key) => {
      const label = key.charAt(0).toUpperCase() + key.slice(1)
      const cells: string[] = [label, formatCurrencyForCsv(baselineComputed.breakdown[key])]
      scenarios.forEach((scenario) => {
        const c = getScenarioComputed(scenario)
        cells.push(formatCurrencyForCsv(c.breakdown[key]))
      })
      push(cells)
    })
    push([])

    // Cost Drivers - Deltas (vs Baseline): Component, Baseline (blank), Scenario 1, Scenario 2, ... (plain hyphen in header)
    push(['Cost Drivers - Deltas (vs Baseline)'])
    const deltaHeader = ['Component', 'Baseline', ...scenarios.map((s) => s.name)]
    push(deltaHeader)
    costDriverRowLabels.forEach((row) => {
      const cells: string[] = [row.label, '']
      const baseVal = row.key === 'totalProgramCost' ? baselineComputed.totalProgramCostAnnual : row.key === 'totalVehicles' ? baselineComputed.totalVehicles : baselineComputed.lifecycleYears
      scenarios.forEach((scenario) => {
        const c = getScenarioComputed(scenario)
        const val = row.key === 'totalProgramCost' ? c.totalProgramCostAnnual : row.key === 'totalVehicles' ? c.totalVehicles : c.lifecycleYears
        const delta = baseVal != null && val != null ? (val as number) - (baseVal as number) : null
        cells.push(delta != null ? (row.key === 'totalProgramCost' ? formatCurrencyDeltaForCsv(delta) : (delta > 0 ? '+' : '') + formatIntegerForCsv(delta)) : '')
      })
      push(cells)
    })
    costDriverKeys.forEach((key) => {
      const label = key.charAt(0).toUpperCase() + key.slice(1)
      const baseVal = baselineComputed.breakdown[key]
      const cells: string[] = [label, '']
      scenarios.forEach((scenario) => {
        const c = getScenarioComputed(scenario)
        const delta = c.breakdown[key] - baseVal
        cells.push(formatCurrencyDeltaForCsv(delta))
      })
      push(cells)
    })

    const content = rows.join('\r\n')
    downloadCsv(`fleet-cost-export-${new Date().toISOString().slice(0, 10)}.csv`, content)
  }

  // Handle ESC key to close drawers
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFutureAssumptionsDrawerOpen) {
          setIsFutureAssumptionsDrawerOpen(false)
        } else if (isDrawerOpen) {
          setIsDrawerOpen(false)
        }
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isDrawerOpen, isFutureAssumptionsDrawerOpen])

  // Cleanup toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  // When there are no scenarios, show baseline only
  useEffect(() => {
    if (scenarios.length === 0) setViewingBaseline(true)
  }, [scenarios.length])

  const maxScenarios = 3
  const canAddScenario = scenarios.length < maxScenarios

  const handleAddScenario = () => {
    if (!canAddScenario) return
    const newId = String(Date.now())
    const newScenario: Scenario = {
      id: newId,
      name: `Scenario ${scenarios.length + 1}`,
      totalVehicles: todayInputs.totalVehicles,
      nonRegisteredVehicles: todayInputs.nonRegisteredVehicles,
      strategicSavings: 0,
      resale: 0,
      lifecycle: 7,
    }
    setScenarios([...scenarios, newScenario])
    setSelectedScenarioIndex(scenarios.length)
    setViewingBaseline(false)
  }

  const handleDuplicateScenario = () => {
    const newId = String(Date.now())
    const duplicated: Scenario = {
      ...selectedScenario,
      id: newId,
      name: `${selectedScenario.name} (Copy)`,
    }
    setScenarios([...scenarios, duplicated])
    setSelectedScenarioIndex(scenarios.length)
  }

  const handleDeleteScenario = () => {
    if (scenarios.length < 1) return
    const newScenarios = scenarios.filter((_, index) => index !== selectedScenarioIndex)
    setScenarios(newScenarios)
    setSelectedScenarioIndex(Math.min(selectedScenarioIndex, Math.max(0, newScenarios.length - 1)))
    if (newScenarios.length === 0) setViewingBaseline(true)
  }

  // Strip $ and commas so formatted values (e.g. "$700,000", "50%") parse correctly
  const parseNumber = (value: string): number => {
    const trimmed = value.trim()
    if (trimmed === '' || trimmed === '-') return 0
    const stripped = trimmed.replace(/[$,\s]/g, '').replace(/%$/, '')
    const parsed = Number(stripped)
    return isNaN(parsed) ? 0 : parsed
  }

  const handleTodayInputChange = (field: keyof TodayInputs, value: string) => {
    // Only update the string state during typing - don't commit to numeric state yet
    setTodayInputStrings({ ...todayInputStrings, [field]: value })
  }

  const formatTodayInputDisplay = (field: keyof TodayInputs, numValue: number): string => {
    const integerFields: (keyof TodayInputs)[] = ['totalVehicles', 'nonRegisteredVehicles']
    return integerFields.includes(field) ? formatInteger(numValue) : formatCurrency(numValue)
  }

  const handleTodayInputBlur = (field: keyof TodayInputs) => {
    const trimmed = todayInputStrings[field].trim()
    // Revert to last valid if empty or only minus (no toast)
    let numValue =
      trimmed === '' || trimmed === '-'
        ? todayInputs[field]
        : parseNumber(todayInputStrings[field])

    // Clamp nonRegisteredVehicles when totalVehicles changes
    if (field === 'totalVehicles') {
      const currentNonRegistered = todayInputs.nonRegisteredVehicles
      if (currentNonRegistered > numValue) {
        numValue = Math.max(0, numValue)
        setTodayInputs({ ...todayInputs, totalVehicles: numValue, nonRegisteredVehicles: numValue })
        setTodayInputStrings({ ...todayInputStrings, totalVehicles: formatInteger(numValue), nonRegisteredVehicles: formatInteger(numValue) })
        showToast('Golf carts adjusted to not exceed total vehicles.')
        return
      }
    }

    if (field === 'nonRegisteredVehicles') {
      const clamped = Math.max(0, Math.min(numValue, todayInputs.totalVehicles))
      if (clamped !== numValue) {
        numValue = clamped
        showToast('Golf carts adjusted to not exceed total vehicles.')
      }
    }

    setTodayInputs({ ...todayInputs, [field]: numValue })
    setTodayInputStrings({ ...todayInputStrings, [field]: formatTodayInputDisplay(field, numValue) })
  }

  type FutureField = 'totalVehicles' | 'nonRegisteredVehicles' | 'strategicSavings' | 'resale' | 'lifecycle'
  type FutureAssumptionField = 'serviceLifeYears' | 'fuelEfficiency' | 'laborAnnual' | 'telematicsCostPerVehicle' | 'planonAnnual' | 'avgVehiclePrice'

  // Handle Enter key to commit input (same as blur)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, onBlur: () => void) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
      onBlur()
    }
  }

  const handleFutureInputChange = (field: FutureField, value: string) => {
    // Only update string state during typing; no clamp/toast until blur
    const currentStrings = futureInputStringsMap[selectedScenario.id] || getFutureInputStrings()
    setFutureInputStringsMap({
      ...futureInputStringsMap,
      [selectedScenario.id]: { ...currentStrings, [field]: value },
    })
  }

  const formatFutureInputDisplay = (f: FutureField, v: number) =>
    (f === 'strategicSavings' || f === 'resale') ? formatPercent(v) : formatInteger(v)

  const handleFutureInputBlur = (field: FutureField) => {
    if (!selectedScenario) return
    const currentStrings = futureInputStringsMap[selectedScenario.id] || futureInputStrings
    const trimmed = currentStrings[field].trim()
    const lastValid = selectedScenario[field]
    const rawValue = trimmed === '' || trimmed === '-' ? lastValid : parseNumber(currentStrings[field])
    const result = updateScenarioField(field, rawValue)

    if (field === 'totalVehicles' && selectedScenario.nonRegisteredVehicles > result.value) {
      const updated = [...scenarios]
      updated[selectedScenarioIndex] = { ...updated[selectedScenarioIndex], totalVehicles: result.value, nonRegisteredVehicles: result.value }
      setScenarios(updated)
      setFutureInputStringsMap({
        ...futureInputStringsMap,
        [selectedScenario.id]: { ...currentStrings, totalVehicles: formatInteger(result.value), nonRegisteredVehicles: formatInteger(result.value) },
      })
      showToast('Golf carts adjusted to not exceed total vehicles.')
      if (result.wasClamped && result.message) showToast(result.message)
      return
    }

    const updated = [...scenarios]
    updated[selectedScenarioIndex] = { ...updated[selectedScenarioIndex], [field]: result.value }
    setScenarios(updated)
    setFutureInputStringsMap({
      ...futureInputStringsMap,
      [selectedScenario.id]: { ...currentStrings, [field]: formatFutureInputDisplay(field, result.value) },
    })
    if (result.wasClamped && result.message) showToast(result.message)
  }

  const handleFutureSliderChange = (field: FutureField, value: number) => {
    // Sliders update immediately (no blur needed)
    const result = updateScenarioField(field, value)
    
    // Handle totalVehicles special case - auto-reduce golf carts
    if (field === 'totalVehicles' && selectedScenario.nonRegisteredVehicles > result.value) {
      const updated = [...scenarios]
      updated[selectedScenarioIndex] = { 
        ...updated[selectedScenarioIndex], 
        totalVehicles: result.value, 
        nonRegisteredVehicles: result.value 
      }
      setScenarios(updated)
      const fmt = (f: FutureField, v: number) => (f === 'strategicSavings' || f === 'resale') ? formatPercent(v) : formatInteger(v)
      setFutureInputStringsMap({
        ...futureInputStringsMap,
        [selectedScenario.id]: { ...futureInputStrings, totalVehicles: fmt('totalVehicles', result.value), nonRegisteredVehicles: fmt('nonRegisteredVehicles', result.value) },
      })
      showToast('Golf carts adjusted to not exceed total vehicles.')
      if (result.message) showToast(result.message)
      return
    }
    
    const formatFutureInputDisplay = (f: FutureField, v: number) =>
      (f === 'strategicSavings' || f === 'resale') ? formatPercent(v) : formatInteger(v)
    // Update state with clamped value
    const updated = [...scenarios]
    updated[selectedScenarioIndex] = { ...updated[selectedScenarioIndex], [field]: result.value }
    setScenarios(updated)
    setFutureInputStringsMap({
      ...futureInputStringsMap,
      [selectedScenario.id]: { ...futureInputStrings, [field]: formatFutureInputDisplay(field, result.value) },
    })
    
    // Show toast if clamped
    if (result.wasClamped && result.message) {
      showToast(result.message)
    }
  }

  // Update function for future assumptions with bounds enforcement
  const updateFutureAssumptionField = (field: FutureAssumptionField, rawValue: number): { value: number; wasClamped: boolean; message?: string } => {
    const bounds = futureAssumptionBounds[field]
    const maxValue = bounds.max
    
    const clampedValue = Math.max(bounds.min, Math.min(rawValue, maxValue))
    const wasClamped = clampedValue !== rawValue
    
    // Generate toast message if clamped
    let message: string | undefined
    if (wasClamped) {
      if (rawValue > maxValue) {
        const fieldName = field === 'serviceLifeYears' ? 'Service life years' :
                         field === 'fuelEfficiency' ? 'Fuel efficiency' :
                         field === 'laborAnnual' ? 'Labor annual' :
                         field === 'telematicsCostPerVehicle' ? 'Telematics cost per vehicle' :
                         field === 'planonAnnual' ? 'Planon (annual)' :
                         field === 'avgVehiclePrice' ? 'Avg vehicle price' : field
        message = `${fieldName} adjusted to ${clampedValue}${bounds.type === 'percent' ? '%' : ''} (maximum allowed).`
      } else if (rawValue < bounds.min) {
        const fieldName = field === 'serviceLifeYears' ? 'Service life years' :
                         field === 'fuelEfficiency' ? 'Fuel efficiency' :
                         field === 'laborAnnual' ? 'Labor annual' :
                         field === 'telematicsCostPerVehicle' ? 'Telematics cost per vehicle' :
                         field === 'planonAnnual' ? 'Planon (annual)' :
                         field === 'avgVehiclePrice' ? 'Avg vehicle price' : field
        message = `${fieldName} adjusted to ${clampedValue}${bounds.type === 'percent' ? '%' : ''} (minimum allowed).`
      }
    }
    
    return { value: clampedValue, wasClamped, message }
  }

  // Handlers for Future Assumptions (global)
  const handleFutureAssumptionChange = (field: FutureAssumptionField, value: string) => {
    // Only update string state during typing; clamp/toast only on blur
    setFutureAssumptionsStrings({ ...futureAssumptionsStrings, [field]: value })
  }

  const formatFutureAssumptionDisplay = (field: FutureAssumptionField, numValue: number): string => {
    if (field === 'fuelEfficiency') return formatPercent(numValue)
    if (field === 'serviceLifeYears') return formatInteger(numValue)
    return formatCurrency(numValue)
  }

  const handleFutureAssumptionBlur = (field: FutureAssumptionField) => {
    const trimmed = futureAssumptionsStrings[field].trim()
    const rawValue = trimmed === '' || trimmed === '-' ? futureAssumptions[field] : parseNumber(futureAssumptionsStrings[field])
    const result = updateFutureAssumptionField(field, rawValue)
    setFutureAssumptions({ ...futureAssumptions, [field]: result.value })
    setFutureAssumptionsStrings({ ...futureAssumptionsStrings, [field]: formatFutureAssumptionDisplay(field, result.value) })
    if (result.wasClamped && result.message) showToast(result.message)
  }

  function loadFromLocalStorage(): SharePayload | null {
    try {
      const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
      if (!raw) return null
      const payload = JSON.parse(raw) as SharePayload
      if (payload?.v !== SHARE_STATE_VERSION || payload?.state == null) return null
      return payload
    } catch {
      return null
    }
  }

  function hydrateState(payload: SharePayload) {
    const s = payload.state
    const todayInputsMerged: TodayInputs = { ...defaultTodayInputs, ...s.todayInputs }
    const fleetMix = (s.futureAssumptions?.fleetMix != null && Array.isArray(s.futureAssumptions.fleetMix) && s.futureAssumptions.fleetMix.length > 0)
      ? s.futureAssumptions.fleetMix
      : defaultFleetMix
    const futureAssumptionsMerged: FutureAssumptions = {
      ...defaultFutureAssumptions,
      ...s.futureAssumptions,
      fleetMix,
    }
    const scenariosRaw: Scenario[] = Array.isArray(s.scenarios) && s.scenarios.length > 0
      ? s.scenarios.map((sc, i) => ({
          ...DEFAULT_SCENARIO,
          id: sc.id ?? `sc-${i + 1}`,
          name: sc.name ?? `Scenario ${i + 1}`,
          totalVehicles: typeof sc.totalVehicles === 'number' ? sc.totalVehicles : DEFAULT_SCENARIO.totalVehicles,
          nonRegisteredVehicles: typeof sc.nonRegisteredVehicles === 'number' ? sc.nonRegisteredVehicles : DEFAULT_SCENARIO.nonRegisteredVehicles,
          strategicSavings: typeof sc.strategicSavings === 'number' ? sc.strategicSavings : DEFAULT_SCENARIO.strategicSavings,
          resale: typeof sc.resale === 'number' ? sc.resale : DEFAULT_SCENARIO.resale,
          lifecycle: typeof sc.lifecycle === 'number' ? sc.lifecycle : DEFAULT_SCENARIO.lifecycle,
        }))
      : [DEFAULT_SCENARIO]
    const scenariosMerged = migrateScenariosIfNeeded(scenariosRaw)
    const selectedIndex = Math.min(
      Math.max(0, typeof s.selectedScenarioIndex === 'number' ? s.selectedScenarioIndex : 0),
      scenariosMerged.length - 1
    )
    const viewingBaselineMerged = Boolean(s.viewingBaseline)

    setTodayInputs(todayInputsMerged)
    setFutureAssumptions(futureAssumptionsMerged)
    setScenarios(scenariosMerged)
    setSelectedScenarioIndex(selectedIndex)
    setViewingBaseline(viewingBaselineMerged)

    setTodayInputStrings({
      totalVehicles: formatInteger(todayInputsMerged.totalVehicles),
      nonRegisteredVehicles: formatInteger(todayInputsMerged.nonRegisteredVehicles),
      baselineAnnualPurchase: formatCurrency(todayInputsMerged.baselineAnnualPurchase),
      baselineResale: formatCurrency(todayInputsMerged.baselineResale),
      fuelAnnual: formatCurrency(todayInputsMerged.fuelAnnual),
      insurance: formatCurrency(todayInputsMerged.insurance),
      maintenance: formatCurrency(todayInputsMerged.maintenance),
      registration: formatCurrency(todayInputsMerged.registration),
      outsideRental: formatCurrency(todayInputsMerged.outsideRental),
      planon: formatCurrency(todayInputsMerged.planon),
      labor: formatCurrency(todayInputsMerged.labor),
      telematics: formatCurrency(todayInputsMerged.telematics),
    })
    setFutureAssumptionsStrings({
      serviceLifeYears: formatInteger(futureAssumptionsMerged.serviceLifeYears),
      fuelEfficiency: formatPercent(futureAssumptionsMerged.fuelEfficiency),
      laborAnnual: formatCurrency(futureAssumptionsMerged.laborAnnual),
      telematicsCostPerVehicle: formatCurrency(futureAssumptionsMerged.telematicsCostPerVehicle),
      planonAnnual: formatCurrency(futureAssumptionsMerged.planonAnnual),
      avgVehiclePrice: formatCurrency(futureAssumptionsMerged.avgVehiclePrice),
    })
    const nextFutureInputStringsMap: Record<string, { totalVehicles: string; nonRegisteredVehicles: string; strategicSavings: string; resale: string; lifecycle: string }> = {}
    scenariosMerged.forEach((sc) => {
      nextFutureInputStringsMap[sc.id] = {
        totalVehicles: formatInteger(sc.totalVehicles),
        nonRegisteredVehicles: formatInteger(sc.nonRegisteredVehicles),
        strategicSavings: formatPercent(sc.strategicSavings),
        resale: formatPercent(sc.resale),
        lifecycle: formatInteger(sc.lifecycle),
      }
    })
    setFutureInputStringsMap(nextFutureInputStringsMap)
  }

  useEffect(() => {
    // 1) URL has shared payload: hydrate, persist to sessionStorage, clean URL, sharedMode on
    const payloadFromUrl = parseStateFromUrl()
    if (payloadFromUrl) {
      hydrateState(payloadFromUrl)
      saveSharedSessionToStorage(payloadFromUrl)
      window.history.replaceState(null, '', getCanonicalRootUrl())
      setSharedMode(true)
      return
    }
    if (urlHasStateParam()) {
      showToast('Invalid or outdated share link')
    }
    // 2) sessionStorage has shared session: hydrate from it, keep sharedMode on
    const payloadFromSession = loadSharedSessionFromStorage()
    if (payloadFromSession) {
      hydrateState(payloadFromSession)
      setSharedMode(true)
      return
    }
    // 3) Else: load from localStorage or defaults
    const fromStorage = loadFromLocalStorage()
    if (fromStorage) hydrateState(fromStorage)
    setSharedMode(false)
  }, [])

  // Keep sessionStorage in sync with current state while in shared mode (so refresh persists renames etc.)
  useEffect(() => {
    if (!sharedMode) return
    saveSharedSessionToStorage(exportState())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- we only want to persist when these state slices change
  }, [sharedMode, todayInputs, futureAssumptions, scenarios, selectedScenarioIndex, viewingBaseline])

  // Reset scenario to baseline values (only primary levers)
  const handleResetToBaseline = () => {
    const updated = [...scenarios]
    updated[selectedScenarioIndex] = {
      ...updated[selectedScenarioIndex],
      totalVehicles: todayInputs.totalVehicles,
      nonRegisteredVehicles: todayInputs.nonRegisteredVehicles,
      strategicSavings: 0, // Default baseline
      resale: 0, // Default baseline
    }
    setScenarios(updated)
    
    // Reset string state for this scenario (only primary levers)
    setFutureInputStringsMap({
      ...futureInputStringsMap,
      [selectedScenario.id]: {
        totalVehicles: String(todayInputs.totalVehicles),
        nonRegisteredVehicles: String(todayInputs.nonRegisteredVehicles),
        strategicSavings: '0',
        resale: '0',
        lifecycle: String(selectedScenario.lifecycle),
      },
    })
  }

  const handleScenarioNameChange = (value: string) => {
    if (!selectedScenario) return
    const updated = [...scenarios]
    updated[selectedScenarioIndex] = { ...updated[selectedScenarioIndex], name: value }
    setScenarios(updated)
  }

  return (
    <div className="h-screen bg-gray-100 flex overflow-hidden relative">
      {/* Toast Notification */}
      {toast.visible && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg text-sm transition-opacity duration-200">
          {toast.message}
        </div>
      )}

      {/* Baseline Drawer - Push Layout with Slide Animation */}
      <div
        className={`flex-shrink-0 bg-white rounded-2xl shadow-sm transition-all ease-in-out ${
          isDrawerOpen 
            ? 'w-[420px] m-6 overflow-y-auto translate-x-0 duration-[320ms] delay-[80ms]' 
            : 'w-0 m-0 overflow-hidden duration-[300ms] delay-0'
        }`}
      >
        <div className={`p-6 transition-opacity ${isDrawerOpen ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-800">Baseline Assumptions</h2>
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
            >
              ×
            </button>
          </div>
          
          <div className="space-y-3">
            {([
              ['totalVehicles', 'Total Vehicles'],
              ['baselineAnnualPurchase', 'Annual Purchase (Baseline Year)'],
              ['baselineResale', 'Baseline Resale'],
              ['nonRegisteredVehicles', 'Golf Carts / Non-Registered Vehicles'],
              ['fuelAnnual', 'Fuel Annual'],
              ['insurance', 'Insurance'],
              ['maintenance', 'Maintenance'],
              ['registration', 'Registration'],
              ['outsideRental', 'Outside Rental'],
              ['planon', 'Planon'],
              ['labor', 'Labor'],
              ['telematics', 'Telematics'],
            ] as const).map(([field, label]) => (
              <div key={field} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 items-center">
                <label className="text-xs font-medium text-gray-600 truncate">{label}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={todayInputStrings[field]}
                  onChange={(e) => handleTodayInputChange(field, e.target.value)}
                  onBlur={() => handleTodayInputBlur(field)}
                  onKeyDown={(e) => handleKeyDown(e, () => handleTodayInputBlur(field))}
                  placeholder="0"
                  className={`${inputNumericClass} text-gray-800 placeholder:text-gray-400 shrink-0`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ROLLBACK_REF: pre-single-scroll | Build to recall for rollback: search "ROLLBACK_REF" and revert to split layout (flex-[3] top + flex-none levers) */}
      {/* Main Content - shifts when drawer is open */}
      <div 
        className={`flex-1 flex flex-col min-h-0 p-6 transition-all ease-in-out ${
          isDrawerOpen 
            ? 'duration-[200ms] delay-0' 
            : 'duration-[180ms] delay-0'
        }`}
      >
        <div className="w-full flex-1 flex flex-col min-h-0 2xl:max-w-[1400px] 2xl:mx-auto">
        {/* Single scroll: Fleet Scenarios + Primary Levers (laptop-friendly) */}
        <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-6">
          <div className="bg-white rounded-2xl shadow-sm p-6 flex flex-col shrink-0">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800">
              Fleet Scenarios
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => exportToCsv()}
                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                title="Export CSV"
                aria-label="Export CSV"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const payload = exportState()
                  const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(payload))
                  const url = `${window.location.origin}${window.location.pathname}#${STATE_PARAM}=${encoded}`
                  void navigator.clipboard.writeText(url).then(() => showToast('Link copied'))
                }}
                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                title="Share"
                aria-label="Share"
              >
                <Share2 className="w-5 h-5" />
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setGlobalOverflowOpen(!globalOverflowOpen)}
                  className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                  title="More"
                  aria-label="More options"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>
                {globalOverflowOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setGlobalOverflowOpen(false)} aria-hidden />
                    <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                      <button
                        type="button"
                        onClick={() => { setIsDrawerOpen(true); setGlobalOverflowOpen(false) }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <SlidersHorizontal className="w-4 h-4 shrink-0" />
                        Baseline Settings
                      </button>
                      <button
                        type="button"
                        onClick={() => { setIsFutureAssumptionsDrawerOpen(true); setGlobalOverflowOpen(false) }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Settings2 className="w-4 h-4 shrink-0" />
                        Future Settings
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {sharedMode && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Shared Scenario</p>
              <p className="mt-0.5 text-amber-800">This scenario was shared with you. Changes won&apos;t affect the sender.</p>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(exportState()))
                    clearSharedSessionStorage()
                    setSharedMode(false)
                    showToast(`Saved. You can return anytime at ${getCanonicalRootUrl()}`)
                  } catch {
                    showToast('Could not save')
                  }
                }}
                className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
              >
                Make a copy
              </button>
            </div>
          )}
          
          <div className="space-y-6">
            <section className="space-y-4">
              <div className="flex justify-end">
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50/60 p-0.5" role="tablist" aria-label="Results view">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={resultsViewMode === 'score'}
                    onClick={() => setResultsViewMode('score')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      resultsViewMode === 'score'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    Score
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={resultsViewMode === 'costDrivers'}
                    onClick={() => setResultsViewMode('costDrivers')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      resultsViewMode === 'costDrivers'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    Cost Drivers
                  </button>
                </div>
              </div>

              {resultsViewMode === 'score' && (
                <>
                  {/* Score: responsive card grid — 1 col mobile, 2 tablet, 4 desktop; cap width on xl so cards don't stretch */}
                  <div className="w-full min-w-0 xl:max-w-6xl xl:mx-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 w-full min-w-0">
                      {/* Baseline card */}
                      <div className={`rounded-xl border flex flex-col min-w-0 shadow-sm overflow-hidden ${viewingBaseline ? 'border-blue-400 bg-blue-50/70 ring-2 ring-blue-200' : 'border-gray-200 bg-gray-50/80'}`}>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/60">
                          <button type="button" onClick={() => { setViewingBaseline(true); setOpenCardMenuId(null) }} className="flex-1 min-w-0 text-left">
                            <span className="text-sm font-medium text-gray-600 truncate block" title="Today (Baseline)">Today (Baseline)</span>
                          </button>
                          <div className="relative shrink-0">
                            <button type="button" onClick={(e) => { e.stopPropagation(); setOpenCardMenuId(openCardMenuId === 'baseline' ? null : 'baseline') }} className="p-1 rounded text-gray-500 hover:bg-gray-200/80" aria-label="Baseline card menu">
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {openCardMenuId === 'baseline' && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setOpenCardMenuId(null)} aria-hidden />
                                <div className="absolute right-0 top-full mt-0.5 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                                  <button type="button" onClick={() => { setIsDrawerOpen(true); setOpenCardMenuId(null) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
                                    <SlidersHorizontal className="w-3.5 h-3.5" /> Baseline Settings
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="px-4 py-4 flex flex-col gap-4 flex-1">
                          <div>
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              Total Program Cost
                              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-200/80 text-[10px] text-gray-500 cursor-help" title="Annual">i</span>
                            </p>
                            <p className="text-xl font-bold text-gray-900 mt-0.5">{formatCurrency(baselineComputed.totalProgramCostAnnual)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">$/Veh/Mo</p>
                            <p className="text-lg font-semibold text-gray-900 mt-0.5">{formatCurrency(baselineComputed.costPerVehPerMonthExFuel)}</p>
                          </div>
                        </div>
                        <div className="px-4 py-3 border-t border-gray-200/60">
                          <span className="font-semibold text-gray-800">{formatInteger(todayInputs.totalVehicles)} vehicles</span>
                          <span className="text-gray-400 text-sm ml-1.5">• — yrs</span>
                        </div>
                      </div>

                      {/* Scenario cards */}
                      {scenarios.map((scenario, idx) => {
                        const comp = getScenarioComputed(scenario)
                        const dCost = comp.totalProgramCostAnnual - baselineComputed.totalProgramCostAnnual
                        const dPerMo = comp.costPerVehPerMonthExFuel - baselineComputed.costPerVehPerMonthExFuel
                        const costDeltaClass = dCost > 0 ? 'text-red-600' : dCost < 0 ? 'text-green-600' : 'text-gray-400'
                        const perMoDeltaClass = dPerMo > 0 ? 'text-red-600' : dPerMo < 0 ? 'text-green-600' : 'text-gray-400'
                        const selected = !viewingBaseline && selectedScenario && scenario.id === selectedScenario.id
                        return (
                          <div key={scenario.id} className={`rounded-xl border flex flex-col min-w-0 shadow-sm overflow-hidden ${selected ? 'border-blue-400 bg-blue-50/70 ring-2 ring-blue-200' : 'border-gray-200 bg-white'}`}>
                            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/60 gap-1">
                              {editingScenarioName === scenario.id ? (
                                <input
                                  type="text"
                                  value={editingScenarioNameValue}
                                  onChange={(e) => setEditingScenarioNameValue(e.target.value)}
                                  onBlur={() => { if (editingScenarioNameValue.trim()) handleScenarioNameChange(editingScenarioNameValue.trim()); setEditingScenarioName(null) }}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { if (editingScenarioNameValue.trim()) handleScenarioNameChange(editingScenarioNameValue.trim()); setEditingScenarioName(null) } else if (e.key === 'Escape') setEditingScenarioName(null) }}
                                  autoFocus
                                  className="flex-1 min-w-0 px-2 py-1 text-sm border border-blue-500 rounded bg-white"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <button type="button" onClick={() => { setViewingBaseline(false); setSelectedScenarioIndex(idx); setOpenCardMenuId(null) }} className="flex-1 min-w-0 text-left">
                                  <span className="text-sm font-medium text-gray-700 truncate block" title={scenario.name}>{scenario.name}</span>
                                </button>
                              )}
                              <div className="relative shrink-0">
                                <button type="button" onClick={(e) => { e.stopPropagation(); const o = openCardMenuId !== scenario.id; setOpenCardMenuId(o ? scenario.id : null); if (o) { setViewingBaseline(false); setSelectedScenarioIndex(idx) } }} className="p-1 rounded text-gray-500 hover:bg-gray-200/80" aria-label="Scenario menu">
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>
                                {openCardMenuId === scenario.id && (
                                  <>
                                    <div className="fixed inset-0 z-10" onClick={() => setOpenCardMenuId(null)} aria-hidden />
                                    <div className="absolute right-0 top-full mt-0.5 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                                      <button type="button" onClick={() => { setEditingScenarioName(scenario.id); setEditingScenarioNameValue(scenario.name); setOpenCardMenuId(null) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"><Pencil className="w-3.5 h-3.5" /> Rename</button>
                                      <button type="button" onClick={() => { handleDuplicateScenario(); setOpenCardMenuId(null) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
                                      <button type="button" onClick={() => { handleResetToBaseline(); setOpenCardMenuId(null) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"><RotateCcw className="w-3.5 h-3.5" /> Reset to Baseline</button>
                                      <button type="button" onClick={() => { handleDeleteScenario(); setOpenCardMenuId(null) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-gray-50"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="px-4 py-4 flex flex-col gap-4 flex-1">
                              <div>
                                <p className="text-xs text-gray-500 flex items-center gap-1">
                                  Total Program Cost
                                  <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-200/80 text-[10px] text-gray-500 cursor-help" title="Annual">i</span>
                                </p>
                                <p className="text-xl font-bold text-gray-900 mt-0.5">{formatCurrency(comp.totalProgramCostAnnual)}</p>
                                {dCost !== 0 && <p className={`text-sm font-medium mt-1 ${costDeltaClass}`}>{dCost < 0 ? '↓' : '↑'} {formatCurrencyShort(dCost)}</p>}
                              </div>
                              <div>
                                <p className="text-xs text-gray-500">$/Veh/Mo</p>
                                <p className="text-lg font-semibold text-gray-900 mt-0.5">{formatCurrency(comp.costPerVehPerMonthExFuel)}</p>
                                {dPerMo !== 0 && <p className={`text-sm font-medium mt-1 ${perMoDeltaClass}`}>{dPerMo < 0 ? '↓' : '↑'} {formatCurrencyShort(dPerMo)}</p>}
                              </div>
                            </div>
                            <div className="px-4 py-3 border-t border-gray-200/60">
                              <span className="font-semibold text-gray-800">{formatInteger(scenario.totalVehicles)} vehicles</span>
                              <span className="text-gray-400 text-sm ml-1.5">• {formatInteger(scenario.lifecycle)} yrs</span>
                            </div>
                          </div>
                        )
                      })}

                      {canAddScenario && (
                        <button type="button" onClick={handleAddScenario} className="rounded-xl border-2 border-dashed border-gray-300 bg-gray-50/50 hover:border-blue-300 hover:bg-blue-50/30 flex items-center justify-center min-h-[140px] text-sm font-medium text-gray-500 hover:text-blue-600 transition-colors min-w-0">
                          + Add scenario
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-3">Total Program Cost is annual. $/Veh/Mo excludes fuel.</p>
                </>
              )}

              {resultsViewMode === 'costDrivers' && (() => {
                const baseline = baselineComputed
                const costDriverKeys = ['purchase', 'resale', 'insurance', 'registration', 'maintenance', 'telematics', 'planon', 'labor', 'fuel'] as const
                const summaryRows: { key: 'totalProgramCost' | 'totalVehicles' | 'lifecycleYears'; label: string; baselineVal: string | number; getScenarioVal: (c: ComputedCase) => string | number }[] = [
                  { key: 'totalProgramCost', label: 'Total Program Cost (Annual)', baselineVal: formatCurrency(baseline.totalProgramCostAnnual), getScenarioVal: (c) => formatCurrency(c.totalProgramCostAnnual) },
                  { key: 'totalVehicles', label: 'Total Vehicles', baselineVal: formatInteger(baseline.totalVehicles), getScenarioVal: (c) => formatInteger(c.totalVehicles) },
                  { key: 'lifecycleYears', label: 'Lifecycle (Years)', baselineVal: baseline.lifecycleYears != null ? formatInteger(baseline.lifecycleYears) : '—', getScenarioVal: (c) => c.lifecycleYears != null ? formatInteger(c.lifecycleYears) : '—' },
                ]
                return (
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-gray-200/80">
                          <th className="text-left py-3 px-4 font-medium text-gray-600 bg-white sticky left-0 z-10 border-r border-gray-100 min-w-[120px]">Component</th>
                          <th className="text-center py-3 px-5 font-medium min-w-[100px]">
                            <button
                              type="button"
                              onClick={() => { setViewingBaseline(true); leversSectionRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
                              className={`w-full py-2 px-2 rounded-md transition-colors ${viewingBaseline ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-200' : 'bg-gray-50/80 text-gray-600 hover:bg-gray-100'}`}
                            >
                              Today (Baseline)
                            </button>
                          </th>
                          {scenarios.map((scenario, idx) => (
                            <th key={scenario.id} className="text-center py-3 px-5 min-w-[100px] p-0">
                              <button
                                type="button"
                                onClick={() => { setViewingBaseline(false); setSelectedScenarioIndex(idx); leversSectionRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
                                className={`w-full py-2 px-2 rounded-md font-medium transition-colors ${!viewingBaseline && selectedScenario && scenario.id === selectedScenario.id ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-200' : 'bg-gray-50/60 text-gray-600 hover:bg-gray-100'}`}
                              >
                                {scenario.name}
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* Top summary rows: Total Program Cost (Annual), Total Vehicles, Lifecycle (Years) */}
                        {summaryRows.map((row) => (
                          <tr key={row.key} className="border-b border-gray-100/80 hover:bg-gray-50/30 transition-colors">
                            <td className="py-3 px-4 font-medium text-gray-700 bg-white sticky left-0 z-10 border-r border-gray-100">{row.label}</td>
                            <td className="py-3 px-5 text-center text-gray-900 bg-gray-50/60 tabular-nums">
                              {row.baselineVal}
                            </td>
                            {scenarios.map((scenario) => {
                              const c = getScenarioComputed(scenario)
                              const val = row.getScenarioVal(c)
                              const delta = row.key === 'totalProgramCost' ? c.totalProgramCostAnnual - baseline.totalProgramCostAnnual : 0
                              const deltaClass = row.key === 'totalProgramCost' ? (delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-700') : 'text-gray-700'
                              return (
                                <td
                                  key={scenario.id}
                                  className={`py-3 px-5 text-center tabular-nums ${selectedScenario && scenario.id === selectedScenario.id ? 'bg-blue-50/40' : ''}`}
                                >
                                  <span className={row.key === 'totalProgramCost' ? `font-medium ${deltaClass}` : ''}>{val}</span>
                                  {row.key === 'totalProgramCost' && delta !== 0 && (
                                    <div className={`text-xs mt-0.5 ${deltaClass}`}>
                                      {(delta > 0 ? '+' : '') + formatCurrency(delta)} vs baseline
                                    </div>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                        {/* Component rows (same source of truth as Score) */}
                        {costDriverKeys.map((key) => {
                          const baselineVal = baseline.breakdown[key]
                          return (
                            <tr key={key} className="border-b border-gray-100/80 hover:bg-gray-50/30 transition-colors">
                              <td className="py-3 px-4 font-medium text-gray-700 capitalize bg-white sticky left-0 z-10 border-r border-gray-100">{key}</td>
                              <td className="py-3 px-5 text-center text-gray-900 bg-gray-50/60 tabular-nums">
                                {formatCurrency(baselineVal)}
                              </td>
                              {scenarios.map((scenario) => {
                                const c = getScenarioComputed(scenario)
                                const val = c.breakdown[key]
                                const delta = val - baselineVal
                                const deltaClass = key === 'resale'
                                  ? (delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-700')
                                  : (delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-700')
                                return (
                                  <td
                                    key={scenario.id}
                                    className={`py-3 px-5 text-center tabular-nums ${selectedScenario && scenario.id === selectedScenario.id ? 'bg-blue-50/40' : ''}`}
                                  >
                                    <span className={`font-medium ${deltaClass}`}>{formatCurrency(val)}</span>
                                    {delta !== 0 && (
                                      <div className={`text-xs mt-0.5 ${deltaClass}`}>
                                        {(delta > 0 ? '+' : '') + formatCurrency(delta)} vs baseline
                                      </div>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })()}
            </section>
          </div>
          
          <div className="mt-4 pt-4 border-t border-gray-200 flex justify-start gap-4">
            <button
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              className="text-sm text-gray-500 hover:text-gray-700 hover:underline transition-colors"
            >
              Baseline Settings
            </button>
            <button
              onClick={() => setIsFutureAssumptionsDrawerOpen(!isFutureAssumptionsDrawerOpen)}
              className="text-sm text-gray-500 hover:text-gray-700 hover:underline transition-colors"
            >
              Future Settings
            </button>
          </div>
        </div>

        {/* Primary Levers — compact 2x2 grid (same scroll as Fleet Scenarios) */}
        <div className="flex-none min-w-0 w-full overflow-hidden shrink-0" ref={leversSectionRef}>
          <div className="bg-white rounded-2xl shadow-sm p-6 flex flex-col min-w-0">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Primary Levers</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 overflow-hidden min-w-0">
            {([
              { field: 'totalVehicles' as const, label: 'Total Vehicles', format: (v: number) => formatInteger(v), min: scenarioBounds.totalVehicles.min, max: scenarioBounds.totalVehicles.max, step: scenarioBounds.totalVehicles.step },
              { field: 'lifecycle' as const, label: 'Lifecycle Years', format: (v: number) => `${formatInteger(v)} yrs`, min: scenarioBounds.lifecycle.min, max: scenarioBounds.lifecycle.max, step: scenarioBounds.lifecycle.step },
              { field: 'strategicSavings' as const, label: 'Purchase Reduction %', format: (v: number) => formatPercent(v), min: scenarioBounds.strategicSavings.min, max: scenarioBounds.strategicSavings.max, step: scenarioBounds.strategicSavings.step },
              { field: 'resale' as const, label: 'Resale Recovery %', format: (v: number) => formatPercent(v), min: scenarioBounds.resale.min, max: scenarioBounds.resale.max, step: scenarioBounds.resale.step },
            ]).map(({ field, label, format, min, max, step }) => {
              const val = effectiveLeverScenario[field]
              const disabled = (field === 'totalVehicles' || field === 'lifecycle' ? (viewingBaseline || !selectedScenario) : viewingBaseline) || !selectedScenario
              const displayVal = field === 'totalVehicles' ? (viewingBaseline || !selectedScenario ? formatInteger(effectiveLeverScenario.totalVehicles) : (futureInputStrings.totalVehicles ?? formatInteger(selectedScenario!.totalVehicles))) : field === 'lifecycle' ? (viewingBaseline || !selectedScenario ? formatInteger(effectiveLeverScenario.lifecycle) : (futureInputStrings.lifecycle ?? formatInteger(selectedScenario!.lifecycle))) : field === 'strategicSavings' ? (viewingBaseline || !selectedScenario ? formatPercent(effectiveLeverScenario.strategicSavings) : (futureInputStrings.strategicSavings ?? formatPercent(selectedScenario!.strategicSavings))) : (viewingBaseline ? formatPercent(effectiveLeverScenario.resale) : (futureInputStrings.resale ?? formatPercent(selectedScenario!.resale)))
              const displayString = field === 'totalVehicles' ? futureInputStrings.totalVehicles : field === 'lifecycle' ? futureInputStrings.lifecycle : field === 'strategicSavings' ? futureInputStrings.strategicSavings : futureInputStrings.resale
              return (
                <div key={field} className="border-b border-gray-100 min-w-0">
                  <LeverControl
                    label={label}
                    value={val}
                    displayString={displayString ?? displayVal}
                    formatBubble={format}
                    min={min}
                    max={max}
                    step={step}
                    disabled={disabled}
                    isEditing={editingLeverField === field}
                    onSliderChange={(v) => handleFutureSliderChange(field, v)}
                    onValueClick={() => { if (!disabled) setEditingLeverField(field) }}
                    onInputChange={(s) => handleFutureInputChange(field, s)}
                    onInputBlur={() => { handleFutureInputBlur(field); setEditingLeverField(null) }}
                    onInputKeyDown={(e, blur) => { if (e.key === 'Enter') blur(); else if (e.key === 'Escape') setEditingLeverField(null); handleKeyDown(e, blur) }}
                  />
                </div>
              )
            })}
          </div>
        </div>
        </div>
        </div>
      </div>

      {/* Bottom Slide-Up Drawer for Future Settings */}
      {/* Backdrop Overlay - Always mounted, animated opacity */}
      <div
        className={`fixed inset-0 bg-black z-40 transition-opacity duration-300 ${
          isFutureAssumptionsDrawerOpen ? 'opacity-20 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsFutureAssumptionsDrawerOpen(false)}
      />
      {/* Drawer - Always mounted, aligned to main content, animated transform */}
      <div
        className={`fixed bottom-0 bg-white rounded-t-2xl shadow-lg z-50 transition-all duration-300 ease-out ${
          isFutureAssumptionsDrawerOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ 
          height: '55vh', 
          maxHeight: '600px',
          left: isDrawerOpen ? 'calc(420px + 3rem)' : '1.5rem',
          right: '1.5rem',
        }}
      >
        <div className="h-full flex flex-col">
          {/* Drawer Header */}
          <div className="flex justify-between items-center p-6 border-b border-gray-200">
            <button
              onClick={() => setIsFutureAssumptionsDrawerOpen(!isFutureAssumptionsDrawerOpen)}
              className="text-left flex-1"
            >
              <h2 className="text-xl font-semibold text-gray-800">Future Settings</h2>
              <p className="text-sm text-gray-500 mt-1">Applies to all future scenarios</p>
            </button>
            <button
              onClick={() => setIsFutureAssumptionsDrawerOpen(false)}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none ml-4"
            >
              ×
            </button>
          </div>
              
              {/* Drawer Content - label + compact input, minimal gap */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-3 max-w-sm">
                  <NumberControl
                    label="Telematics Cost Per Vehicle"
                    value={futureAssumptions.telematicsCostPerVehicle}
                    stringValue={futureAssumptionsStrings.telematicsCostPerVehicle}
                    onChange={(value) => handleFutureAssumptionChange('telematicsCostPerVehicle', value)}
                    onBlur={() => handleFutureAssumptionBlur('telematicsCostPerVehicle')}
                    min={futureAssumptionBounds.telematicsCostPerVehicle.min}
                    max={futureAssumptionBounds.telematicsCostPerVehicle.max}
                    step={futureAssumptionBounds.telematicsCostPerVehicle.step}
                    handleKeyDown={handleKeyDown}
                  />
                  <NumberControl
                    label="Labor Annual"
                    value={futureAssumptions.laborAnnual}
                    stringValue={futureAssumptionsStrings.laborAnnual}
                    onChange={(value) => handleFutureAssumptionChange('laborAnnual', value)}
                    onBlur={() => handleFutureAssumptionBlur('laborAnnual')}
                    min={futureAssumptionBounds.laborAnnual.min}
                    max={futureAssumptionBounds.laborAnnual.max}
                    step={futureAssumptionBounds.laborAnnual.step}
                    handleKeyDown={handleKeyDown}
                  />
                  <NumberControl
                    label="Fuel Efficiency %"
                    value={futureAssumptions.fuelEfficiency}
                    stringValue={futureAssumptionsStrings.fuelEfficiency}
                    onChange={(value) => handleFutureAssumptionChange('fuelEfficiency', value)}
                    onBlur={() => handleFutureAssumptionBlur('fuelEfficiency')}
                    min={futureAssumptionBounds.fuelEfficiency.min}
                    max={futureAssumptionBounds.fuelEfficiency.max}
                    step={futureAssumptionBounds.fuelEfficiency.step}
                    handleKeyDown={handleKeyDown}
                  />
                  <NumberControl
                    label="Service Life Years"
                    value={futureAssumptions.serviceLifeYears}
                    stringValue={futureAssumptionsStrings.serviceLifeYears}
                    onChange={(value) => handleFutureAssumptionChange('serviceLifeYears', value)}
                    onBlur={() => handleFutureAssumptionBlur('serviceLifeYears')}
                    min={futureAssumptionBounds.serviceLifeYears.min}
                    max={futureAssumptionBounds.serviceLifeYears.max}
                    step={futureAssumptionBounds.serviceLifeYears.step}
                    handleKeyDown={handleKeyDown}
                  />
                  <NumberControl
                    label="Planon (Annual $)"
                    value={futureAssumptions.planonAnnual}
                    stringValue={futureAssumptionsStrings.planonAnnual}
                    onChange={(value) => handleFutureAssumptionChange('planonAnnual', value)}
                    onBlur={() => handleFutureAssumptionBlur('planonAnnual')}
                    min={futureAssumptionBounds.planonAnnual.min}
                    max={futureAssumptionBounds.planonAnnual.max}
                    step={futureAssumptionBounds.planonAnnual.step}
                    handleKeyDown={handleKeyDown}
                  />
                  <NumberControl
                    label="Avg Vehicle Price"
                    value={futureAssumptions.avgVehiclePrice}
                    stringValue={futureAssumptionsStrings.avgVehiclePrice}
                    onChange={(value) => handleFutureAssumptionChange('avgVehiclePrice', value)}
                    onBlur={() => handleFutureAssumptionBlur('avgVehiclePrice')}
                    min={futureAssumptionBounds.avgVehiclePrice.min}
                    max={futureAssumptionBounds.avgVehiclePrice.max}
                    step={futureAssumptionBounds.avgVehiclePrice.step}
                    handleKeyDown={handleKeyDown}
                  />
                </div>
              </div>
            </div>
          </div>
      </div>
    </div>
  )
}

export default App
