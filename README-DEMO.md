# 3D Model Library — hosted demo branch

This overlay creates a self-contained hosted demonstration edition of the 3D Model Library.

## Purpose

The `demo-sites` branch is for public product validation. It does **not** scan a visitor's filesystem and it contains no files from a personal 3D-printing collection.

The demo uses synthetic bundled STL, 3MF, ZIP and PNG assets to demonstrate:

- visual model cards;
- folder hierarchy navigation;
- search and file-type filters;
- local Three.js STL thumbnails and interactive previews;
- expanded preview lightbox;
- multipart / multi-file collections;
- existing-image cover behaviour;
- possible-duplicate detection using filename + exact byte size.

The production `main` branch remains the local-first application with browser folder access and the Windows/Tauri shell.

## Create the branch

From a clean, up-to-date `main` branch:

```powershell
git switch main
git pull --ff-only origin main
git switch -c demo-sites
```

Extract this overlay into the repository root, replacing `index.html` and adding the new `src/demo*` and `public/demo` files.

Then run:

```powershell
npm install
npm run build
npm run dev
```

## Commit

After testing:

```powershell
git add index.html README-DEMO.md src/demo-main.tsx src/demo public/demo
git commit -m "Add hosted synthetic demo edition"
git push -u origin demo-sites
```

## Safety and licensing

All model and image assets in `public/demo` were generated specifically for the demonstration. They do not come from the user's personal collection or a third-party model download.

## Deployment intent

The first deployment target is ChatGPT Sites. If reception is positive, this same branch can later be adapted for a conventional static host without changing the architecture of the local Windows product.
