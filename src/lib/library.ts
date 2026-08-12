export const SUPPORTED_EXTENSIONS = ['stl', '3mf', 'zip', 'jpg', 'jpeg', 'png', 'webp'] as const
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

export type LibraryFile = {
  id: string
  name: string
  extension: SupportedExtension
  relativePath: string
  folderPath: string
  size: number
  lastModified: number
  handle: FileSystemFileHandle
}

export type CollectionKind = 'model' | 'loose-root'

export type ModelCollection = {
  id: string
  kind: CollectionKind
  name: string
  sourceName: string
  folderPath: string
  files: LibraryFile[]
  imageFiles: LibraryFile[]
  geometryFiles: LibraryFile[]
  packageFiles: LibraryFile[]
  cover?: LibraryFile
}

export type ScanProgress = {
  folders: number
  filesVisited: number
  supportedFiles: number
  currentPath: string
}

const imageExtensions = new Set<SupportedExtension>(['jpg', 'jpeg', 'png', 'webp'])
const geometryExtensions = new Set<SupportedExtension>(['stl', '3mf'])

function isDirectoryHandle(handle: FileSystemHandle): handle is FileSystemDirectoryHandle {
  return handle.kind === 'directory'
}

function isFileHandle(handle: FileSystemHandle): handle is FileSystemFileHandle {
  return handle.kind === 'file'
}

export function getExtension(name: string): SupportedExtension | undefined {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  const value = name.slice(dot + 1).toLowerCase()
  return SUPPORTED_EXTENSIONS.includes(value as SupportedExtension)
    ? (value as SupportedExtension)
    : undefined
}

export async function scanDirectory(
  root: FileSystemDirectoryHandle,
  onProgress?: (progress: ScanProgress) => void,
): Promise<LibraryFile[]> {
  const discovered: LibraryFile[] = []
  const progress: ScanProgress = {
    folders: 0,
    filesVisited: 0,
    supportedFiles: 0,
    currentPath: root.name,
  }

  const walk = async (directory: FileSystemDirectoryHandle, relativeFolder: string) => {
    progress.folders += 1
    progress.currentPath = relativeFolder || root.name
    onProgress?.({ ...progress })

    try {
      for await (const [, handle] of directory.entries()) {
        if (isDirectoryHandle(handle)) {
          const childPath = relativeFolder ? `${relativeFolder}/${handle.name}` : handle.name
          await walk(handle, childPath)
          continue
        }

        if (!isFileHandle(handle)) continue

        progress.filesVisited += 1
        const extension = getExtension(handle.name)
        if (!extension) {
          if (progress.filesVisited % 25 === 0) onProgress?.({ ...progress })
          continue
        }

        // Keep getFile bound to the handle object. Calling a detached getFile function
        // causes Chromium's "Illegal invocation" error.
        const file = await handle.getFile()
        const relativePath = relativeFolder ? `${relativeFolder}/${handle.name}` : handle.name

        discovered.push({
          id: relativePath.toLowerCase(),
          name: handle.name,
          extension,
          relativePath,
          folderPath: relativeFolder,
          size: file.size,
          lastModified: file.lastModified,
          handle,
        })

        progress.supportedFiles += 1
        if (progress.filesVisited % 10 === 0) onProgress?.({ ...progress })
      }
    } catch (error) {
      console.warn(`Unable to scan ${relativeFolder || root.name}`, error)
    }
  }

  await walk(root, '')
  onProgress?.({ ...progress, currentPath: 'Complete' })
  return discovered
}

function titleCaseWords(value: string) {
  return value
    .split(' ')
    .map((word) => {
      if (!word) return word
      if (/^[A-Z0-9+]{2,}$/.test(word)) return word
      if (/^\d/.test(word)) return word
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`
    })
    .join(' ')
}

/**
 * Produce a catalogue-friendly label without changing the source folder name.
 * Deliberately conservative: already-readable names are preserved, while common
 * downloaded-model slug/suffix patterns are cleaned up for display only.
 */
export function toDisplayName(sourceName: string): string {
  const withoutKnownSuffix = sourceName
    .replace(/(?:[-_ ]model[-_ ]files)$/i, '')
    .trim()

  const hadWhitespace = /\s/.test(withoutKnownSuffix)
  let display = withoutKnownSuffix.replace(/_+/g, ' ')

  // A name with no whitespace is usually a web-download slug. Convert its
  // hyphens to spaces. Names that already contain spaces (for example
  // "Underware - Channels-L") retain their intentional punctuation.
  if (!hadWhitespace) display = display.replace(/-+/g, ' ')

  display = display.replace(/\s+/g, ' ').trim()
  if (!display) return sourceName

  return hadWhitespace ? display : titleCaseWords(display)
}

function collectionIdentity(
  folderPath: string,
  files: LibraryFile[],
  rootName: string | undefined,
  kind: CollectionKind,
) {
  if (kind === 'loose-root') {
    return {
      sourceName: rootName || 'Selected folder',
      displayName: 'Loose files',
    }
  }

  const sourceName = folderPath
    ? folderPath.split('/').at(-1) || folderPath
    : rootName || (files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : 'Selected folder')

  return {
    sourceName,
    displayName: folderPath ? toDisplayName(sourceName) : sourceName,
  }
}

export function groupIntoCollections(files: LibraryFile[], rootName?: string): ModelCollection[] {
  const groups = new Map<string, LibraryFile[]>()

  for (const file of files) {
    const key = file.folderPath || '__root__'
    const current = groups.get(key) ?? []
    current.push(file)
    groups.set(key, current)
  }

  // A selected library root is a container first. If it has supported files of
  // its own as well as nested model folders, keep those files accessible as a
  // separate catalogue item rather than pretending the entire library is a model.
  const hasNestedCollections = Array.from(groups.keys()).some((key) => key !== '__root__')

  return Array.from(groups.entries())
    .map(([key, groupFiles]) => {
      const folderPath = key === '__root__' ? '' : key
      const kind: CollectionKind = key === '__root__' && hasNestedCollections ? 'loose-root' : 'model'
      const sortedFiles = [...groupFiles].sort((a, b) => a.name.localeCompare(b.name))
      const imageFiles = sortedFiles.filter((file) => imageExtensions.has(file.extension))
      const geometryFiles = sortedFiles.filter((file) => geometryExtensions.has(file.extension))
      const packageFiles = sortedFiles.filter((file) => file.extension === 'zip')
      const { sourceName, displayName } = collectionIdentity(folderPath, sortedFiles, rootName, kind)

      const cover = imageFiles[0] ?? geometryFiles.find((file) => file.extension === 'stl') ?? geometryFiles[0]

      return {
        id: folderPath || '__root__',
        kind,
        name: displayName,
        sourceName,
        folderPath,
        files: sortedFiles,
        imageFiles,
        geometryFiles,
        packageFiles,
        cover,
      }
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'loose-root' ? 1 : -1
      return a.name.localeCompare(b.name)
    })
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}
