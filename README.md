# 3D Model Library — recreated baseline

A local-first visual catalogue for an existing Windows 3D-printing model collection.

This rebuild intentionally keeps the source library read-only. It does not rename, move, overwrite, extract, delete or upload model files.

## Current baseline

- Chrome/Edge folder selection via the File System Access API
- Recursive scanning
- Supported file discovery: STL, 3MF, ZIP, JPG/JPEG, PNG, WEBP
- Folder-based grouping into model collections
- Existing image covers
- Locally generated STL thumbnails
- Interactive STL detail preview (orbit/zoom/pan)
- Search by model, folder and filename
- File-type filtering
- Collection/file totals and scan progress
- Associated-file list with size and modified date
- Read-only source handling

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
