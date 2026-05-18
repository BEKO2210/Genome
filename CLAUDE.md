# GENOME-LM — Briefing für Claude Code

Du arbeitest in einem Forschungs-Repo. Lies dieses Briefing einmal komplett,
dann brauchst du die Hintergrund-Files (`README.md`, `EXPERIMENT.md`,
`GENOME-LM.md`) nur noch wenn du in deren Detail bohrst.

---

## Was das Projekt ist

**GENOME-LM** testet *eine* falsifizierbare Hypothese auf dem öffentlichen
Memory-Benchmark **LongMemEval-S**:

> Verbessert eine explizite Wissens-Lifecycle-Schicht (Supersession +
> Staleness) die Genauigkeit bei Knowledge-Update-Aufgaben gegenüber flachem
> top-k-Retrieval — bei gleichem oder geringerem Token-Verbrauch?

Ein einziger Schalter `--lifecycle {on,off}` flippt zwischen den beiden Armen.
Die Extraktion ist in beiden Armen **identisch** (kein Confounder), nur die
Lifecycle-Schicht unterscheidet sich.

---

## Architektur in zwei Sätzen

`genome_lm/` ist das Kern-Paket (Atom-Store + Lifecycle + selbst-implementiertes
BM25 + LLM-Extraktion). `harness/` ist der Runner, der pro Frage die
Session-Historie ingestiert, retrievet, antwortet, vom LLM-Judge bewerten
lässt und ein Result-JSON in `results/` schreibt.

Wichtige Files:
- `genome_lm/lifecycle.py` — **das Herz der Ablation**. `apply_lifecycle` ist
  no-op wenn `enabled=False`, sonst markiert es ältere Atome mit gleichem
  `subject_key` als `superseded`.
- `genome_lm/retrieve.py` — BM25 ohne externe Dep. Pool ist `memory.current()`
  bei lifecycle=on, sonst `memory.all()`.
- `genome_lm/clients.py` — zwei Backends: `api` (Anthropic SDK, kostet) und
  `claude-code` (subprocess auf die lokale `claude`-CLI, nutzt Claude.ai-Abo).
- `harness/run_longmemeval.py` — der Runner mit `--lifecycle`, `--backend`,
  `--limit`, `--k`, `--model`, `--seed`.
- `harness/judge.py` — LLM-as-Judge. Lädt den Prompt zur Laufzeit aus
  `EXPERIMENT.md`, damit er per Commit eingefroren werden kann.
- `EXPERIMENT.md` — die **Pre-Registration**. Status-Box ist ✔️, Mindest-Delta
  = 5 pp, Mindest-Stichprobe = 30/Kategorie/Arm, Mindest-Seeds = 3.
  **Ändere diese Datei nicht ohne ausdrückliche Anweisung vom Nutzer.**

---

## Wo wir gerade stehen

Wir sind im Setup für den ersten Smoke-Run. Nutzer arbeitet auf Windows
PowerShell, hat venv + anthropic SDK + Claude Code CLI installiert. Reihenfolge
gerade:

1. ✅ PR #2 (Python-Pipeline) gemergt.
2. ✅ Pre-Registration in EXPERIMENT.md ausgefüllt (5pp / 30 / 3) und
   committet.
3. ✅ PR #3 (claude-code Backend) erstellt — Nutzer merged das gerade.
4. 🟡 Dataset-Download: `longmemeval_s_cleaned.json` von
   `huggingface.co/datasets/xiaowu0162/longmemeval-cleaned` nach `data/`.
   War kurz blockiert weil `data/` Ordner lokal fehlte — `mkdir data` fixt
   es. Im Repo jetzt mit `.gitkeep` getrackt.
5. ⏳ Commit-SHA des Datasets in `EXPERIMENT.md` eintragen
   (`<<COMMIT-SHA EINTRAGEN>>` ersetzen), committen, pushen.
6. ⏳ Smoke-Run mit `--backend claude-code --limit 5 --model
   claude-haiku-4-5-20251001` für beide Arme.
7. ⏳ `python -m harness.report results\run-off-*.json results\run-on-*.json`.

---

## Harte Regeln

- **EXPERIMENT.md ist nach dem Commit gesperrt.** Nicht editieren ohne dass
  der Nutzer explizit dazu auffordert. Iterations-Runs mit `--limit 5`
  zählen nicht zur Wertung; volle Wertungs-Runs dürfen *erst* starten, wenn
  Pre-Registration commit-fest ist (Status: ✔️).
- **Default-Backend für diesen Nutzer ist `--backend claude-code`** (keine
  API-Kosten). Nicht ohne Rücksprache auf `api` zurück.
- **Default-Modell für Smoke-Runs ist `claude-haiku-4-5-20251001`**
  (kostenschonend). Wertungs-Runs mit Sonnet 4.6 oder Opus 4.7 nur nach
  Absprache.
- **Lizenz:** PolyForm Noncommercial 1.0.0. Bei Kommerz-Anfragen → siehe
  `LICENSE` (Sektion Commercial Licensing).
- **Niemals an `results/`-JSONs nachträglich rumdoktern.** Append-only
  Charakter, auch fehlgeschlagene Runs bleiben drin.

---

## Plattform-Notizen

Nutzer auf **Windows / PowerShell**:
- venv-Aktivierung: `.venv\Scripts\Activate.ps1` (nicht `source`).
- Dateipfade mit Backslash, aber Python akzeptiert beides.
- `Invoke-WebRequest` statt `wget`.
- Manche PowerShell-Versionen kennen `||` nicht — einzelne Zeilen sind sicherer.

---

## Bei Problemen

- **`claude CLI not found`** → `npm install -g @anthropic-ai/claude-code`,
  dann `claude login`.
- **Dataset 404** → URL ist
  `https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json`.
  Falls die kaputt: README des LongMemEval-Repos checken via WebFetch.
- **Judge-Fehler "<< >> placeholders"** → jemand hat die Pre-Registration
  beschädigt. Status mit `git diff EXPERIMENT.md` checken und mit dem Nutzer
  klären.
- **Rate Limit auf Claude-Code-Backend** → Max-Abo-Quote überschritten.
  Entweder warten oder ein paar Stunden später nochmal.

---

## Tests

```bash
python -m unittest discover -s tests -v
```

Drei Lifecycle-Tests, sollten immer grün sein. Bei Änderungen an
`lifecycle.py` oder `retrieve.py` zwingend laufen lassen.
