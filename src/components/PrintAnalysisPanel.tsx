import { useEffect, useRef, useState } from 'react'
import type { LibraryFile } from '../lib/library'
import {
  analyseDesktopPrint,
  chooseDesktopPrusaSlicerConfig,
  chooseDesktopPrusaSlicerExecutable,
  detectDesktopPrusaSlicer,
  type ComparisonPrintStrategy,
  type PrintAnalysisResult,
  type PrintStrategy,
  type PrintStrategyResults,
} from '../lib/platform'

type PrintAnalysisPanelProps = {
  file?: LibraryFile
  result?: PrintAnalysisResult
  onResultChange?: (result?: PrintAnalysisResult) => void
  comparisonResults?: PrintStrategyResults
  onComparisonResultsChange?: (results: PrintStrategyResults) => void
}

type PrintAnalysisSettings = {
  slicerPath: string
  profilePath: string
  materialDensityGPerCm3: string
  spoolWeightG: string
  spoolCost: string
  currency: string
}

type StrategyDefinition = {
  id: ComparisonPrintStrategy
  label: string
  shortDescription: string
}

const STORAGE_KEY = 'modelarium-print-analysis-poc'

const DEFAULT_SETTINGS: PrintAnalysisSettings = {
  slicerPath: '',
  profilePath: '',
  materialDensityGPerCm3: '1.24',
  spoolWeightG: '1000',
  spoolCost: '300',
  currency: 'R',
}

const STRATEGIES: StrategyDefinition[] = [
  { id: 'fast', label: 'Fast', shortDescription: 'Prioritises shorter print time.' },
  { id: 'balanced', label: 'Balanced', shortDescription: 'Everyday compromise across time, material and finish.' },
  { id: 'strength', label: 'Strength Optimised', shortDescription: 'Adds wall and infill emphasis for functional parts.' },
  { id: 'quality', label: 'Quality Optimised', shortDescription: 'Uses finer layers for surface detail.' },
]

const STRATEGY_LABELS: Record<PrintStrategy, string> = {
  baseline: 'Baseline',
  fast: 'Fast',
  balanced: 'Balanced',
  strength: 'Strength Optimised',
  quality: 'Quality Optimised',
}

function readSettings(): PrintAnalysisSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<PrintAnalysisSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes || days || hours) parts.push(`${minutes}m`)
  if (!days && !hours && remainingSeconds) parts.push(`${remainingSeconds}s`)
  return parts.join(' ') || '0m'
}

function finitePositive(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function shortPath(value: string) {
  if (value.length <= 58) return value
  return `…${value.slice(-57)}`
}

function formatWeight(result?: PrintAnalysisResult) {
  return result?.filamentWeightG != null ? `${result.filamentWeightG.toFixed(1)} g` : '—'
}

function formatCost(result?: PrintAnalysisResult) {
  return result?.materialCost != null ? `${result.currency}${result.materialCost.toFixed(2)}` : '—'
}

function formatLayer(result?: PrintAnalysisResult) {
  return result?.layerHeightMm != null ? `${result.layerHeightMm.toFixed(2)} mm` : 'Baseline'
}

function formatWalls(result?: PrintAnalysisResult) {
  return result?.perimeterCount != null ? String(result.perimeterCount) : 'Baseline'
}

function formatInfill(result?: PrintAnalysisResult) {
  return result?.infillPercent != null ? `${result.infillPercent}%` : 'Baseline'
}

type ComparisonInsight = {
  title: string
  body: string
}

function describeTimeDifference(
  strategyLabel: string,
  strategySeconds: number,
  balancedSeconds: number,
) {
  const difference = strategySeconds - balancedSeconds
  if (difference === 0) return `${strategyLabel} takes the same estimated time as Balanced.`
  return `${strategyLabel} is ${formatDuration(Math.abs(difference))} ${difference < 0 ? 'quicker' : 'slower'} than Balanced.`
}

function describeWeightDifference(
  strategyWeight?: number,
  balancedWeight?: number,
) {
  if (strategyWeight == null || balancedWeight == null) return ''
  const difference = strategyWeight - balancedWeight
  if (Math.abs(difference) < 0.05) return ' Filament use is effectively the same.'
  return ` It uses ${Math.abs(difference).toFixed(1)} g ${difference < 0 ? 'less' : 'more'} filament.`
}

function buildComparisonInsights(results: PrintStrategyResults): ComparisonInsight[] {
  const balanced = results.balanced
  if (!balanced) return []

  const comparisons: Array<[ComparisonPrintStrategy, string]> = [
    ['fast', 'Fast'],
    ['strength', 'Strength Optimised'],
    ['quality', 'Quality Optimised'],
  ]

  return comparisons.flatMap(([strategy, label]) => {
    const candidate = results[strategy]
    if (!candidate) return []

    return [{
      title: `${label} vs Balanced`,
      body:
        describeTimeDifference(label, candidate.estimatedSeconds, balanced.estimatedSeconds) +
        describeWeightDifference(candidate.filamentWeightG, balanced.filamentWeightG),
    }]
  })
}

export function formatPrintAnalysisSummary(result: PrintAnalysisResult) {
  const parts = [formatDuration(result.estimatedSeconds)]
  if (result.filamentWeightG != null) parts.push(`${result.filamentWeightG.toFixed(1)} g`)
  if (result.materialCost != null) parts.push(`${result.currency}${result.materialCost.toFixed(2)}`)
  const prefix = result.strategy !== 'baseline' ? `${STRATEGY_LABELS[result.strategy]} · ` : ''
  return `${prefix}${parts.join(' · ')}`
}

export function PrintAnalysisPanel({
  file,
  result: controlledResult,
  onResultChange,
  comparisonResults: controlledComparisonResults,
  onComparisonResultsChange,
}: PrintAnalysisPanelProps) {
  const [settings, setSettings] = useState<PrintAnalysisSettings>(() => readSettings())
  const [localResult, setLocalResult] = useState<PrintAnalysisResult>()
  const [localComparisonResults, setLocalComparisonResults] = useState<PrintStrategyResults>({})
  const result = onResultChange ? controlledResult : localResult
  const comparisonResults = onComparisonResultsChange ? (controlledComparisonResults ?? {}) : localComparisonResults

  const setResult = (next?: PrintAnalysisResult) => {
    if (onResultChange) onResultChange(next)
    else setLocalResult(next)
  }

  const setComparisonResults = (next: PrintStrategyResults) => {
    if (onComparisonResultsChange) onComparisonResultsChange(next)
    else setLocalComparisonResults(next)
  }

  const [error, setError] = useState<string>()
  const [isAnalysingBaseline, setIsAnalysingBaseline] = useState(false)
  const [comparisonProgress, setComparisonProgress] = useState<{ strategy: ComparisonPrintStrategy; index: number }>()
  const [isDetecting, setIsDetecting] = useState(false)
  const autoBaselineAttemptedRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Persistence is optional; settings still work for this session.
    }
  }, [settings])

  useEffect(() => {
    setError(undefined)
    setComparisonProgress(undefined)
  }, [file?.id])

  useEffect(() => {
    if (settings.slicerPath) return
    let cancelled = false
    setIsDetecting(true)
    void detectDesktopPrusaSlicer()
      .then((detected) => {
        if (!cancelled && detected) {
          setSettings((current) => ({ ...current, slicerPath: detected }))
        }
      })
      .finally(() => {
        if (!cancelled) setIsDetecting(false)
      })

    return () => {
      cancelled = true
    }
  }, [settings.slicerPath])

  const setField = (field: keyof PrintAnalysisSettings, value: string) => {
    setSettings((current) => ({ ...current, [field]: value }))
    setResult(undefined)
    setComparisonResults({})
    setError(undefined)
  }

  const chooseSlicer = async () => {
    const selected = await chooseDesktopPrusaSlicerExecutable()
    if (selected) setField('slicerPath', selected)
  }

  const chooseProfile = async () => {
    const selected = await chooseDesktopPrusaSlicerConfig()
    if (selected) setField('profilePath', selected)
  }

  const detectSlicer = async () => {
    setIsDetecting(true)
    setError(undefined)
    try {
      const detected = await detectDesktopPrusaSlicer()
      if (detected) setField('slicerPath', detected)
      else setError('PrusaSlicer console was not found automatically. Use Browse to select prusa-slicer-console.exe.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to detect PrusaSlicer.')
    } finally {
      setIsDetecting(false)
    }
  }

  const density = finitePositive(settings.materialDensityGPerCm3)
  const spoolWeight = finitePositive(settings.spoolWeightG)
  const spoolCost = finitePositive(settings.spoolCost)
  const canAnalyse = Boolean(
    file?.extension === 'stl' &&
      file.nativePath &&
      settings.slicerPath.trim() &&
      settings.profilePath.trim() &&
      density &&
      spoolWeight &&
      spoolCost,
  )
  const isComparing = Boolean(comparisonProgress)
  const isBusy = isAnalysingBaseline || isComparing

  const analyseStrategy = async (strategy: PrintStrategy) => {
    if (!file?.nativePath || !density || !spoolWeight || !spoolCost) {
      throw new Error('Print Analysis settings are incomplete.')
    }

    return analyseDesktopPrint({
      modelPath: file.nativePath,
      slicerPath: settings.slicerPath.trim(),
      configPath: settings.profilePath.trim(),
      materialDensityGPerCm3: density,
      spoolWeightG: spoolWeight,
      spoolCost,
      currency: settings.currency.trim() || 'R',
      strategy,
    })
  }

  const analyseBaseline = async () => {
    setIsAnalysingBaseline(true)
    setError(undefined)
    try {
      const analysis = await analyseStrategy('baseline')
      setResult(analysis)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Baseline print analysis failed.')
    } finally {
      setIsAnalysingBaseline(false)
    }
  }

  useEffect(() => {
    if (!file?.id || !canAnalyse || result || isBusy) return
    if (autoBaselineAttemptedRef.current === file.id) return

    autoBaselineAttemptedRef.current = file.id
    void analyseBaseline()
  }, [canAnalyse, file?.id, result, isBusy])

  const compareStrategies = async () => {
    setError(undefined)
    setComparisonResults({})
    const completed: PrintStrategyResults = {}
    let activeStrategy: ComparisonPrintStrategy | undefined

    try {
      for (let index = 0; index < STRATEGIES.length; index += 1) {
        const definition = STRATEGIES[index]
        activeStrategy = definition.id
        setComparisonProgress({ strategy: definition.id, index })
        const analysis = await analyseStrategy(definition.id)
        completed[definition.id] = analysis
        setComparisonResults({ ...completed })
      }
    } catch (cause) {
      const label = activeStrategy ? STRATEGY_LABELS[activeStrategy] : 'strategy'
      setError(cause instanceof Error ? `Comparison stopped during ${label}: ${cause.message}` : 'Strategy comparison failed.')
    } finally {
      setComparisonProgress(undefined)
    }
  }

  const hasComparison = STRATEGIES.some((definition) => comparisonResults[definition.id])
  const balanced = comparisonResults.balanced
  const comparisonInsights = buildComparisonInsights(comparisonResults)
  const activityTitle = isAnalysingBaseline ? 'Analysing with PrusaSlicer' : 'Comparing print strategies'
  const activityDetail = isAnalysingBaseline
    ? 'Baseline analysis'
    : comparisonProgress
      ? `${STRATEGY_LABELS[comparisonProgress.strategy]} · ${comparisonProgress.index + 1} of ${STRATEGIES.length}`
      : ''

  return (
    <section className="print-analysis-panel" aria-label="Print Analysis">
      <div className="print-analysis-heading">
        <div>
          <div className="eyebrow">PRINT ANALYSIS</div>
          <h3>Baseline + four-strategy comparison</h3>
        </div>
        <span className="desktop-only-badge">WINDOWS DESKTOP</span>
      </div>

      {file?.extension !== 'stl' || !file.nativePath ? (
        <p className="print-analysis-empty">Select an STL file to run Print Analysis.</p>
      ) : (
        <>
          <div className="print-analysis-model">
            <span>Selected model</span>
            <strong title={file.nativePath}>{file.name}</strong>
          </div>

          <div className="print-analysis-config">
            <label>
              <span>PrusaSlicer console</span>
              <div className="path-input-row">
                <input
                  type="text"
                  value={settings.slicerPath}
                  onChange={(event) => setField('slicerPath', event.currentTarget.value)}
                  placeholder="C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe"
                  title={settings.slicerPath}
                />
                <button type="button" onClick={() => void chooseSlicer()} disabled={isBusy}>Browse</button>
              </div>
              <small>{isDetecting ? 'Detecting PrusaSlicer…' : settings.slicerPath ? shortPath(settings.slicerPath) : 'Not configured'}</small>
            </label>

            <label>
              <span>Baseline PrusaSlicer profile (.ini)</span>
              <div className="path-input-row">
                <input
                  type="text"
                  value={settings.profilePath}
                  onChange={(event) => setField('profilePath', event.currentTarget.value)}
                  placeholder="Choose an exported PrusaSlicer configuration"
                  title={settings.profilePath}
                />
                <button type="button" onClick={() => void chooseProfile()} disabled={isBusy}>Browse</button>
              </div>
              <small>{settings.profilePath ? shortPath(settings.profilePath) : 'Export a known-good printer/material/print configuration from PrusaSlicer.'}</small>
            </label>
          </div>

          <div className="material-input-grid">
            <label>
              <span>Density g/cm³</span>
              <input
                type="number"
                min="0.1"
                step="0.01"
                value={settings.materialDensityGPerCm3}
                onChange={(event) => setField('materialDensityGPerCm3', event.currentTarget.value)}
                disabled={isBusy}
              />
            </label>
            <label>
              <span>Spool weight g</span>
              <input
                type="number"
                min="1"
                step="1"
                value={settings.spoolWeightG}
                onChange={(event) => setField('spoolWeightG', event.currentTarget.value)}
                disabled={isBusy}
              />
            </label>
            <label>
              <span>Spool cost</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={settings.spoolCost}
                onChange={(event) => setField('spoolCost', event.currentTarget.value)}
                disabled={isBusy}
              />
            </label>
            <label>
              <span>Currency</span>
              <input
                type="text"
                maxLength={6}
                value={settings.currency}
                onChange={(event) => setField('currency', event.currentTarget.value)}
                disabled={isBusy}
              />
            </label>
          </div>

          <div className="print-analysis-actions">
            <button type="button" className="analysis-detect-button" onClick={() => void detectSlicer()} disabled={isDetecting || isBusy}>
              {isDetecting ? 'Detecting…' : 'Detect slicer'}
            </button>
            <div className="analysis-run-group">
              <button type="button" className="analysis-baseline-button" onClick={() => void analyseBaseline()} disabled={!canAnalyse || isBusy}>
                {isAnalysingBaseline ? 'Analysing baseline…' : 'Analyse baseline'}
              </button>
              <button type="button" className="analysis-run-button" onClick={() => void compareStrategies()} disabled={!canAnalyse || isBusy}>
                {isComparing && comparisonProgress
                  ? `Running ${STRATEGY_LABELS[comparisonProgress.strategy]} (${comparisonProgress.index + 1}/4)…`
                  : 'Compare 4 strategies'}
              </button>
            </div>
          </div>

          {isBusy && (
            <section className="analysis-activity" role="status" aria-live="polite">
              <div className="analysis-activity-main">
                <span className="analysis-activity-spinner" aria-hidden="true" />
                <div className="analysis-activity-copy">
                  <strong>{activityTitle}</strong>
                  <span>{activityDetail}</span>
                  <small>PrusaSlicer is running locally on this computer. Modelarium does not upload your model.</small>
                </div>
              </div>

              {isComparing && comparisonProgress && (
                <div className="analysis-activity-strategies" aria-label="Strategy comparison progress">
                  {STRATEGIES.map((definition, index) => {
                    const state =
                      index < comparisonProgress.index
                        ? 'complete'
                        : index === comparisonProgress.index
                          ? 'active'
                          : 'pending'

                    return (
                      <div className={`analysis-activity-step ${state}`} key={definition.id}>
                        <span aria-hidden="true">{state === 'complete' ? '✓' : index + 1}</span>
                        <strong>{definition.label}</strong>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          <p className="print-analysis-note">
            Each strategy starts from your known-good PrusaSlicer profile. Modelarium applies only documented overrides, writes temporary G-code outside the library, parses real slicer metrics and removes the temporary files afterwards.
          </p>

          {error && <div className="print-analysis-error" role="alert">{error}</div>}

          {(hasComparison || isComparing) && (
            <section className="strategy-comparison" aria-label="Four-strategy Print Analysis comparison">
              <div className="strategy-comparison-heading">
                <div>
                  <div className="eyebrow">4-STRATEGY COMPARISON</div>
                  <h4>Real PrusaSlicer results</h4>
                </div>
                {balanced && <span className="balanced-badge">BALANCED REFERENCE</span>}
              </div>

              <div className="strategy-table-wrap">
                <table className="strategy-table">
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th>Time</th>
                      <th>Filament</th>
                      <th>Cost</th>
                      <th>Layer</th>
                      <th>Walls</th>
                      <th>Infill</th>
                      <th>Warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STRATEGIES.map((definition) => {
                      const strategyResult = comparisonResults[definition.id]
                      const isCurrent = comparisonProgress?.strategy === definition.id
                      return (
                        <tr key={definition.id} className={definition.id === 'balanced' ? 'strategy-balanced-row' : undefined}>
                          <td>
                            <strong>{definition.label}</strong>
                            <small>{definition.shortDescription}</small>
                          </td>
                          <td>{strategyResult ? formatDuration(strategyResult.estimatedSeconds) : isCurrent ? 'Running…' : '—'}</td>
                          <td>{formatWeight(strategyResult)}</td>
                          <td>{formatCost(strategyResult)}</td>
                          <td>{formatLayer(strategyResult)}</td>
                          <td>{formatWalls(strategyResult)}</td>
                          <td>{formatInfill(strategyResult)}</td>
                          <td>{strategyResult ? strategyResult.warnings.length : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <p className="strategy-disclaimer">
                Strategy presets are comparison heuristics, not guarantees of strength, finish or suitability.
              </p>

              {comparisonInsights.length > 0 && (
                <section className="analysis-insights" aria-label="Print Analysis quick read">
                  <div className="analysis-insights-heading">
                    <div>
                      <div className="eyebrow">PRINT ANALYSIS QUICK READ</div>
                      <h5>What changes compared with Balanced?</h5>
                      <p className="analysis-insights-context">Based on real PrusaSlicer results for this model.</p>
                    </div>
                  </div>

                  <div className="analysis-insight-grid">
                    {comparisonInsights.map((insight) => (
                      <article className="analysis-insight-card" key={insight.title}>
                        <strong>{insight.title}</strong>
                        <p>{insight.body}</p>
                      </article>
                    ))}
                  </div>

                  <div className="analysis-best-for">
                    <div>
                      <strong>Fast</strong>
                      <span>Best suited when elapsed print time matters most.</span>
                    </div>
                    <div className="analysis-best-for-balanced">
                      <strong>Balanced</strong>
                      <span>General-purpose reference for everyday printing.</span>
                    </div>
                    <div>
                      <strong>Strength Optimised</strong>
                      <span>Best suited when wall and infill emphasis matters more than material use.</span>
                    </div>
                    <div>
                      <strong>Quality Optimised</strong>
                      <span>Best suited when finer layer resolution matters most.</span>
                    </div>
                  </div>

                  <p className="analysis-insights-note">
                    These observations are deterministic comparisons of this model's real slicer results. They are not an AI recommendation and do not claim a universal best strategy.
                  </p>
                </section>
              )}

              <div className="strategy-warning-grid">
                {STRATEGIES.map((definition) => {
                  const strategyResult = comparisonResults[definition.id]
                  if (!strategyResult?.warnings.length) return null
                  return (
                    <details className="strategy-warning-card" key={definition.id}>
                      <summary>{definition.label}: {strategyResult.warnings.length} slicer warning{strategyResult.warnings.length === 1 ? '' : 's'}</summary>
                      <ul>
                        {strategyResult.warnings.map((warning, index) => (
                          <li key={`${definition.id}-${warning}-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  )
                })}
              </div>
            </section>
          )}

          {result && (
            <div className="analysis-result">
              <div className="analysis-result-header analysis-result-header-polished">
                <div>
                  <div className="eyebrow">BASELINE RESULT</div>
                  <div className="analysis-result-source-line">
                    <strong>{result.slicerName}{result.slicerVersion ? ` ${result.slicerVersion}` : ''}</strong>
                    <span>Original profile — no strategy overrides</span>
                  </div>
                </div>
              </div>
              <div className="analysis-metrics analysis-metrics-five">
                <div><span>Estimated time</span><strong>{formatDuration(result.estimatedSeconds)}</strong></div>
                <div><span>Filament length</span><strong>{result.filamentLengthMm != null ? `${(result.filamentLengthMm / 1000).toFixed(2)} m` : '—'}</strong></div>
                <div><span>Filament volume</span><strong>{result.filamentVolumeCm3 != null ? `${result.filamentVolumeCm3.toFixed(2)} cm³` : '—'}</strong></div>
                <div><span>Estimated filament</span><strong>{formatWeight(result)}</strong></div>
                <div className="analysis-cost"><span>Estimated material cost</span><strong>{formatCost(result)}</strong></div>
              </div>
              {result.warnings.length > 0 && (
                <div className="analysis-warnings">
                  <strong>⚠ Slicer warnings</strong>
                  <ul>
                    {result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
