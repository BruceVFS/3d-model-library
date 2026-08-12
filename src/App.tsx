import { useMemo, useState } from 'react'
import { ImagePreview, PreviewFallback, StlThumbnail, StlViewer } from './components/Preview'
import {
  formatBytes,
  groupIntoCollections,
  scanDirectory,
  type LibraryFile,
  type ModelCollection,
  type ScanProgress,
  type SupportedExtension,
} from './lib/library'

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
  return <PreviewFallback label={`${cover.extension.toUpperCase()} model`} />
}

function FileBadge({ file }: { file: LibraryFile }) {
  return <span className={`file-badge file-${file.extension}`}>{file.extension.toUpperCase()}</span>
}

function FileThumbnail({ file }: { file: LibraryFile }) {
  if (file.extension === 'stl') {
    return <StlThumbnail file={file} />
  }
  if (['jpg', 'jpeg', 'png', 'webp'].includes(file.extension)) {
    return <ImagePreview file={file} />
  }
  return <PreviewFallback label={file.extension.toUpperCase()} />
}

export default function App() {
  const [rootName, setRootName] = useState<string>()
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [progress, setProgress] = useState<ScanProgress>()
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string>()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | SupportedExtension>('all')
  const [selectedId, setSelectedId] = useState<string>()
  const [selectedFileId, setSelectedFileId] = useState<string>()

  const collections = useMemo(() => groupIntoCollections(files), [files])

  const filteredCollections = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return collections.filter((collection) => {
      if (!collectionMatchesType(collection, typeFilter)) return false
      if (!needle) return true
      return (
        collection.name.toLowerCase().includes(needle) ||
        collection.folderPath.toLowerCase().includes(needle) ||
        collection.files.some((file) => file.name.toLowerCase().includes(needle))
      )
    })
  }, [collections, query, typeFilter])

  const selected = collections.find((collection) => collection.id === selectedId)
  const defaultPreviewFile = selected?.geometryFiles.find((file) => file.extension === 'stl') ?? selected?.cover
  const selectedPreviewFile = selected?.files.find((file) => file.id === selectedFileId) ?? defaultPreviewFile

  const chooseFolder = async () => {
    if (!('showDirectoryPicker' in window)) {
      setScanError('Folder access requires Chrome or Edge with the File System Access API.')
      return
    }

    try {
      setScanError(undefined)
      const root = await window.showDirectoryPicker({ mode: 'read', id: '3d-model-library' })
      setRootName(root.name)
      setFiles([])
      setSelectedId(undefined)
      setSelectedFileId(undefined)
      setIsScanning(true)
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

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">3D</div>
          <div>
            <h1>Model Library</h1>
            <p>Local-first catalogue</p>
          </div>
        </div>
        <button className="primary-button" onClick={chooseFolder} disabled={isScanning}>
          {isScanning ? 'Scanning…' : rootName ? 'Choose another folder' : 'Choose library folder'}
        </button>
      </header>

      <main className="main-layout">
        <section className="catalogue-panel">
          <div className="hero-row">
            <div>
              <div className="eyebrow">SOURCE LIBRARY</div>
              <h2>{rootName ?? 'No folder selected'}</h2>
              <p className="muted">
                {rootName
                  ? 'Your source files remain in place. The catalogue only reads them.'
                  : 'Choose a representative test folder to begin.'}
              </p>
            </div>

            <div className="stat-row">
              <div className="stat-card"><strong>{collections.length}</strong><span>Models</span></div>
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
            </div>
          </div>

          {!rootName && (
            <div className="empty-state">
              <div className="empty-icon">◇</div>
              <h3>Your models, visually organised</h3>
              <p>Select a folder. The app scans it recursively without moving, renaming, extracting or modifying anything.</p>
              <button className="primary-button large" onClick={chooseFolder}>Choose library folder</button>
            </div>
          )}

          {rootName && !isScanning && filteredCollections.length === 0 && (
            <div className="empty-state compact">
              <h3>No matching models</h3>
              <p>Try a different search or file-type filter.</p>
            </div>
          )}

          <div className="gallery">
            {filteredCollections.map((collection) => (
              <button
                key={collection.id}
                className={selectedId === collection.id ? 'model-card selected' : 'model-card'}
                onClick={() => {
                  setSelectedId(collection.id)
                  setSelectedFileId(undefined)
                }}
              >
                <div className="model-cover"><Cover collection={collection} /></div>
                <div className="model-card-body">
                  <div className="model-title-row">
                    <h3>{collection.name}</h3>
                    <span>{collection.files.length}</span>
                  </div>
                  <div className="folder-path">{collection.folderPath || 'Library root'}</div>
                  <div className="badges">
                    {Array.from(new Set(collection.files.map((file) => file.extension))).slice(0, 5).map((ext) => (
                      <span key={ext} className={`file-badge file-${ext}`}>{ext.toUpperCase()}</span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
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
              }}
            >×</button>
            <div className="detail-heading">
              <div className="eyebrow">MODEL COLLECTION</div>
              <h2>{selected.name}</h2>
              <p>{selected.folderPath || 'Library root'}</p>
            </div>

            {selectedPreviewFile?.extension === 'stl' ? (
              <StlViewer file={selectedPreviewFile} />
            ) : selectedPreviewFile && ['jpg', 'jpeg', 'png', 'webp'].includes(selectedPreviewFile.extension) ? (
              <div className="detail-image"><ImagePreview file={selectedPreviewFile} /></div>
            ) : selectedPreviewFile ? (
              <div className="detail-image"><PreviewFallback label={`${selectedPreviewFile.extension.toUpperCase()} preview not yet supported`} /></div>
            ) : (
              <div className="detail-image"><PreviewFallback label="3D preview unavailable" /></div>
            )}

            <div className="detail-summary">
              <div><strong>{selected.geometryFiles.length}</strong><span>Geometry</span></div>
              <div><strong>{selected.imageFiles.length}</strong><span>Images</span></div>
              <div><strong>{selected.packageFiles.length}</strong><span>Packages</span></div>
            </div>

            <section className="file-section">
              <h3>Associated files</h3>
              <div className="file-list">
                {selected.files.map((file) => (
                  <button
                    type="button"
                    className={selectedPreviewFile?.id === file.id ? 'file-row selected-file' : 'file-row'}
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
                  </button>
                ))}
              </div>
            </section>

            <div className="read-only-note">
              <strong>Read-only by design</strong>
              <span>No source file has been moved, renamed, overwritten, extracted or uploaded.</span>
            </div>
          </aside>
        )}
      </main>
    </div>
  )
}
