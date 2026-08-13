export const DEMO_ROOT_NAME = 'Demo Library'
export const DEMO_ASSET_BASE = `${import.meta.env.BASE_URL}demo/`

export type DemoExtension = 'stl' | '3mf' | 'zip' | 'jpg' | 'jpeg' | 'png' | 'webp'
export type DemoFile = { id: string; name: string; extension: DemoExtension; relativePath: string; folderPath: string; size: number; lastModified: number; assetUrl: string }
export type DemoCollection = { id: string; name: string; folderPath: string; files: DemoFile[]; imageFiles: DemoFile[]; geometryFiles: DemoFile[]; packageFiles: DemoFile[]; cover?: DemoFile }

const file = (folderPath: string, name: string, extension: DemoExtension, asset: string, size: number, lastModified: number): DemoFile => ({
  id: `${folderPath}/${name}`.toLowerCase(), name, extension, relativePath: `${folderPath}/${name}`, folderPath, size, lastModified, assetUrl: `${DEMO_ASSET_BASE}${asset}`,
})

export const DEMO_FILES: DemoFile[] = [
  file("Workshop/Cable Management Clips", "cable_clip.stl", "stl" as DemoExtension, "models/cable_clip.stl", 3084, 1786500000000),
  file("Workshop/Cable Management Clips", "cable_clip_short.stl", "stl" as DemoExtension, "models/cable_clip_short.stl", 1884, 1786500001000),
  file("Workshop/Cable Management Clips", "cable_clip_double.stl", "stl" as DemoExtension, "models/cable_clip_double.stl", 2484, 1786500002000),
  file("Workshop/Cable Management Clips", "m3_knob.stl", "stl" as DemoExtension, "models/m3_knob.stl", 19284, 1786500003000),
  file("Workshop/Cable Management Clips", "cable_management_bundle.zip", "zip" as DemoExtension, "packages/cable_management_bundle.zip", 1111, 1786500004000),
  file("Workshop/Drill Battery Holder", "battery_holder.stl", "stl" as DemoExtension, "models/battery_holder.stl", 2484, 1786500000000),
  file("Workshop/Drill Battery Holder", "battery_holder_compact.stl", "stl" as DemoExtension, "models/battery_holder_compact.stl", 2484, 1786500001000),
  file("Workshop/Drill Battery Holder", "mounting_spacer.stl", "stl" as DemoExtension, "models/mounting_spacer.stl", 19284, 1786500002000),
  file("Workshop/Digital Caliper Case", "caliper_case_cover.png", "png" as DemoExtension, "images/caliper_case_cover.png", 7735, 1786500000000),
  file("Workshop/Digital Caliper Case", "caliper_case_base.stl", "stl" as DemoExtension, "models/caliper_case_base.stl", 3084, 1786500001000),
  file("Workshop/Digital Caliper Case", "caliper_case_lid.stl", "stl" as DemoExtension, "models/caliper_case_lid.stl", 1884, 1786500002000),
  file("Home/Toothbrush Travel Case", "toothbrush_case_cover.png", "png" as DemoExtension, "images/toothbrush_case_cover.png", 7581, 1786500000000),
  file("Home/Toothbrush Travel Case", "toothbrush_case_body.stl", "stl" as DemoExtension, "models/toothbrush_case_body.stl", 10284, 1786500001000),
  file("Home/Toothbrush Travel Case", "toothbrush_case_cap.stl", "stl" as DemoExtension, "models/toothbrush_case_cap.stl", 19284, 1786500002000),
  file("Home/Phone Stand", "phone_stand.stl", "stl" as DemoExtension, "models/phone_stand.stl", 1884, 1786500000000),
  file("Home/Phone Stand", "phone_stand_demo.3mf", "3mf" as DemoExtension, "packages/phone_stand_demo.3mf", 857, 1786500001000),
  file("Home/Phone Stand", "m3_knob.stl", "stl" as DemoExtension, "models/m3_knob.stl", 19284, 1786500002000),
  file("Automotive/Dashboard Switch Mount", "switch_mount_plate.stl", "stl" as DemoExtension, "models/switch_mount_plate.stl", 19884, 1786500000000),
  file("Automotive/Dashboard Switch Mount", "switch_mount_dual.stl", "stl" as DemoExtension, "models/switch_mount_dual.stl", 29484, 1786500001000),
  file("Automotive/Dashboard Switch Mount", "mounting_spacer.stl", "stl" as DemoExtension, "models/mounting_spacer.stl", 19284, 1786500002000),
  file("Automotive/Cable Grommet", "cable_grommet.stl", "stl" as DemoExtension, "models/cable_grommet.stl", 25684, 1786500000000),
  file("Hobby/Chess Set", "chess_pawn.stl", "stl" as DemoExtension, "models/chess_pawn.stl", 40084, 1786500000000),
  file("Hobby/Chess Set", "chess_bishop.stl", "stl" as DemoExtension, "models/chess_bishop.stl", 40084, 1786500001000),
  file("Hobby/Chess Set", "chess_rook.stl", "stl" as DemoExtension, "models/chess_rook.stl", 24684, 1786500002000),
  file("Hobby/Chess Set", "chess_king.stl", "stl" as DemoExtension, "models/chess_king.stl", 25284, 1786500003000),
  file("Hobby/Miniature Display Stand", "display_stand.stl", "stl" as DemoExtension, "models/display_stand.stl", 1884, 1786500000000),
  file("Hobby/Miniature Display Stand", "display_stand_small.stl", "stl" as DemoExtension, "models/display_stand_small.stl", 1884, 1786500001000),
  file("Hobby/Headphone Hanger", "headphone_hanger.stl", "stl" as DemoExtension, "models/headphone_hanger.stl", 1884, 1786500000000),
]

const imageExtensions = new Set<DemoExtension>(['jpg', 'jpeg', 'png', 'webp'])
const geometryExtensions = new Set<DemoExtension>(['stl', '3mf'])

export function groupDemoCollections(files: DemoFile[]): DemoCollection[] {
  const groups = new Map<string, DemoFile[]>()
  for (const item of files) groups.set(item.folderPath, [...(groups.get(item.folderPath) ?? []), item])
  return Array.from(groups.entries()).map(([folderPath, groupFiles]) => {
    const sorted = [...groupFiles].sort((a, b) => a.name.localeCompare(b.name))
    const imageFiles = sorted.filter((item) => imageExtensions.has(item.extension))
    const geometryFiles = sorted.filter((item) => geometryExtensions.has(item.extension))
    const packageFiles = sorted.filter((item) => item.extension === 'zip')
    return { id: folderPath.toLowerCase(), name: folderPath.split('/').at(-1) ?? folderPath, folderPath, files: sorted, imageFiles, geometryFiles, packageFiles, cover: imageFiles[0] ?? geometryFiles.find((item) => item.extension === 'stl') ?? geometryFiles[0] }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export function duplicateSignature(file: DemoFile): string { return `${file.name.trim().toLowerCase()}::${file.size}` }
export function findPossibleDuplicates(files: DemoFile[]): Map<string, DemoFile[]> {
  const grouped = new Map<string, DemoFile[]>()
  for (const item of files) grouped.set(duplicateSignature(item), [...(grouped.get(duplicateSignature(item)) ?? []), item])
  return new Map(Array.from(grouped.entries()).filter(([, matches]) => matches.length > 1))
}
export function formatBytes(bytes: number): string { if (bytes === 0) return '0 B'; const units = ['B','KB','MB','GB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); const value = bytes / 1024 ** index; return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}` }