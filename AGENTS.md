# AGENTS.md

Static multi-subject quiz app for UNIR. `index.html` is only the page shell; styles live in `css/styles.css`, all JavaScript in `js/app.js`, and question data in `data/`. There is no build step, dependency manifest, test suite, CI, or git repository. Deploy by dragging a folder/zip containing `index.html`, `css/`, `js/`, and `data/` into Netlify Drop. Locally, serve over HTTP (`python3 -m http.server 8000`); opening `index.html` via `file://` breaks the JSON fetches.

## Architecture

- `data/asignaturas.json` — manifest of subjects: `[{ "id", "nombre", "archivo" }]`. `archivo` names a JSON file inside `data/`.
- `data/redes.json` — question bank for "Redes y Comunicaciones": an array of `{ enunciado, opciones: [{ texto, correcta }] }`. Currently 138 questions / 552 options.
- `CargadorAsignaturas` — fetches/validates the manifest and the selected subject bank with `cache: 'no-cache'`.
- `MotorTest` — pure logic: Fisher-Yates shuffle, chunking into batteries of 12 (`generarBaterias`), per-session clone + shuffle (`prepararTestAleatorio`), scoring (`calcularPuntuacion`).
- `AdaptadorDOM` — subject selection screen (dropdown + "Cargar tests"), battery menu, test rendering, answer state, correction, navigation.

To add a subject: create `data/<subject>.json` with the same array format, then add its `{ id, nombre, archivo }` entry to `data/asignaturas.json`. No JavaScript changes are needed. The app starts on the subject selection screen; the user picks a subject and presses "Cargar tests". That hides the selector and shows the subject's tests, with a "Volver a la pantalla principal" button below the test list to return to the selection screen.

## Quirks that matter

- Each subject's questions are split sequentially into batteries of 12 at startup. An incomplete final battery is padded by wrapping around to that subject's first questions. Reordering/inserting/deleting questions reshapes all downstream batteries.
- When a test starts, question order **and** option order are shuffled on a deep clone (`testActivo`). Answers are keyed by shuffled option index, so scoring and correction must use `testActivo`, never `bateriasEstáticas`.
- Multiple options may legitimately be `correcta: true`. The NAT question in `data/redes.json` intentionally has three identical options all marked true — JSON cannot hold the explanatory comment, so preserve the duplicates.
- Scoring is hardcoded in `calcularPuntuacion`: +0.417 per correct, −0.104 per wrong, blank = 0. Displayed score uses 3 decimals.
- Source `enunciado`/`texto` values retain original exam numbering (with gaps) and may contain `+]` artifacts. The UI strips these at render time via `limpiarCitas()` and regexes; don't renumber or fill gaps in the data.
- UI text and question content are Spanish (`lang="es"`). Question/option text is inserted with `innerText`; do not switch to `innerHTML` for it.
- Keep all asset paths relative (`css/styles.css`, `js/app.js`, `./data/...`). Netlify Drop needs no `netlify.toml` or build command. Deploy only the app files; dragging the whole directory would publish this file and `comandos_server.txt` too.

## Verifying changes

No automated tests and no Node.js runtime; Chrome and Firefox are installed for manual/headless checks.

- Validate JSON:
  `python3 -m json.tool data/asignaturas.json > /dev/null`
  `python3 -m json.tool data/redes.json > /dev/null`
- Check the subject manifest and question count:
  `python3 -c "import json; m=json.load(open('data/asignaturas.json', encoding='utf-8')); d=json.load(open('data/redes.json', encoding='utf-8')); print(len(m), len(d), sum(len(p['opciones']) for p in d))"` → `1 138 552`
- Serve locally: `python3 -m http.server 8000`, then open `http://localhost:8000/`
- Expected flow: startup shows only the subject dropdown and "Cargar tests"; pressing it shows 12 test buttons and hides the selector, with "Volver a la pantalla principal" after the last test; tests use shuffled questions/options; submit shows score plus green/red highlighting; "Volver al Menú" returns to the battery list.
- To test subject switching, temporarily add a second manifest entry (for example another id pointing to `redes.json`), verify the dropdown reloads its batteries, then revert the manifest.
- On Netlify: confirm `data/asignaturas.json`, `data/redes.json`, `css/styles.css`, and `js/app.js` return 200, then repeat the full flow.
