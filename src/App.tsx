import { useEffect, useMemo, useState } from 'react'
import packageJson from '../package.json'
import { ImagePreview, PreviewFallback, StlThumbnail, StlViewer, ThreeMfThumbnail, ThreeMfViewer } from './components/Preview'
import { PrintAnalysisPanel, formatPrintAnalysisSummary } from './components/PrintAnalysisPanel'
import {
  duplicateSignature,
  findPossibleDuplicates,
  formatBytes,
  groupIntoCollections,
  scanDirectory,
  toDisplayName,
  type LibraryFile,
  type ModelCollection,
  type ScanProgress,
  type SupportedExtension,
} from './lib/library'
import {
  chooseAndScanDesktopLibrary,
  isDesktopApp,
  openDesktopContainingFolder,
  revealDesktopFile,
  type PrintAnalysisResult,
  type PrintStrategyResults,
} from './lib/platform'

const APP_VERSION = packageJson.version

type ThemePreference = 'system' | 'light' | 'dark'
type AssociatedFileFilter = 'all' | 'models' | 'images' | 'packages'

const THEME_STORAGE_KEY = 'modelarium-theme'

function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Local storage can be unavailable in restricted browser contexts.
  }

  return 'system'
}

function getRuntimeLabel(desktopMode: boolean) {
  if (desktopMode) return 'Windows Desktop'

  const hostname = window.location.hostname.toLowerCase()
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  return localHosts.has(hostname) || hostname.endsWith('.localhost') ? 'Local Web' : 'Hosted Web'
}

const FILTERS: Array<{ value: 'all' | SupportedExtension; label: string }> = [
  { value: 'all', label: 'All files' },
  { value: 'stl', label: 'STL' },
  { value: '3mf', label: '3MF' },
  { value: 'zip', label: 'ZIP' },
  { value: 'png', label: 'Images' },
]

function collectionMatchesType(collection: ModelCollection, filter: 'all' | SupportedExtension) {
  if (filter === 'all') return true
  if (filter === 'png') return collection.imageFiles.length > 0
  return collection.files.some((file) => file.extension === filter)
}

function Cover({ collection }: { collection: ModelCollection }) {
  const cover = collection.cover
  if (!cover) return <PreviewFallback />

  if (['jpg', 'jpeg', 'png', 'webp'].includes(cover.extension)) {
    return <ImagePreview file={cover} />
  }

  if (cover.extension === 'stl') return <StlThumbnail file={cover} />
  if (cover.extension === '3mf') return <ThreeMfThumbnail file={cover} />
  return <PreviewFallback label={`${cover.extension.toUpperCase()} model`} />
}

function FileBadge({ file }: { file: LibraryFile }) {
  return <span className={`file-badge file-${file.extension}`}>{file.extension.toUpperCase()}</span>
}

function FileThumbnail({ file }: { file: LibraryFile }) {
  if (file.extension === 'stl') {
    return <StlThumbnail file={file} />
  }

  if (file.extension === '3mf') {
    return <ThreeMfThumbnail file={file} />
  }

  if (['jpg', 'jpeg', 'png', 'webp'].includes(file.extension)) {
    return <ImagePreview file={file} />
  }

  return <PreviewFallback label={file.extension.toUpperCase()} />
}

export default function App() {
  const [rootName, setRootName] = useState<string>()
  const [rootPath, setRootPath] = useState<string>()
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [progress, setProgress] = useState<ScanProgress>()
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string>()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | SupportedExtension>('all')
  const [selectedId, setSelectedId] = useState<string>()
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const [associatedFileQuery, setAssociatedFileQuery] = useState('')
  const [associatedFileFilter, setAssociatedFileFilter] = useState<AssociatedFileFilter>('all')
  const [activeFolderPath, setActiveFolderPath] = useState('')
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false)
  const [isPrintAnalysisOpen, setIsPrintAnalysisOpen] = useState(false)
  const [isDesktopAnalysisNoticeOpen, setIsDesktopAnalysisNoticeOpen] = useState(false)
  const [returnToPreviewAfterAnalysis, setReturnToPreviewAfterAnalysis] = useState(false)
  const [returnToAnalysisAfterPreview, setReturnToAnalysisAfterPreview] = useState(false)
  const [analysisResults, setAnalysisResults] = useState<Record<string, PrintAnalysisResult>>({})
  const [strategyResults, setStrategyResults] = useState<Record<string, PrintStrategyResults>>({})
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)
  const [showIntro, setShowIntro] = useState(true)
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference())

  const desktopMode = isDesktopApp()
  const runtimeLabel = getRuntimeLabel(desktopMode)
  const supportsDirectoryAccess = desktopMode || 'showDirectoryPicker' in window
  const isFirefox = !desktopMode && navigator.userAgent.includes('Firefox/')
  const folderAccessMessage = isFirefox
    ? "Firefox doesn't support Modelarium's direct library access. Use Modelarium Desktop for the full experience, or open Modelarium in Chrome or Edge."
    : "This browser doesn't support Modelarium's direct library access. Use Modelarium Desktop for the full experience, or open Modelarium in Chrome or Edge."

  const collections = useMemo(() => groupIntoCollections(files, rootName), [files, rootName])
  const possibleDuplicates = useMemo(() => findPossibleDuplicates(files), [files])
  const duplicateFileIds = useMemo(
    () => new Set(Array.from(possibleDuplicates.values()).flatMap((matches) => matches.map((file) => file.id))),
    [possibleDuplicates],
  )
  const duplicateFileCount = useMemo(
    () => Array.from(possibleDuplicates.values()).reduce((sum, matches) => sum + matches.length, 0),
    [possibleDuplicates],
  )
  const collectionDuplicateCount = (collection: ModelCollection) =>
    collection.files.filter((file) => duplicateFileIds.has(file.id)).length
  const modelCount = useMemo(() => collections.filter((collection) => collection.kind === 'model').length, [collections])

  const folderPaths = useMemo(() => {
    const paths = new Set<string>()

    for (const collection of collections) {
      if (!collection.folderPath) continue
      const segments = collection.folderPath.split('/')
      for (let index = 1; index <= segments.length; index += 1) {
        paths.add(segments.slice(0, index).join('/'))
      }
    }

    return Array.from(paths).sort((a, b) => a.localeCompare(b))
  }, [collections])

  const childFolders = useMemo(() => {
    const prefix = activeFolderPath ? `${activeFolderPath}/` : ''

    return folderPaths
      .filter((path) => {
        if (path === activeFolderPath) return false
        if (!path.startsWith(prefix)) return false
        const remainder = path.slice(prefix.length)
        if (!remainder || remainder.includes('/')) return false

        // Only show a hierarchy chip when this folder is genuinely a branch
        // containing model collections below it. Terminal model folders belong
        // in the visual gallery instead of being duplicated as navigation.
        return collections.some((collection) => collection.folderPath.startsWith(`${path}/`))
      })
      .map((path) => ({
        path,
        sourceName: path.split('/').at(-1) ?? path,
        name: toDisplayName(path.split('/').at(-1) ?? path),
        count: collections.filter(
          (collection) => collection.folderPath === path || collection.folderPath.startsWith(`${path}/`),
        ).length,
      }))
  }, [activeFolderPath, collections, folderPaths])

  const folderCrumbs = useMemo(() => {
    if (!activeFolderPath) return []
    const segments = activeFolderPath.split('/')
    return segments.map((sourceName, index) => ({
      sourceName,
      name: toDisplayName(sourceName),
      path: segments.slice(0, index + 1).join('/'),
    }))
  }, [activeFolderPath])

  const scopedCollections = useMemo(() => {
    if (!activeFolderPath) return collections
    return collections.filter(
      (collection) =>
        collection.folderPath === activeFolderPath ||
        collection.folderPath.startsWith(`${activeFolderPath}/`),
    )
  }, [activeFolderPath, collections])

  const directCollections = useMemo(() => {
    const prefix = activeFolderPath ? `${activeFolderPath}/` : ''
    return collections.filter((collection) => {
      if (collection.folderPath === activeFolderPath) return true
      if (!collection.folderPath.startsWith(prefix)) return false

      const remainder = collection.folderPath.slice(prefix.length)
      if (!remainder || remainder.includes('/')) return false

      // If a direct child contains deeper model collections, it is a navigation
      // branch and is shown above as a folder chip. Otherwise it is a model card.
      return !collections.some((candidate) => candidate.folderPath.startsWith(`${collection.folderPath}/`))
    })
  }, [activeFolderPath, collections])

  const filteredCollections = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const source = needle ? scopedCollections : directCollections

    return source.filter((collection) => {
      if (!collectionMatchesType(collection, typeFilter)) return false
      if (duplicatesOnly && collectionDuplicateCount(collection) === 0) return false
      if (!needle) return true

      return (
        collection.name.toLowerCase().includes(needle) ||
        collection.sourceName.toLowerCase().includes(needle) ||
        collection.folderPath.toLowerCase().includes(needle) ||
        collection.files.some((file) => file.name.toLowerCase().includes(needle))
      )
    })
  }, [directCollections, duplicateFileIds, duplicatesOnly, query, scopedCollections, typeFilter])

  const matchingScopeCollections = useMemo(() => {
    return scopedCollections.filter((collection) => {
      if (!collectionMatchesType(collection, typeFilter)) return false
      if (duplicatesOnly && collectionDuplicateCount(collection) === 0) return false
      const needle = query.trim().toLowerCase()
      if (!needle) return true

      return (
        collection.name.toLowerCase().includes(needle) ||
        collection.sourceName.toLowerCase().includes(needle) ||
        collection.folderPath.toLowerCase().includes(needle) ||
        collection.files.some((file) => file.name.toLowerCase().includes(needle))
      )
    })
  }, [duplicateFileIds, duplicatesOnly, query, scopedCollections, typeFilter])

  const matchingScopeCount = matchingScopeCollections.length
  const matchingModelCount = matchingScopeCollections.filter((collection) => collection.kind === 'model').length
  const hasMatchingLooseRootFiles = matchingScopeCollections.some((collection) => collection.kind === 'loose-root')
  const selected = collections.find((collection) => collection.id === selectedId)
  const defaultPreviewFile = selected?.geometryFiles.find((file) => file.extension === 'stl') ?? selected?.cover
  const selectedPreviewFile = selected?.files.find((file) => file.id === selectedFileId) ?? defaultPreviewFile

  const associatedFileCounts = useMemo(() => {
    const selectedFiles = selected?.files ?? []
    return {
      all: selectedFiles.length,
      models: selectedFiles.filter((file) => file.extension === 'stl' || file.extension === '3mf').length,
      images: selectedFiles.filter((file) => ['jpg', 'jpeg', 'png', 'webp'].includes(file.extension)).length,
      packages: selectedFiles.filter((file) => file.extension === 'zip').length,
    }
  }, [selected])

  const filteredAssociatedFiles = useMemo(() => {
    const needle = associatedFileQuery.trim().toLowerCase()
    const selectedFiles = selected?.files ?? []

    const matchesCategory = (file: LibraryFile) => {
      if (associatedFileFilter === 'all') return true
      if (associatedFileFilter === 'models') return file.extension === 'stl' || file.extension === '3mf'
      if (associatedFileFilter === 'images') return ['jpg', 'jpeg', 'png', 'webp'].includes(file.extension)
      return file.extension === 'zip'
    }

    return selectedFiles
      .filter((file) => matchesCategory(file) && (!needle || file.name.toLowerCase().includes(needle)))
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))
  }, [associatedFileFilter, associatedFileQuery, selected])
  const selectedDuplicateMatches = selectedPreviewFile
    ? possibleDuplicates.get(duplicateSignature(selectedPreviewFile))
    : undefined
  const selectedDuplicateOthers = selectedDuplicateMatches?.filter((file) => file.id !== selectedPreviewFile?.id) ?? []
  const canExpandPreview = Boolean(
    selectedPreviewFile &&
      (selectedPreviewFile.extension === 'stl' ||
        selectedPreviewFile.extension === '3mf' ||
        ['jpg', 'jpeg', 'png', 'webp'].includes(selectedPreviewFile.extension)),
  )
  const isStlSelected = selectedPreviewFile?.extension === 'stl'
  const canAnalyseSelected = Boolean(isStlSelected && selectedPreviewFile?.nativePath)
  const selectedAnalysisResult = selectedPreviewFile ? analysisResults[selectedPreviewFile.id] : undefined
  const selectedStrategyResults: PrintStrategyResults = selectedPreviewFile ? (strategyResults[selectedPreviewFile.id] ?? {}) : {}
  const selectedSummaryResult = selectedStrategyResults.balanced ?? selectedAnalysisResult
  const printAnalysisActionTitle = !isStlSelected
    ? 'Select an STL file to use Print Analysis.'
    : !desktopMode
      ? 'Print Analysis requires the installable Windows Desktop edition.'
      : !canAnalyseSelected
        ? 'Print Analysis is unavailable for this file.'
        : 'Analyse the selected STL with PrusaSlicer.'

  const openExpandedPreview = (returnToAnalysis = false) => {
    if (!canExpandPreview) return
    setReturnToPreviewAfterAnalysis(false)
    setReturnToAnalysisAfterPreview(returnToAnalysis)
    setIsPrintAnalysisOpen(false)
    setIsPreviewExpanded(true)
  }
  const closeExpandedPreview = () => {
    setIsPreviewExpanded(false)
    if (returnToAnalysisAfterPreview) {
      setReturnToAnalysisAfterPreview(false)
      setIsPrintAnalysisOpen(true)
    }
  }
  const openPrintAnalysis = (returnToPreview = false) => {
    if (!isStlSelected) return

    if (!desktopMode) {
      setIsDesktopAnalysisNoticeOpen(true)
      return
    }

    if (!canAnalyseSelected) return
    setReturnToAnalysisAfterPreview(false)
    setReturnToPreviewAfterAnalysis(returnToPreview)
    setIsPreviewExpanded(false)
    setIsPrintAnalysisOpen(true)
  }
  const closePrintAnalysis = () => {
    setIsPrintAnalysisOpen(false)
    if (returnToPreviewAfterAnalysis) {
      setReturnToPreviewAfterAnalysis(false)
      setIsPreviewExpanded(true)
    }
  }
  const dismissModelModals = () => {
    setIsPreviewExpanded(false)
    setIsPrintAnalysisOpen(false)
    setIsDesktopAnalysisNoticeOpen(false)
    setReturnToPreviewAfterAnalysis(false)
    setReturnToAnalysisAfterPreview(false)
  }
  const updateSelectedAnalysisResult = (result?: PrintAnalysisResult) => {
    if (!selectedPreviewFile) return
    setAnalysisResults((current) => {
      const next = { ...current }
      if (result) next[selectedPreviewFile.id] = result
      else delete next[selectedPreviewFile.id]
      return next
    })
  }
  const updateSelectedStrategyResults = (results: PrintStrategyResults) => {
    if (!selectedPreviewFile) return
    setStrategyResults((current) => ({ ...current, [selectedPreviewFile.id]: results }))
  }

  useEffect(() => {
    setAssociatedFileQuery('')
    setAssociatedFileFilter('all')
  }, [selectedId])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = () => {
      const resolved = themePreference === 'system' ? (media.matches ? 'dark' : 'light') : themePreference
      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved
    }

    applyTheme()

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePreference)
    } catch {
      // Theme persistence is optional; the selected theme still applies for this session.
    }

    if (themePreference !== 'system') return

    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [themePreference])

  useEffect(() => {
    if (!isAboutOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsAboutOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isAboutOpen])

  useEffect(() => {
    if (!isPreviewExpanded) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeExpandedPreview()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [isPreviewExpanded, returnToAnalysisAfterPreview])

  useEffect(() => {
    if (!isDesktopAnalysisNoticeOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsDesktopAnalysisNoticeOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [isDesktopAnalysisNoticeOpen])

  useEffect(() => {
    if (!isPrintAnalysisOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePrintAnalysis()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [isPrintAnalysisOpen, returnToPreviewAfterAnalysis])

  const chooseFolder = async () => {
    if (!supportsDirectoryAccess) {
      setScanError(folderAccessMessage)
      return
    }

    try {
      setScanError(undefined)
      setFiles([])
      setSelectedId(undefined)
      setSelectedFileId(undefined)
      setActiveFolderPath('')
      setIsPreviewExpanded(false)
      setDuplicatesOnly(false)
      setProgress(undefined)
      setIsScanning(true)

      if (desktopMode) {
        setProgress({ folders: 0, filesVisited: 0, supportedFiles: 0, currentPath: 'Waiting for folder selection…' })
        const scan = await chooseAndScanDesktopLibrary()
        if (!scan) return

        setRootName(scan.rootName)
        setShowIntro(false)
        setRootPath(scan.rootPath)
        setFiles(
          scan.files.map((file) => ({
            ...file,
            id: file.relativePath.toLowerCase(),
          })),
        )
        setProgress({
          folders: scan.foldersVisited,
          filesVisited: scan.filesVisited,
          supportedFiles: scan.files.length,
          currentPath: 'Complete',
        })
        if (scan.warnings.length > 0) console.warn('Scan warnings', scan.warnings)
        return
      }

      const root = await window.showDirectoryPicker({ mode: 'read', id: '3d-model-library' })
      setRootName(root.name)
      setShowIntro(false)
      setRootPath(undefined)
      const discovered = await scanDirectory(root, setProgress)
      setFiles(discovered)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error(error)
      setScanError(error instanceof Error ? error.message : 'Unable to scan the selected folder.')
    } finally {
      setIsScanning(false)
    }
  }

  const openCollectionFolder = async (collection: ModelCollection) => {
    const representativeFile = collection.files[0]
    if (!desktopMode || !representativeFile?.nativePath) return

    try {
      setScanError(undefined)
      await openDesktopContainingFolder(representativeFile)
    } catch (error) {
      console.error(error)
      setScanError(error instanceof Error ? error.message : 'Unable to open the source folder.')
    }
  }

  const revealSelectedFile = async () => {
    if (!desktopMode || !selectedPreviewFile?.nativePath) return

    try {
      setScanError(undefined)
      await revealDesktopFile(selectedPreviewFile)
    } catch (error) {
      console.error(error)
      setScanError(error instanceof Error ? error.message : 'Unable to reveal the selected file.')
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)

  const navigateFolder = (path: string) => {
    setActiveFolderPath(path)
    setSelectedId(undefined)
    setSelectedFileId(undefined)
    setIsPreviewExpanded(false)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <img
            className="brand-mark"
            src={`${import.meta.env.BASE_URL}modelarium-icon.png`}
            alt=""
            aria-hidden="true"
          />
          <div>
            <h1>Modelarium</h1>
            <p>
              3D Model Library · <span className="app-version">v{APP_VERSION}</span> ·{' '}
              <span className="runtime-label">{runtimeLabel}</span>
            </p>
          </div>
        </div>

        <div className="topbar-actions">
          <label className="theme-control" title="Colour theme">
            <span aria-hidden="true">◐</span>
            <select
              aria-label="Colour theme"
              value={themePreference}
              onChange={(event) => setThemePreference(event.currentTarget.value as ThemePreference)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          <button
            type="button"
            className="secondary-button"
            onClick={() => setIsAboutOpen(true)}
            aria-haspopup="dialog"
          >
            About
          </button>

          <button
            className="primary-button"
            onClick={chooseFolder}
            disabled={isScanning || !supportsDirectoryAccess}
            title={!supportsDirectoryAccess ? folderAccessMessage : undefined}
          >
            {isScanning ? 'Scanning…' : rootName ? 'Choose another folder' : 'Choose library folder'}
          </button>
        </div>
      </header>

      <main className="main-layout">
        <section className="catalogue-panel">
          {showIntro && (
            <section className="app-intro" aria-label="Modelarium 3D Model Library introduction">
              <div className="app-intro-copy">
                <div className="eyebrow">MODELARIUM 3D MODEL LIBRARY</div>
                <h3>Your 3D models, finally easy to rediscover.</h3>
                <p>
                  Modelarium turns your existing folder collection of STL, 3MF, ZIP and image files into a visual
                  catalogue without reorganising your source files.
                </p>

                <div className="app-value-strip" aria-label="Modelarium benefits">
                  <span>Browse visually</span>
                  <span>Keep your folders</span>
                  <span>Preview in 3D</span>
                  <span>Spot possible duplicates</span>
                </div>

                {rootName ? (
                  <button
                    type="button"
                    className="secondary-button intro-action"
                    onClick={() => setShowIntro(false)}
                  >
                    Continue to catalogue
                  </button>
                ) : (
                  <button
                    className="primary-button large"
                    onClick={chooseFolder}
                    disabled={isScanning || !supportsDirectoryAccess}
                    title={!supportsDirectoryAccess ? folderAccessMessage : undefined}
                  >
                    {isScanning ? 'Scanning…' : 'Choose library folder'}
                  </button>
                )}

                {!supportsDirectoryAccess && (
                  <p className="muted" role="status">
                    {folderAccessMessage}
                  </p>
                )}
              </div>

              <img
                src={`${import.meta.env.BASE_URL}images/model-library-intro.png`}
                alt="Abstract 3D model catalogue preview"
              />
            </section>
          )}

          <div className="hero-row">
            <div>
              <div className="eyebrow">SOURCE LIBRARY</div>
              <h2 title={rootPath}>{rootName ?? 'No folder selected'}</h2>
              {(rootName || supportsDirectoryAccess) && (
                <p className="muted">
                  {rootName
                    ? 'Your source files remain in place. The catalogue only reads them.'
                    : 'Choose your 3D model library folder to begin.'}
                </p>
              )}
            </div>

            <div className="stat-row">
              <div className="stat-card"><strong>{modelCount}</strong><span>Models</span></div>
              <div className="stat-card"><strong>{files.length}</strong><span>Files</span></div>
              <div className="stat-card"><strong>{formatBytes(totalBytes)}</strong><span>Size</span></div>
            </div>
          </div>

          {progress && isScanning && (
            <div className="scan-status">
              <div className="scan-pulse" />
              <div>
                <strong>Scanning {progress.currentPath}</strong>
                <span>{progress.folders} folders · {progress.supportedFiles} supported files found</span>
              </div>
            </div>
          )}

          {scanError && <div className="error-banner">{scanError}</div>}

          <div className="toolbar">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models, folders and filenames"
              />
            </label>

            <div className="filter-strip" aria-label="File type filter">
              {FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  className={typeFilter === filter.value ? 'filter-button active' : 'filter-button'}
                  onClick={() => setTypeFilter(filter.value)}
                >
                  {filter.label}
                </button>
              ))}

              <button
                type="button"
                className={duplicatesOnly ? 'filter-button duplicate-filter active' : 'filter-button duplicate-filter'}
                onClick={() => setDuplicatesOnly((value) => !value)}
                disabled={possibleDuplicates.size === 0}
                title="Files with the same normalised name and exact byte size"
              >
                Possible duplicates{possibleDuplicates.size > 0 ? ` (${possibleDuplicates.size})` : ''}
              </button>
            </div>
          </div>

          {rootName && !isScanning && possibleDuplicates.size > 0 && (
            <div className="duplicate-summary" role="status">
              <strong>
                {possibleDuplicates.size} possible duplicate group{possibleDuplicates.size === 1 ? '' : 's'}
              </strong>
              <span>{duplicateFileCount} files share the same normalised filename and exact byte size.</span>
            </div>
          )}

          {rootName && !isScanning && (
            <section className="folder-browser" aria-label="Folder hierarchy">
              <div className="folder-browser-heading">
                <div>
                  <div className="eyebrow">FOLDER HIERARCHY</div>
                  <div className="folder-breadcrumbs">
                    <button
                      type="button"
                      className={!activeFolderPath ? 'breadcrumb-button current' : 'breadcrumb-button'}
                      onClick={() => navigateFolder('')}
                    >
                      {rootName}
                    </button>

                    {folderCrumbs.map((crumb, index) => (
                      <span className="breadcrumb-part" key={crumb.path}>
                        <span className="breadcrumb-separator">/</span>
                        <button
                          type="button"
                          className={index === folderCrumbs.length - 1 ? 'breadcrumb-button current' : 'breadcrumb-button'}
                          onClick={() => navigateFolder(crumb.path)}
                          title={crumb.sourceName !== crumb.name ? `Source folder: ${crumb.sourceName}` : undefined}
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <span className="folder-scope-count">
                  {matchingModelCount} model{matchingModelCount === 1 ? '' : 's'} in scope
                  {hasMatchingLooseRootFiles ? ' · root files available' : ''}
                </span>
              </div>

              {childFolders.length > 0 && (
                <div className="folder-children">
                  {childFolders.map((folder) => (
                    <button
                      type="button"
                      className="folder-chip"
                      key={folder.path}
                      onClick={() => navigateFolder(folder.path)}
                      title={`Browse source folder: ${folder.path}`}
                    >
                      <span className="folder-chip-icon" aria-hidden="true">▱</span>
                      <span>{folder.name}</span>
                      <strong>{folder.count}</strong>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {!rootName && !showIntro && (
            <div className="empty-state">
              <div className="empty-icon">◇</div>
              <h3>Your models, visually organised</h3>
              <p>
                {supportsDirectoryAccess
                  ? 'Select a folder. The app scans it recursively without moving, renaming, extracting or modifying anything.'
                  : folderAccessMessage}
              </p>
              <button
                className="primary-button large"
                onClick={chooseFolder}
                disabled={isScanning || !supportsDirectoryAccess}
                title={!supportsDirectoryAccess ? folderAccessMessage : undefined}
              >
                Choose library folder
              </button>
            </div>
          )}

          {rootName && !isScanning && matchingScopeCount === 0 && (
            <div className="empty-state compact">
              <h3>No matching models</h3>
              <p>Try a different search or file-type filter.</p>
            </div>
          )}

          <div className="gallery">
            {filteredCollections.map((collection) => {
              const duplicateCount = collectionDuplicateCount(collection)

              return (
                <article
                  key={collection.id}
                  className={[
                    'model-card',
                    collection.kind === 'loose-root' ? 'loose-files-card' : '',
                    selectedId === collection.id ? 'selected' : '',
                  ].filter(Boolean).join(' ')}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedId(collection.id)
                    setSelectedFileId(undefined)
                    setIsPreviewExpanded(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedId(collection.id)
                      setSelectedFileId(undefined)
                      setIsPreviewExpanded(false)
                    }
                  }}
                >
                  <div className="model-cover">
                    <Cover collection={collection} />

                    {desktopMode && collection.files[0]?.nativePath && (
                      <button
                        type="button"
                        className="card-folder-action"
                        onClick={(event) => {
                          event.stopPropagation()
                          void openCollectionFolder(collection)
                        }}
                        title="Open source folder in Windows Explorer"
                        aria-label={`Open source folder for ${collection.name}`}
                      >
                        <span aria-hidden="true">▣</span>
                        <span>Open folder</span>
                      </button>
                    )}

                    {duplicateCount > 0 && (
                      <span
                        className="duplicate-card-badge"
                        title={`${duplicateCount} file${duplicateCount === 1 ? '' : 's'} in this collection have possible duplicate matches`}
                      >
                        POSSIBLE DUP{duplicateCount === 1 ? '' : ` · ${duplicateCount} FILES`}
                      </span>
                    )}
                  </div>

                  <div className="model-card-body">
                    <div className="model-title-row">
                      <h3
                        title={
                          collection.sourceName !== collection.name
                            ? `Source folder: ${collection.sourceName}`
                            : collection.name
                        }
                      >
                        {collection.name}
                      </h3>
                      <span>{collection.files.length}</span>
                    </div>

                    <div className="folder-path" title={collection.folderPath || rootName || 'Selected folder'}>
                      {collection.kind === 'loose-root'
                        ? `${rootName ?? 'Selected folder'} library root`
                        : collection.folderPath || 'Selected folder'}
                    </div>

                    <div className="badges">
                      {collection.kind === 'loose-root' && <span className="collection-kind-badge">ROOT FILES</span>}
                      {Array.from(new Set(collection.files.map((file) => file.extension)))
                        .slice(0, 5)
                        .map((ext) => (
                          <span key={ext} className={`file-badge file-${ext}`}>{ext.toUpperCase()}</span>
                        ))}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        {selected && (
          <aside className="detail-panel">
            <button
              className="close-button"
              aria-label="Close details"
              onClick={() => {
                setSelectedId(undefined)
                setSelectedFileId(undefined)
                setIsPreviewExpanded(false)
              }}
            >
              ×
            </button>

            <div className="detail-heading">
              <div className="eyebrow">
                {selected.kind === 'loose-root' ? 'LOOSE LIBRARY FILES' : 'MODEL COLLECTION'}
              </div>
              <h2>{selected.name}</h2>
              <p title={rootPath}>
                <span className="detail-source-label">Source:</span>{' '}
                {selected.kind === 'loose-root'
                  ? `${rootName ?? 'Selected folder'} (selected library root)`
                  : selected.folderPath || rootName || 'Selected folder'}
              </p>

            </div>

            <div className="detail-sticky-stack">
              <div className="detail-preview-stage">
              {selectedPreviewFile?.extension === 'stl' ? (
                <StlViewer file={selectedPreviewFile} />
              ) : selectedPreviewFile?.extension === '3mf' ? (
                <ThreeMfViewer file={selectedPreviewFile} />
              ) : selectedPreviewFile && ['jpg', 'jpeg', 'png', 'webp'].includes(selectedPreviewFile.extension) ? (
                <div className="detail-image"><ImagePreview file={selectedPreviewFile} /></div>
              ) : selectedPreviewFile ? (
                <div className="detail-image">
                  <PreviewFallback label={`${selectedPreviewFile.extension.toUpperCase()} preview not yet supported`} />
                </div>
              ) : (
                <div className="detail-image"><PreviewFallback label="3D preview unavailable" /></div>
              )}
              <div className="preview-action-toolbar" aria-label="Model actions">
                <button
                  type="button"
                  className="model-action-button analysis-action"
                  onClick={() => openPrintAnalysis(false)}
                  disabled={!isStlSelected || (desktopMode && !canAnalyseSelected)}
                  title={printAnalysisActionTitle}
                >
                  <span aria-hidden="true">◫</span>
                  <span>Print Analysis</span>
                </button>
                {canExpandPreview && (
                  <button
                    type="button"
                    className="model-action-button preview-action"
                    onClick={() => openExpandedPreview(false)}
                    aria-label="Expand preview"
                    title="Expand preview"
                  >
                    <span aria-hidden="true">⛶</span>
                    <span>Expand</span>
                  </button>
                )}
              </div>
              {selectedSummaryResult && desktopMode && canAnalyseSelected && (
                <button
                  type="button"
                  className="analysis-summary-pill"
                  onClick={() => openPrintAnalysis(false)}
                  title="Open the latest Print Analysis result"
                >
                  {formatPrintAnalysisSummary(selectedSummaryResult)}
                </button>
              )}
              </div>

              <div className="detail-summary">
              <div><strong>{selected.geometryFiles.length}</strong><span>Geometry</span></div>
              <div><strong>{selected.imageFiles.length}</strong><span>Images</span></div>
              <div><strong>{selected.packageFiles.length}</strong><span>Packages</span></div>
            </div>

              <div className="detail-file-helper">
                <div className="file-section-heading">
                <h3>Associated files</h3>
                <span>
                  {filteredAssociatedFiles.length === selected.files.length
                    ? `${selected.files.length} file${selected.files.length === 1 ? '' : 's'}`
                    : `${filteredAssociatedFiles.length} of ${selected.files.length}`}
                </span>
              </div>

              {selected.files.length > 6 && (
                <div className="associated-file-tools">
                  <label className="associated-file-search">
                    <span aria-hidden="true">⌕</span>
                    <input
                      type="search"
                      value={associatedFileQuery}
                      onChange={(event) => setAssociatedFileQuery(event.currentTarget.value)}
                      placeholder="Search files in this model"
                      aria-label="Search associated files"
                    />
                    {associatedFileQuery && (
                      <button
                        type="button"
                        className="associated-file-search-clear"
                        onClick={() => setAssociatedFileQuery('')}
                        aria-label="Clear associated file search"
                        title="Clear search"
                      >
                        ×
                      </button>
                    )}
                  </label>

                  <div className="associated-file-filters" aria-label="Associated file type filter">
                    {([
                      ['all', 'All', associatedFileCounts.all],
                      ['models', 'Models', associatedFileCounts.models],
                      ['images', 'Images', associatedFileCounts.images],
                      ['packages', 'Packages', associatedFileCounts.packages],
                    ] as Array<[AssociatedFileFilter, string, number]>).map(([value, label, count]) => (
                      <button
                        type="button"
                        key={value}
                        className={associatedFileFilter === value ? 'associated-file-filter active' : 'associated-file-filter'}
                        onClick={() => setAssociatedFileFilter(value)}
                        disabled={value !== 'all' && count === 0}
                      >
                        {label} <span>{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

                {desktopMode && selected.files[0]?.nativePath && (
                  <button
                    type="button"
                    className="detail-source-action detail-helper-source-action"
                    onClick={() => void openCollectionFolder(selected)}
                  >
                    Open source folder
                  </button>
                )}
              </div>
            </div>

            <section className="file-section">
              <div className={selected.files.length > 6 ? 'file-list file-list-scrollable' : 'file-list'}>
                {filteredAssociatedFiles.length > 0 ? (
                  filteredAssociatedFiles.map((file) => (
                    <button
                      type="button"
                      className={[
                        'file-row',
                        selectedPreviewFile?.id === file.id ? 'selected-file' : '',
                        duplicateFileIds.has(file.id) ? 'possible-duplicate-file' : '',
                      ].filter(Boolean).join(' ')}
                      key={file.id}
                      onClick={() => setSelectedFileId(file.id)}
                      title={`Preview ${file.name}`}
                    >
                      <div className="file-thumbnail" aria-hidden="true">
                        <FileThumbnail file={file} />
                      </div>
                      <FileBadge file={file} />
                      <div className="file-name">
                        <strong>{file.name}</strong>
                        <span>{formatBytes(file.size)} · {new Date(file.lastModified).toLocaleDateString()}</span>
                      </div>
                      {duplicateFileIds.has(file.id) && (
                        <span className="duplicate-file-badge">
                          DUP ×{possibleDuplicates.get(duplicateSignature(file))?.length ?? 2}
                        </span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="associated-file-empty">
                    <strong>No matching files</strong>
                    <span>Try a different filename or file-type filter.</span>
                  </div>
                )}
              </div>

              {desktopMode && selectedPreviewFile?.nativePath && (
                <button type="button" className="reveal-selected-file" onClick={() => void revealSelectedFile()}>
                  Reveal selected file in Explorer
                </button>
              )}
            </section>
            {selectedPreviewFile && selectedDuplicateOthers.length > 0 && (
              <section className="duplicate-locations">
                <div className="duplicate-locations-heading">
                  <div>
                    <div className="eyebrow">POSSIBLE DUPLICATE</div>
                    <h3>
                      {selectedDuplicateOthers.length} other matching location
                      {selectedDuplicateOthers.length === 1 ? '' : 's'}
                    </h3>
                  </div>
                  <span>name + exact size</span>
                </div>

                <div className="duplicate-location-list">
                  {selectedDuplicateOthers.map((match) => (
                    <div className="duplicate-location-row" key={match.id}>
                      <strong>{match.name}</strong>
                      <span>{match.folderPath || `${rootName ?? 'Selected folder'} (library root)`}</span>
                      <small>{formatBytes(match.size)}</small>
                    </div>
                  ))}
                </div>

                <p>These are possible duplicates only. Content hashing can be added later for exact verification.</p>
              </section>
            )}

            <div className="read-only-note">
              <strong>Read-only by design</strong>
              <span>No source file has been moved, renamed, overwritten, extracted or uploaded.</span>
            </div>
          </aside>
        )}

        {isAboutOpen && (
          <div
            className="about-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setIsAboutOpen(false)
            }}
          >
            <section className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-modelarium-title">
              <button
                type="button"
                className="about-modal-close"
                onClick={() => setIsAboutOpen(false)}
                aria-label="Close About"
              >
                ×
              </button>

              <div className="eyebrow">MODELARIUM 3D MODEL LIBRARY</div>
              <h2 id="about-modelarium-title">Your 3D models, finally easy to rediscover.</h2>
              <p className="about-lead">
                Modelarium turns an existing collection of STL, 3MF, ZIP and image files into a visual catalogue while
                preserving the folder structure you already use.
              </p>

              <div className="about-grid">
                <section>
                  <h3>Local-first by design</h3>
                  <p>
                    Source files are read only by the catalogue. Modelarium does not rename, move, delete, overwrite,
                    extract or upload your model files.
                  </p>
                </section>

                <section>
                  <h3>Use Modelarium your way</h3>
                  <p>
                    Modelarium is available as an installable Windows Desktop edition, Hosted Web or Local Web.
                    For access, downloads or more information, contact{' '}
                    <a href="mailto:bruce@sutherand.co.za">bruce@sutherand.co.za</a>.
                  </p>
                </section>

                <section className="about-wide">
                  <h3>Print Analysis is here</h3>
                  <p>
                    Windows Desktop Print Analysis uses your local PrusaSlicer installation to calculate real print time,
                    filament use and material cost, then compares Fast, Balanced, Strength Optimised and Quality Optimised
                    strategies. Analysis runs locally on your computer and does not upload your model.
                  </p>
                </section>
              </div>

              <footer className="about-footer">
                <button
                  type="button"
                  className="about-intro-action"
                  onClick={() => {
                    setIsAboutOpen(false)
                    setShowIntro(true)
                  }}
                >
                  Show introduction
                </button>

                <div className="about-footer-meta">
                  <span>v{APP_VERSION} · {runtimeLabel}</span>
                  <a href="https://modelarium.co.za" target="_blank" rel="noreferrer">modelarium.co.za</a>
                </div>
              </footer>
            </section>
          </div>
        )}

        {isDesktopAnalysisNoticeOpen && selectedPreviewFile && (
          <div
            className="about-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setIsDesktopAnalysisNoticeOpen(false)
            }}
          >
            <section
              className="about-modal desktop-analysis-notice"
              role="dialog"
              aria-modal="true"
              aria-labelledby="desktop-analysis-notice-title"
            >
              <button
                type="button"
                className="about-modal-close"
                onClick={() => setIsDesktopAnalysisNoticeOpen(false)}
                aria-label="Close Print Analysis information"
              >
                ×
              </button>

              <div className="eyebrow">PRINT ANALYSIS</div>
              <h2 id="desktop-analysis-notice-title">Available in Modelarium Windows Desktop</h2>
              <p className="about-lead">
                Print Analysis uses a local PrusaSlicer installation to calculate real print time, filament use,
                material cost and the Fast, Balanced, Strength Optimised and Quality Optimised comparisons.
              </p>

              <div className="desktop-analysis-notice-card">
                <strong>Why the installable version?</strong>
                <p>
                  A browser cannot launch the local PrusaSlicer executable. The installable Windows Desktop edition
                  performs the slicing locally on your computer and keeps your model files on your device.
                </p>
              </div>

              <div className="desktop-analysis-notice-privacy">
                <span aria-hidden="true">✓</span>
                <span>No STL is uploaded for Print Analysis.</span>
              </div>

              <footer className="desktop-analysis-notice-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setIsDesktopAnalysisNoticeOpen(false)}
                >
                  Got it
                </button>
              </footer>
            </section>
          </div>
        )}

        {isPrintAnalysisOpen && selected && selectedPreviewFile && (
          <div
            className="print-analysis-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closePrintAnalysis()
            }}
          >
            <section
              className="print-analysis-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Print Analysis for ${selectedPreviewFile.name}`}
            >
              <header className="print-analysis-modal-header">
                <div>
                  <div className="eyebrow">PRINT ANALYSIS</div>
                  <h2>{selected.name}</h2>
                  <p>{selectedPreviewFile.name} · v{APP_VERSION} · {runtimeLabel}</p>
                </div>
                <div className="modal-action-toolbar">
                  <button
                    type="button"
                    className="model-action-button preview-action"
                    onClick={() => openExpandedPreview(true)}
                    disabled={!canExpandPreview}
                    title={canExpandPreview ? 'Open the expanded model preview' : 'Expanded preview is unavailable for this file'}
                  >
                    <span aria-hidden="true">⛶</span>
                    <span>Expand model</span>
                  </button>
                  <button
                    type="button"
                    className="preview-modal-close"
                    onClick={closePrintAnalysis}
                    aria-label="Close Print Analysis"
                  >
                    ×
                  </button>
                </div>
              </header>
              <div className="print-analysis-modal-content">
                <PrintAnalysisPanel
                  file={selectedPreviewFile}
                  result={selectedAnalysisResult}
                  onResultChange={updateSelectedAnalysisResult}
                  comparisonResults={selectedStrategyResults}
                  onComparisonResultsChange={updateSelectedStrategyResults}
                />
              </div>
            </section>
          </div>
        )}
        {isPreviewExpanded && selected && selectedPreviewFile && canExpandPreview && (
          <div
            className="preview-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeExpandedPreview()
            }}
          >
            <section
              className="preview-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Expanded preview of ${selectedPreviewFile.name}`}
            >
              <header className="preview-modal-header">
                <div>
                  <div className="eyebrow">EXPANDED PREVIEW</div>
                  <h2>{selected.name}</h2>
                  <p>{selectedPreviewFile.name} · v{APP_VERSION} · {runtimeLabel}</p>
                </div>

                <div className="modal-action-toolbar">
                  <button
                    type="button"
                    className="model-action-button analysis-action"
                    onClick={() => openPrintAnalysis(true)}
                    disabled={!isStlSelected || (desktopMode && !canAnalyseSelected)}
                    title={printAnalysisActionTitle}
                  >
                    <span aria-hidden="true">◫</span>
                    <span>Print Analysis</span>
                  </button>
                  <button
                    type="button"
                    className="preview-modal-close"
                    onClick={closeExpandedPreview}
                    aria-label="Close expanded preview"
                  >
                    ×
                  </button>
                </div>
              </header>

              <div className="preview-modal-content">
                {selectedPreviewFile.extension === 'stl' ? (
                  <StlViewer file={selectedPreviewFile} showReset />
                ) : selectedPreviewFile.extension === '3mf' ? (
                  <ThreeMfViewer file={selectedPreviewFile} showReset />
                ) : (
                  <div className="expanded-image"><ImagePreview file={selectedPreviewFile} /></div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
