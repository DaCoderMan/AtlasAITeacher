# Atlas Game Graphics Pipeline

Production pipeline for all Atlas Learning Arcade visual assets.

## Core rule

Generate large, clean source artwork first; derive deterministic crops and compose exact text/state as real UI afterward. Never trust generated infographic text for canonical XP, mastery, certification data or other dynamic values.

## Pipeline

1. Visual brief per game: theme, learning domain, symbols, mood, subject, safe zones and prohibited/misleading elements.
2. Asset map before generation: map each master to game + slot (hero, card, boss, map, achievement, banner, background).
3. Generate one large master per game/major scene, normally without critical embedded text.
4. Preserve master source and provenance.
5. Define focal point and safe zone.
6. Derive smart crops for landscape, square, portrait/mobile, banner and thumbnails; never stretch.
7. Compose titles, XP, mastery, Transfer Score, domains, mocks and buttons as deterministic UI overlays from canonical state.
8. Validate semantic placement: an asset may only appear in the correct game.
9. Produce responsive desktop/tablet/mobile variants.
10. QA content accuracy, crop quality, contrast, clipping, gibberish text, duplicate/wrong symbols and state consistency.
11. Export deterministic paths and register URI/checksum/dimensions/slot/variant in `atlas_game_assets`.
12. Re-crop existing masters when layouts change; regenerate master art only when the visual concept changes.

## Storage convention

Recommended logical path:
`/atlas-games/<game-slug>/graphics/master/...`
`/atlas-games/<game-slug>/graphics/crops/<slot>-<ratio>-vN.*`

Large binaries belong in Google Drive or approved object storage. GitHub stores code, manifests and metadata.
