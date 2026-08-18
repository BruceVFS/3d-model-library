import { useEffect, useState } from 'react'
import type { LibraryFile } from '../lib/library'
import {
  analyseDesktopPrint,
  chooseDesktopPrusaSlicerConfig,
  chooseDesktopPrusaSlicerExecutable,
  detectDesktopPrusaSlicer,
  type PrintAnalysisResult,
} from '../lib/platform'

type PrintAnalysisPanelProps = {
  file?: LibraryFile
  result?: PrintAnalysisResult
  onResultChange?: (result?: PrintAnalysisResult) => void
}

type PrintAnalysisSettings = {
  slicerPath: string
  profilePath: string
  materialDensityGPerCm3: string
  spoolWeightG: string
  spoolCost: string
  currency: string
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

export function formatPrintAnalysisSummary(result: PrintAnalysisResult) {
  const parts = [formatDuration(result.estimatedSeconds)]
  if (result.filamentWeightG != null) parts.push(`${result.filamentWeightG.toFixed(1)} g`)
  if (result.materialCost != null) parts.push(`${result.currency}${result.materialCost.toFixed(2)}`)
  return parts.join(' · ')
}

export function PrintAnalysisPanel({ file, result: controlledResult, onResultChange }: PrintAnalysisPanelProps) {
  const [settings, setSettings] = useState<PrintAnalysisSettings>(() => readSettings())
  const [localResult, setLocalResult] = useState<PrintAnalysisResult>()
  const result = onResultChange ? controlledResult : localResult
  const setResult = (next?: PrintAnalysisResult) => {
    if (onResultChange) onResultChange(next)
    else setLocalResult(next)
  }
  const [error, setError] = useState<string>()
  const [isAnalysing, setIsAnalysing] = useState(false)
  const [isDetecting, setIsDetecting] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Persistence is optional; the settings still work for this session.
    }
  }, [settings])

  useEffect(() => {
    setError(undefined)
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

  const analyse = async () => {
    if (!file?.nativePath || !density || !spoolWeight || !spoolCost) return
    setIsAnalysing(true)
    setError(undefined)
    setResult(undefined)
    try {
      const analysis = await analyseDesktopPrint({
        modelPath: file.nativePath,
        slicerPath: settings.slicerPath.trim(),
        configPath: settings.profilePath.trim(),
        materialDensityGPerCm3: density,
        spoolWeightG: spoolWeight,
        spoolCost,
        currency: settings.currency.trim() || 'R',
      })
      setResult(analysis)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Print analysis failed.')
    } finally {
      setIsAnalysing(false)
    }
  }

  return (
    <section className="print-analysis-panel" aria-label="Print Analysis">
      <div className="print-analysis-heading">
        <div>
          <div className="eyebrow">PRINT ANALYSIS</div>
          <h3>Baseline slicer analysis</h3>
        </div>
        <span className="desktop-only-badge">WINDOWS DESKTOP</span>
      </div>

      {file?.extension !== 'stl' || !file.nativePath ? (
        <p className="print-analysis-empty">Select an STL file to run a baseline print analysis.</p>
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
                <button type="button" onClick={() => void chooseSlicer()}>Browse</button>
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
                <button type="button" onClick={() => void chooseProfile()}>Browse</button>
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
              />
            </label>
            <label>
              <span>Currency</span>
              <input
                type="text"
                maxLength={6}
                value={settings.currency}
                onChange={(event) => setField('currency', event.currentTarget.value)}
              />
            </label>
          </div>

          <div className="print-analysis-actions">
            <button type="button" className="analysis-detect-button" onClick={() => void detectSlicer()} disabled={isDetecting}>
              {isDetecting ? 'Detecting…' : 'Detect slicer'}
            </button>
            <button type="button" className="analysis-run-button" onClick={() => void analyse()} disabled={!canAnalyse || isAnalysing}>
              {isAnalysing ? 'Analysing…' : 'Analyse this STL'}
            </button>
          </div>

          <p className="print-analysis-note">
            Modelarium reads the source STL and profile, writes temporary G-code outside the library, parses the slicer metrics and removes the temporary file afterwards.
          </p>

          {error && <div className="print-analysis-error" role="alert">{error}</div>}

          {result && (
            <div className="analysis-result">
              <div className="analysis-result-header">
                <div>
                  <div className="eyebrow">BASELINE RESULT</div>
                  <strong>{result.slicerName}{result.slicerVersion ? ` ${result.slicerVersion}` : ''}</strong>
                </div>
                <span>real slicer output</span>
              </div>
              <div className="analysis-metrics">
                <div><span>Estimated time</span><strong>{formatDuration(result.estimatedSeconds)}</strong></div>
                <div><span>Filament length</span><strong>{result.filamentLengthMm != null ? `${(result.filamentLengthMm / 1000).toFixed(2)} m` : '—'}</strong></div>
                <div><span>Filament volume</span><strong>{result.filamentVolumeCm3 != null ? `${result.filamentVolumeCm3.toFixed(2)} cm³` : '—'}</strong></div>
                <div><span>Estimated filament</span><strong>{result.filamentWeightG != null ? `${result.filamentWeightG.toFixed(1)} g` : '—'}</strong></div>
                <div className="analysis-cost"><span>Estimated material cost</span><strong>{result.materialCost != null ? `${result.currency}${result.materialCost.toFixed(2)}` : '—'}</strong></div>
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
