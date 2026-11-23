# toofaan-Bangalore

Toofaan's ride and brawl mechanics on an insane Bangalore traffic track. Free riding; intelligent, honking NPCs; collisions turn into street fights.

Single offline HTML build (`index.html`, served by GitHub Pages). Plain JS, layered (`core < data < sim < view < modes`), deterministic seeded sim with headless tests.

## Status
- **Phase 1 (done):** free-ride shell. Boots straight onto the road; no missions, signals, patrols or scripted encounters; campaign modes removed.
- Next: real curved road model (spline roads, lanes, traffic, collisions), then surfaces and districts, NPC intelligence, contact and damage, in-place street brawl.

## Commands
- `npm run all`: boundary check, tests, animation audit, build
- `node tools/verify-ride.js`: headless boot-and-ride check of the built file
