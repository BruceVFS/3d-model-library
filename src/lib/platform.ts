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


export type PrintAnalysisRequest = {
  modelPath: string
  slicerPath: string
  configPath: string
  materialDensityGPerCm3: number
  spoolWeightG: number
  spoolCost: number
  currency: string
}

export type PrintAnalysisResult = {
  slicerName: string
  slicerVersion?: string
  estimatedSeconds: number
  filamentLengthMm?: number
  filamentVolumeCm3?: number
  filamentWeightG?: number
  materialCost?: number
  currency: string
  warnings: string[]
}

export async function detectDesktopPrusaSlicer(): Promise<string | null> {
  return invoke<string | null>('detect_prusaslicer')
}

export async function chooseDesktopPrusaSlicerExecutable(): Promise<string | null> {
  return invoke<string | null>('choose_prusaslicer_executable')
}

export async function chooseDesktopPrusaSlicerConfig(): Promise<string | null> {
  return invoke<string | null>('choose_prusaslicer_config')
}

export async function analyseDesktopPrint(request: PrintAnalysisRequest): Promise<PrintAnalysisResult> {
  return invoke<PrintAnalysisResult>('analyse_print', { request })
}
