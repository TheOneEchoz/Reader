# Tankōbon: source

This folder is not part of the website (GitHub Pages leaves out folders that start with `_`).

- `app.html`: the whole app. The build fills in the version, the changelog and the channel.
- `changelog.json`: every release, newest first. Entries with `"beta": true` are experimental-only.
- `build.py`: `python3 build.py beta` writes `../beta/` (experimental); `python3 build.py stable` writes the site root.
  The newest changelog entry the channel shows must match the channel. Add an entry before building.
- `sw.js`: the service worker template.
- `test/`: Playwright tests (`npm install playwright jszip` in `test/`, Chromium from Playwright).
  Most expect the experimental build served on http://localhost:8768 (`python3 build.py beta /tmp/bt && python3 -m http.server 8768 -d /tmp/bt`)
  and the Ren'Py runtimes in `../renpy/`. Ren'Py test games: the demo game built by the "Ren'Py runtimes" workflow
  (run it with FIXTURES=1), repacked with `tools/mkrpa.py` to put its pictures and music in an archive like real games.
- `tools/mkrpa.py`: packs a Ren'Py game's pictures, music and fonts into game/archive.rpa (RPA-3.0, as Ren'Py does).
