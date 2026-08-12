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

export type ModelCollection = {
  id: string
  name: string
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

function displayName(folderPath: string, files: LibraryFile[]) {
  if (folderPath) return folderPath.split('/').at(-1) || folderPath
  if (files.length === 1) return files[0].name.replace(/\.[^.]+$/, '')
  return 'Library root'
}

export function groupIntoCollections(files: LibraryFile[]): ModelCollection[] {
  const groups = new Map<string, LibraryFile[]>()

  for (const file of files) {
    const key = file.folderPath || '__root__'
    const current = groups.get(key) ?? []
    current.push(file)
    groups.set(key, current)
  }

  return Array.from(groups.entries())
    .map(([key, groupFiles]) => {
      const folderPath = key === '__root__' ? '' : key
      const sortedFiles = [...groupFiles].sort((a, b) => a.name.localeCompare(b.name))
      const imageFiles = sortedFiles.filter((file) => imageExtensions.has(file.extension))
      const geometryFiles = sortedFiles.filter((file) => geometryExtensions.has(file.extension))
      const packageFiles = sortedFiles.filter((file) => file.extension === 'zip')

      const cover = imageFiles[0] ?? geometryFiles.find((file) => file.extension === 'stl') ?? geometryFiles[0]

      return {
        id: folderPath || '__root__',
        name: displayName(folderPath, sortedFiles),
        folderPath,
        files: sortedFiles,
        imageFiles,
        geometryFiles,
        packageFiles,
        cover,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}
