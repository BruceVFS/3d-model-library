# Print Analysis — v0.2.0 direction

## Decision

Modelarium Print Analysis will use a real local slicer for deterministic print-time and material metrics. The first adapter targets PrusaSlicer CLI in the Windows Desktop edition.

## Proof-of-concept scope

- One selected STL.
- One exported PrusaSlicer .ini baseline configuration.
- Local PrusaSlicer console executable.
- Parse estimated print time, filament length and filament volume from temporary G-code.
- Calculate material weight from volume and configured density.
- Calculate material cost from configured spool weight and price.
- Capture slicer warning text when available.
- Generate G-code only in the operating-system temporary directory and remove it after parsing.
- Never write analysis files into the source model library.

## Next steps after the pipeline is proven

1. Persist named printer and material profiles.
2. Add Fast, Balanced, Strength Optimised and Quality Optimised strategy overlays.
3. Run all four strategies and present a comparison.
4. Add caching keyed to model/profile/settings so unchanged analyses are not repeated.
5. Consider optional AI explanation/recommendation only after deterministic slicer results exist. AI must not invent time, filament or cost figures.

## Distribution direction

Development may rely on an installed PrusaSlicer. A consumer Windows installer should later hide slicer setup complexity, subject to packaging and licence decisions.


## UI workflow

Print Analysis is a first-class model action. It opens in a dedicated modal from the preview toolbar rather than living below long associated-file lists. The normal and expanded previews both expose Print Analysis; the Print Analysis modal exposes Expand model. Moving between the two preserves the selected STL and the latest analysis result for the current session. Web editions show Print Analysis as a visible disabled action so users can discover that the capability is available in Modelarium Windows Desktop.
