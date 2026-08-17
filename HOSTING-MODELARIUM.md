# Modelarium hosted test — faceless.co.za/modelarium

This is a static hosted build of the same React/Vite frontend used by the local application. No backend, login, database, uploads or external service is required.

## Build

From the repository root on **main**:

```powershell
npm install
npm run build:hosted-test
```

The hosted-test command builds Vite with `/modelarium/` as its public base path so generated JavaScript, CSS and public assets resolve correctly from the subdirectory.

## Files to upload

Create/clear the server directory that serves:

`https://www.faceless.co.za/modelarium/`

Upload **everything inside the local `dist` folder**, not the `dist` folder itself. Preserve its directory structure. A normal build will look similar to:

```text
/modelarium/
  index.html
  assets/
    index-<hash>.css
    index-<hash>.js
  images/
    model-library-intro.png
```

The hashed asset filenames change from build to build, so treat the entire generated `dist/` contents as the deployable unit. If additional files are later added under `public/`, Vite will copy them into `dist/` and they must be uploaded too.

To list the exact files after building:

```powershell
Get-ChildItem .\dist -Recurse -File | Select-Object FullName
```

## Server requirements

- HTTPS (required for browser folder selection / File System Access API)
- Static file hosting capable of serving `index.html`, JavaScript, CSS and images
- Default document/index handling for the `/modelarium/` directory
- No rewrite rules are currently required because Modelarium does not use client-side URL routing

## Test checklist

Use current Chrome or Edge and open:

`https://www.faceless.co.za/modelarium/`

Firefox does not currently support Modelarium's direct library access because the required directory picker API is unavailable. Use Modelarium Desktop, Chrome or Edge instead.

Verify:

1. Header identifies **Modelarium · 3D Model Library · v0.1.1 · Hosted Web**.
2. System / Light / Dark theme switching works and survives a refresh.
3. About opens as a modal and the email link uses `bruce@sutherand.co.za`.
4. Choose a small representative local test library. The browser should request explicit folder permission.
5. Scanning, folder hierarchy, cards, STL thumbnails, interactive/expanded preview, search, filters and possible-duplicate detection behave as they do locally.
6. Native **Open folder / Reveal in Explorer** controls are absent in Hosted Web; those remain Windows Desktop features.
7. No model/library file is uploaded. Browser mode reads the user-selected folder locally after permission is granted.

## Future production domain

When `modelarium.co.za` is hosted at the domain root, use the ordinary `npm run build` command (base path `/`) unless the production site is intentionally deployed beneath another subdirectory.

## Product direction

Print Analysis remains a planned near-term capability after the catalogue core: Fast, Strength Optimised, Quality Optimised and Balanced comparisons should be based on real slicer-derived time/material estimates. Optional AI can later explain and recommend trade-offs while the underlying numbers stay deterministic.
