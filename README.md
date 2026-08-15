# Modelarium 3D Model Library

Modelarium is a local-first visual catalogue for an existing 3D-printing model collection. **Your 3D models, finally easy to rediscover.**

The source library is read-only by design. The app does not rename, move, overwrite, extract, delete or upload model files. The Windows desktop build can open the containing folder or reveal a selected file in Explorer so deliberate file management happens outside the catalogue.

## Current baseline

- React + TypeScript + Vite frontend
- Browser mode in Chrome/Edge using the File System Access API
- Windows desktop mode using Tauri v2
- Native Windows folder picker in desktop mode
- Recursive read-only scanning
- Supported file discovery: STL, 3MF, ZIP, JPG/JPEG, PNG, WEBP
- Folder-based grouping into model collections
- Selected library root treated as a container; direct supported files remain accessible as **Loose files** when nested model folders exist
- Lightweight folder hierarchy browser with breadcrumbs and subtree counts
- Human-friendly display names without renaming source folders
- Existing image covers
- Locally generated STL thumbnails
- Interactive STL detail preview and expanded lightbox preview
- Search by model, folder and filename
- File-type filtering
- Possible duplicate detection using normalised filename + exact byte size
- Collection/file totals and scan status
- Associated-file list with size and modified date
- **Open source folder** on every model card/detail view in the desktop build
- **Reveal selected file in Explorer** from the detail view in the desktop build

## Source-file safety

The desktop Rust layer keeps the selected root folder in application state and validates every preview/reveal request against that root. It scans directories and reads file bytes only for catalogue metadata and local previews. It contains no command for rename, move, delete, overwrite or extraction.

Explorer actions are intentionally external: the catalogue can open a containing folder or reveal a file, after which the user decides whether to perform any file-management action in Windows Explorer.

## Current grouping rule

- Each folder containing supported files is currently treated as one model collection.
- If the selected root contains only supported files, it can still act as a single model collection.
- If the selected root also contains nested model folders, its direct supported files are exposed separately as **Loose files** and are not counted as a model.
- Nested folder structure is preserved in catalogue paths and can be browsed without changing the source tree.
- Nested model folders, multiple models in one folder and manual regrouping remain future work.

## Display names and navigation

The physical folder structure remains authoritative. Catalogue display names are separate from source names. Common download suffixes such as `-model_files` and `_model_files` are removed for display only, while source names and relative paths remain available.

A direct child folder that contains deeper model collections is shown as a navigation branch. A terminal direct child containing supported files is shown as a model card. Search can still surface matching descendants in the current branch.

## Expanded preview

STL and image previews can be opened in a large lightbox-style view. The expanded STL viewer reuses the local Three.js renderer and supports rotate, zoom, pan and Reset view. It closes via the close button, Escape or the backdrop.

## Possible duplicate detection

Supported files are grouped by a conservative first-pass signature: normalised filename plus exact byte size. Matches are labelled **possible duplicates**, not proven duplicates. No extra file reads are required just to identify candidates. A later increment can optionally verify candidates using local content hashes such as SHA-256.

## Browser mode

Requirements:

- Windows
- Chrome or Edge
- Node.js 20+ (Node 22 recommended)
- npm

Run:

```powershell
npm install
npm run dev
```

Open the URL Vite prints, normally `http://localhost:5173`.

Browser mode retains the local catalogue and preview features, but cannot reliably launch Windows Explorer for arbitrary folders selected through the browser File System Access API.

## Windows desktop mode (Tauri)

Tauri development on Windows requires Rust and the Microsoft C++ build tools; it renders through Microsoft Edge WebView2.

After installing the prerequisites, run:

```powershell
npm install
npm run tauri dev
```

The Tauri app uses the same React/Vite frontend, but folder selection and source-location actions use the local Rust desktop layer.

To build an installable/release desktop application later:

```powershell
npm run tauri build
```

A `Cargo.lock` file will be generated during the first Rust build. Commit it so desktop dependency versions remain reproducible.

## Production web build

For a root-domain/local build:

```powershell
npm run build
```

For the temporary hosted test at `https://www.faceless.co.za/modelarium/`, build with the required subdirectory base path:

```powershell
npm run build:hosted-test
```

Upload the **contents** of `dist/` into the web server's `/modelarium/` directory, preserving the generated `assets/` and `images/` subdirectories. See `HOSTING-MODELARIUM.md`.

## Important File System Access note

In browser mode, Chromium's `FileSystemFileHandle.getFile()` must be invoked on the handle object (`handle.getFile()`). Do not detach the method and call it separately; that can cause `Illegal invocation`.

## Not yet implemented

- IndexedDB persistence and incremental rescan cache
- Native scan progress events during a Tauri scan (the desktop UI currently shows a scanning state and final totals)
- 3MF rendering
- ZIP content inspection
- Manual grouping corrections
- User-selected cover images
- Thumbnail persistence between sessions
- Exact duplicate verification via local hashing
- Print Analysis / slicer integration
- Optional AI recommendations

## Roadmap note — Print Analysis

Planned after the core catalogue is stable:

- Fast
- Strength Optimised
- Quality Optimised
- Balanced

These comparisons should use real slicer-derived time/material estimates. Any AI layer should be optional and explain/recommend trade-offs rather than inventing print figures.


## Versioning and runtime identity

Model Library uses semantic versioning (`MAJOR.MINOR.PATCH`) while it evolves toward a first production release. `package.json` is the source of truth for the application version, and the UI reads that value at build time so the displayed version stays aligned with the codebase. Git release tags should mirror released application versions (for example `v0.1.0`, `v0.2.0`).

The sticky application header always identifies the runtime:

* **Local Web** — React/Vite running locally in Chrome or Edge.
* **Windows Desktop** — the React/Vite frontend running inside Tauri with native Windows capabilities.
* **Hosted Web** — the same frontend served from a non-local web host.

The introductory product panel explains the catalogue purpose and disappears after a library is chosen. **About** opens product/privacy/contact information and the planned Print Analysis direction. Theme preference supports **System**, **Light** and **Dark** and is stored locally when browser storage is available.
