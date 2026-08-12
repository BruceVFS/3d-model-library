import { invoke, isTauri } from '@tauri-apps/api/core'
import type { LibraryFile, SupportedExtension } from './library'

export type NativeScannedFile = {
  name: string
  extension: SupportedExtension
  relativePath: string
  folderPath: string
  size: number
  lastModified: number
  nativePath: string
}

export type NativeLibraryScan = {
  rootName: string
  rootPath: string
  foldersVisited: number
  filesVisited: number
  files: NativeScannedFile[]
  warnings: string[]
}

export function isDesktopApp(): boolean {
  return isTauri()
}

export async function chooseAndScanDesktopLibrary(): Promise<NativeLibraryScan | null> {
  return invoke<NativeLibraryScan | null>('choose_and_scan_library')
}

export async function readDesktopFile(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_library_file', { path })
}

export async function openDesktopContainingFolder(file: LibraryFile): Promise<void> {
  if (!file.nativePath) throw new Error('This file does not have a native desktop path.')
  await invoke('open_containing_folder', { path: file.nativePath })
}

export async function revealDesktopFile(file: LibraryFile): Promise<void> {
  if (!file.nativePath) throw new Error('This file does not have a native desktop path.')
  await invoke('reveal_library_file', { path: file.nativePath })
}
