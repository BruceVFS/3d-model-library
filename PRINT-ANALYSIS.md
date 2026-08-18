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

## Four-strategy comparison

Modelarium can run four sequential PrusaSlicer analyses derived from the selected known-good baseline `.ini`.

| Strategy | Layer height | Perimeters | Infill |
|---|---:|---:|---:|
| Fast | 0.28 mm | 2 | 10% |
| Balanced | 0.20 mm | 3 | 15% |
| Strength Optimised | 0.20 mm | 5 | 30% |
| Quality Optimised | 0.12 mm | 3 | 15% |

These are starter comparison heuristics, not guarantees of strength, finish, speed or suitability. PrusaSlicer remains the source of truth for estimated time, filament metrics and slicer warnings. Strategy runs are sequential to avoid launching four slicer processes at once.

## Deterministic quick read

After all four strategy runs complete, Modelarium presents a small **Quick read** section.

The quick read:

- compares Fast, Strength Optimised and Quality Optimised directly with Balanced;
- calculates time differences from PrusaSlicer's estimated seconds;
- calculates filament differences from the slicer-derived volume converted using the configured material density;
- provides a fixed "Best suited when..." explanation for each strategy's intended purpose.

This layer does not use AI, does not assign an opaque score and does not declare a universal winner. It only interprets the comparison results already produced for the selected model.

## Presentation polish

The comparison screen avoids repeating strategy override values beneath the table because the active layer height, wall count and infill percentage are already visible in the result columns.

The Quick Read states that its observations are based on real PrusaSlicer results for the selected model.

The baseline result is intentionally secondary to the four-strategy comparison and presents its five primary metrics in a balanced single-row layout on wide desktop views, wrapping responsively on narrower windows.
