import { useEffect, useMemo, useState } from 'react'
import {
  DEMO_FILES,
  DEMO_ROOT_NAME,
  duplicateSignature,
  findPossibleDuplicates,
  formatBytes,
  groupDemoCollections,
  type DemoCollection,
  type DemoExtension,
  type DemoFile,
} from './demoLibrary'
import {
  DemoImagePreview,
  DemoPreviewFallback,
  DemoStlThumbnail,
  DemoStlViewer,
} from './DemoPreview'
import './demo.css'

const FILTERS: Array<{ value: 'all' | DemoExtension; label: string }> = [
  { value: 'all', label: 'All files' },
  { value: 'stl', label: 'STL' },
  { value: '3mf', label: '3MF' },
  { value: 'zip', label: 'ZIP' },
  { value: 'png', label: 'Images' },
]

function collectionMatchesType(collection: DemoCollection, filter: 'all' | DemoExtension) {
  if (filter === 'all') return true
  if (filter === 'png') return collection.imageFiles.length > 0
  return collection.files.some((file) => file.extension === filter)
}

function Cover({ collection }: { collection: DemoCollection }) {
  const cover = collection.cover
  if (!cover) return <DemoPreviewFallback />
  if (['jpg', 'jpeg', 'png', 'webp'].includes(cover.extension)) return <DemoImagePreview file={cover} />
  if (cover.extension === 'stl') return <DemoStlThumbnail file={cover} />
  return <DemoPreviewFallback label={`${cover.extension.toUpperCase()} model`} />
}

function FileBadge({ file }: { file: DemoFile }) {
  return <span className={`file-badge file-${file.extension}`}>{file.extension.toUpperCase()}</span>
}

function FileThumbnail({ file }: { file: DemoFile }) {
  if (file.extension === 'stl') return <DemoStlThumbnail file={file} />
  if (['jpg', 'jpeg', 'png', 'webp'].includes(file.extension)) return <DemoImagePreview file={file} />
  return <DemoPreviewFallback label={file.extension.toUpperCase()} />
}

export default function DemoApp() {
  const files = DEMO_FILES
  const collections = useMemo(() => groupDemoCollections(files), [files])
  const possibleDuplicates = useMemo(() => findPossibleDuplicates(files), [files])
  const duplicateFileIds = useMemo(
    () => new Set(Array.from(possibleDuplicates.values()).flatMap((matches) => matches.map((file) => file.id))),
    [possibleDuplicates],
  )
  const duplicateFileCount = useMemo(
    () => Array.from(possibleDuplicates.values()).reduce((sum, matches) => sum + matches.length, 0),
    [possibleDuplicates],
  )

  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | DemoExtension>('all')
  const [selectedId, setSelectedId] = useState<string>()
  const [selectedFileId, setSelectedFileId] = useState<string>()
  const [activeFolderPath, setActiveFolderPath] = useState('')
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false)
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)
  const [showIntro, setShowIntro] = useState(true)

  const collectionDuplicateCount = (collection: DemoCollection) =>
    collection.files.filter((file) => duplicateFileIds.has(file.id)).length

  const folderPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const collection of collections) {
      const segments = collection.folderPath.split('/')
      for (let index = 1; index <= segments.length; index += 1) paths.add(segments.slice(0, index).join('/'))
    }
    return Array.from(paths).sort((a, b) => a.localeCompare(b))
  }, [collections])

  const childFolders = useMemo(() => {
    const prefix = activeFolderPath ? `${activeFolderPath}/` : ''
    return folderPaths
      .filter((path) => {
        if (path === activeFolderPath || !path.startsWith(prefix)) return false
        const remainder = path.slice(prefix.length)
        if (!remainder || remainder.includes('/')) return false
        return collections.some((collection) => collection.folderPath.startsWith(`${path}/`))
      })
      .map((path) => ({
        path,
        name: path.split('/').at(-1) ?? path,
        count: collections.filter((collection) => collection.folderPath === path || collection.folderPath.startsWith(`${path}/`)).length,
      }))
  }, [activeFolderPath, collections, folderPaths])

  const folderCrumbs = useMemo(() => {
    if (!activeFolderPath) return []
    const segments = activeFolderPath.split('/')
    return segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join('/') }))
  }, [activeFolderPath])

  const scopedCollections = useMemo(() => {
    if (!activeFolderPath) return collections
    return collections.filter((collection) => collection.folderPath === activeFolderPath || collection.folderPath.startsWith(`${activeFolderPath}/`))
  }, [activeFolderPath, collections])

  const directCollections = useMemo(() => {
    const prefix = activeFolderPath ? `${activeFolderPath}/` : ''
    return collections.filter((collection) => {
      if (collection.folderPath === activeFolderPath) return true
      if (!collection.folderPath.startsWith(prefix)) return false
      const remainder = collection.folderPath.slice(prefix.length)
      if (!remainder || remainder.includes('/')) return false
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
      return collection.name.toLowerCase().includes(needle)
        || collection.folderPath.toLowerCase().includes(needle)
        || collection.files.some((file) => file.name.toLowerCase().includes(needle))
    })
  }, [directCollections, duplicateFileIds, duplicatesOnly, query, scopedCollections, typeFilter])

  const matchingScopeCount = useMemo(() => scopedCollections.filter((collection) => {
    if (!collectionMatchesType(collection, typeFilter)) return false
    if (duplicatesOnly && collectionDuplicateCount(collection) === 0) return false
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return collection.name.toLowerCase().includes(needle)
      || collection.folderPath.toLowerCase().includes(needle)
      || collection.files.some((file) => file.name.toLowerCase().includes(needle))
  }).length, [duplicateFileIds, duplicatesOnly, query, scopedCollections, typeFilter])

  const selected = collections.find((collection) => collection.id === selectedId)
  const defaultPreviewFile = selected?.geometryFiles.find((file) => file.extension === 'stl') ?? selected?.cover
  const selectedPreviewFile = selected?.files.find((file) => file.id === selectedFileId) ?? defaultPreviewFile
  const selectedDuplicateMatches = selectedPreviewFile ? possibleDuplicates.get(duplicateSignature(selectedPreviewFile)) : undefined
  const selectedDuplicateOthers = selectedDuplicateMatches?.filter((file) => file.id !== selectedPreviewFile?.id) ?? []
  const canExpandPreview = Boolean(selectedPreviewFile && (selectedPreviewFile.extension === 'stl' || ['jpg', 'jpeg', 'png', 'webp'].includes(selectedPreviewFile.extension)))
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)

  useEffect(() => {
    if (!isPreviewExpanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsPreviewExpanded(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [isPreviewExpanded])

  const navigateFolder = (path: string) => {
    setActiveFolderPath(path)
    setSelectedId(undefined)
    setSelectedFileId(undefined)
    setIsPreviewExpanded(false)
  }

  const resetDemo = () => {
    setQuery('')
    setTypeFilter('all')
    setSelectedId(undefined)
    setSelectedFileId(undefined)
    setActiveFolderPath('')
    setDuplicatesOnly(false)
    setIsPreviewExpanded(false)
    setShowIntro(true)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">3D</div>
          <div><h1>Model Library</h1><p>Hosted demo · synthetic models</p></div>
        </div>
        <button className="primary-button" onClick={resetDemo}>Reset demo</button>
      </header>

      <main className="main-layout">
        <section className="catalogue-panel">
          <div className="hero-row">
            <div>
              <div className="eyebrow">HOSTED DEMO</div>
              <h2>{DEMO_ROOT_NAME}</h2>
              <p className="muted">A representative synthetic collection. No personal model files are included.</p>
            </div>
            <div className="stat-row">
              <div className="stat-card"><strong>{collections.length}</strong><span>Models</span></div>
              <div className="stat-card"><strong>{files.length}</strong><span>Files</span></div>
              <div className="stat-card"><strong>{formatBytes(totalBytes)}</strong><span>Size</span></div>
            </div>
          </div>

          {showIntro && (
            <section className="demo-intro">
              <div className="demo-intro-copy">
                <div className="eyebrow">WHY THIS EXISTS</div>
                <h3>Your 3D models, finally easy to rediscover.</h3>
                <p>The local app turns an existing folder collection of STL, 3MF, ZIP and image files into a visual catalogue without reorganising the source files.</p>
                <div className="demo-value-strip"><span>Browse visually</span><span>Keep your folders</span><span>Preview in 3D</span><span>Spot possible duplicates</span></div>
                <button className="primary-button large" onClick={() => setShowIntro(false)}>Explore demo library</button>
              </div>
              <img src={`${import.meta.env.BASE_URL}demo/images/demo_banner.png`} alt="Synthetic model library preview" />
            </section>
          )}

          <div className="toolbar">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models, folders and filenames" />
            </label>
            <div className="filter-strip" aria-label="File type filter">
              {FILTERS.map((filter) => (
                <button key={filter.value} className={typeFilter === filter.value ? 'filter-button active' : 'filter-button'} onClick={() => setTypeFilter(filter.value)}>{filter.label}</button>
              ))}
              <button
                type="button"
                className={duplicatesOnly ? 'filter-button duplicate-filter active' : 'filter-button duplicate-filter'}
                onClick={() => setDuplicatesOnly((value) => !value)}
                title="Files with the same normalised name and exact byte size"
              >Possible duplicates ({possibleDuplicates.size})</button>
            </div>
          </div>

          {possibleDuplicates.size > 0 && (
            <div className="duplicate-summary" role="status">
              <strong>{possibleDuplicates.size} possible duplicate groups</strong>
              <span>{duplicateFileCount} files share the same normalised filename and exact byte size.</span>
            </div>
          )}

          <section className="folder-browser" aria-label="Folder hierarchy">
            <div className="folder-browser-heading">
              <div>
                <div className="eyebrow">FOLDER HIERARCHY</div>
                <div className="folder-breadcrumbs">
                  <button type="button" className={!activeFolderPath ? 'breadcrumb-button current' : 'breadcrumb-button'} onClick={() => navigateFolder('')}>{DEMO_ROOT_NAME}</button>
                  {folderCrumbs.map((crumb, index) => (
                    <span className="breadcrumb-part" key={crumb.path}>
                      <span className="breadcrumb-separator">/</span>
                      <button type="button" className={index === folderCrumbs.length - 1 ? 'breadcrumb-button current' : 'breadcrumb-button'} onClick={() => navigateFolder(crumb.path)}>{crumb.name}</button>
                    </span>
                  ))}
                </div>
              </div>
              <span className="folder-scope-count">{matchingScopeCount} models in scope</span>
            </div>
            {childFolders.length > 0 && (
              <div className="folder-children">
                {childFolders.map((folder) => (
                  <button type="button" className="folder-chip" key={folder.path} onClick={() => navigateFolder(folder.path)}>
                    <span className="folder-chip-icon" aria-hidden="true">▱</span><span>{folder.name}</span><strong>{folder.count}</strong>
                  </button>
                ))}
              </div>
            )}
          </section>

          {matchingScopeCount === 0 && <div className="empty-state compact"><h3>No matching models</h3><p>Try a different search or filter.</p></div>}

          <div className="gallery">
            {filteredCollections.map((collection) => {
              const duplicateCount = collectionDuplicateCount(collection)
              return (
                <article
                  key={collection.id}
                  className={['model-card', selectedId === collection.id ? 'selected' : ''].filter(Boolean).join(' ')}
                  role="button"
                  tabIndex={0}
                  onClick={() => { setSelectedId(collection.id); setSelectedFileId(undefined); setIsPreviewExpanded(false) }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(collection.id); setSelectedFileId(undefined) }
                  }}
                >
                  <div className="model-cover">
                    <Cover collection={collection} />
                    {duplicateCount > 0 && <span className="duplicate-card-badge">POSSIBLE DUP{duplicateCount === 1 ? '' : ` · ${duplicateCount} FILES`}</span>}
                  </div>
                  <div className="model-card-body">
                    <div className="model-title-row"><h3>{collection.name}</h3><span>{collection.files.length}</span></div>
                    <div className="folder-path" title={collection.folderPath}>{collection.folderPath}</div>
                    <div className="badges">{Array.from(new Set(collection.files.map((file) => file.extension))).slice(0, 5).map((ext) => <span key={ext} className={`file-badge file-${ext}`}>{ext.toUpperCase()}</span>)}</div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        {selected && (
          <aside className="detail-panel">
            <button className="close-button" aria-label="Close details" onClick={() => { setSelectedId(undefined); setSelectedFileId(undefined); setIsPreviewExpanded(false) }}>×</button>
            <div className="detail-heading">
              <div className="eyebrow">MODEL COLLECTION</div>
              <h2>{selected.name}</h2>
              <p><span className="detail-source-label">Demo path:</span> {selected.folderPath}</p>
            </div>
            <div className="detail-preview-stage">
              {selectedPreviewFile?.extension === 'stl' ? <DemoStlViewer file={selectedPreviewFile} />
                : selectedPreviewFile && ['jpg', 'jpeg', 'png', 'webp'].includes(selectedPreviewFile.extension) ? <div className="detail-image"><DemoImagePreview file={selectedPreviewFile} /></div>
                  : selectedPreviewFile ? <div className="detail-image"><DemoPreviewFallback label={`${selectedPreviewFile.extension.toUpperCase()} preview not yet supported`} /></div>
                    : <div className="detail-image"><DemoPreviewFallback label="3D preview unavailable" /></div>}
              {canExpandPreview && <button type="button" className="preview-expand-button" onClick={() => setIsPreviewExpanded(true)}><span aria-hidden="true">⛶</span><span>Expand</span></button>}
            </div>
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
                    className={['file-row', selectedPreviewFile?.id === file.id ? 'selected-file' : '', duplicateFileIds.has(file.id) ? 'possible-duplicate-file' : ''].filter(Boolean).join(' ')}
                    key={file.id}
                    onClick={() => setSelectedFileId(file.id)}
                    title={`Preview ${file.name}`}
                  >
                    <div className="file-thumbnail" aria-hidden="true"><FileThumbnail file={file} /></div>
                    <FileBadge file={file} />
                    <div className="file-name"><strong>{file.name}</strong><span>{formatBytes(file.size)} · synthetic demo file</span></div>
                    {duplicateFileIds.has(file.id) && <span className="duplicate-file-badge">DUP ×{possibleDuplicates.get(duplicateSignature(file))?.length ?? 2}</span>}
                  </button>
                ))}
              </div>
            </section>
            {selectedPreviewFile && selectedDuplicateOthers.length > 0 && (
              <section className="duplicate-locations">
                <div className="duplicate-locations-heading"><div><div className="eyebrow">POSSIBLE DUPLICATE</div><h3>{selectedDuplicateOthers.length} other matching location{selectedDuplicateOthers.length === 1 ? '' : 's'}</h3></div><span>name + exact size</span></div>
                <div className="duplicate-location-list">{selectedDuplicateOthers.map((match) => <div className="duplicate-location-row" key={match.id}><strong>{match.name}</strong><span>{match.folderPath}</span><small>{formatBytes(match.size)}</small></div>)}</div>
                <p>Possible duplicates only. The local edition can later verify candidates with content hashing.</p>
              </section>
            )}
            <div className="read-only-note"><strong>Demo-safe by design</strong><span>This hosted edition contains only synthetic bundled models. The local product keeps user libraries on the device.</span></div>
          </aside>
        )}

        {isPreviewExpanded && selected && selectedPreviewFile && canExpandPreview && (
          <div className="preview-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsPreviewExpanded(false) }}>
            <section className="preview-modal" role="dialog" aria-modal="true" aria-label={`Expanded preview of ${selected.name}`}>
              <header className="preview-modal-header"><div><div className="eyebrow">EXPANDED PREVIEW</div><h2>{selected.name}</h2><p>{selectedPreviewFile.name}</p></div><button type="button" className="preview-modal-close" onClick={() => setIsPreviewExpanded(false)} aria-label="Close expanded preview">×</button></header>
              <div className="preview-modal-content">
                {selectedPreviewFile.extension === 'stl' ? <DemoStlViewer file={selectedPreviewFile} showReset /> : <DemoImagePreview file={selectedPreviewFile} />}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
