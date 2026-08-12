# 3D Model Library — recreated baseline

A local-first visual catalogue for an existing Windows 3D-printing model collection.

This rebuild intentionally keeps the source library read-only. It does not rename, move, overwrite, extract, delete or upload model files.

## Current baseline

- Chrome/Edge folder selection via the File System Access API
- Recursive scanning
- Supported file discovery: STL, 3MF, ZIP, JPG/JPEG, PNG, WEBP
- Folder-based grouping into model collections
- Root collection uses the selected folder name rather than a generic label
- Lightweight folder hierarchy browser with breadcrumbs and subtree counts
- Existing image covers
- Locally generated STL thumbnails
- Interactive STL detail preview (orbit/zoom/pan)
- Search by model, folder and filename
- File-type filtering
- Collection/file totals and scan progress
- Associated-file list with size and modified date
- Read-only source handling

## Current grouping rule

- Each folder containing supported files is currently treated as one model collection.
- Files in the selected root folder form a root collection named after that selected folder.
- Nested folder structure is preserved in catalogue paths and can be browsed without changing the source tree.
- This is deliberately simple for now; nested model folders, multiple models in one folder, and manual regrouping remain future work.

## Not yet implemented

- IndexedDB persistence and incremental rescan cache
- 3MF rendering
- ZIP content inspection
- Manual grouping corrections
- User-selected cover images
- Reveal/open source folder
- Thumbnail persistence between browser sessions
- Print Analysis / slicer integration
- Optional AI recommendations

## Requirements

- Windows
- Chrome or Edge
- Node.js 20+ (Node 22 recommended)
- npm

## Run locally

```powershell
npm install
npm run dev
```

Open the URL Vite prints (normally `http://localhost:5173`).

## Production build

```powershell
npm run build
```

## First Git commit

Before committing, verify that no real model-library folders/files have been copied into this project directory.

```powershell
git init
git add .
git commit -m "Recreate working 3D Model Library baseline"
git branch -M main
```

Then create an empty **private** GitHub repository and add it as `origin`.

## Important File System Access note

Chromium's `FileSystemFileHandle.getFile()` must be invoked on the handle object (`handle.getFile()`). Do not detach the method and call it separately; that can cause `Illegal invocation`.

## Roadmap note — Print Analysis

Planned after the core catalogue is stable:

- Fast
- Strength Optimised
- Quality Optimised
- Balanced

These comparisons should use real slicer-derived time/material estimates. Any AI layer should be optional and explain/recommend trade-offs rather than inventing print figures.

## Display names and navigation (Fix 04)

The source folder structure remains authoritative and is never renamed or rewritten. The catalogue now stores a source folder name separately from its display name. Common download suffixes such as `-model_files` / `_model_files` are removed for display only, and slug-like folder names are made more readable.

Folder navigation and model cards have distinct roles:

- a direct child folder that contains deeper model collections is shown as a navigation branch;
- a terminal direct child folder containing supported files is shown as a model card;
- when a search is active, matching descendant collections are shown so search remains useful across the current branch.

These rules are deterministic and are intended to remain visible and manually overridable in a later release.

## Expanded preview (Fix 05)

STL and image previews in the model detail panel can be opened in a large lightbox-style preview. The expanded STL viewer reuses the same local Three.js renderer and supports rotate, zoom and pan. It can be closed with the close button, Escape, or by clicking the backdrop. A Reset view control restores the standard catalogue camera position. No model data is transmitted or modified.
