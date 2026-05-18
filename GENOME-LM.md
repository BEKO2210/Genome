# GENOME-LM — Forschungs-Redesign

Vom Tool zum **Forschungsartefakt**: GENOME wird so umgebaut, dass es eine *eine* echte,
falsifizierbare Hypothese auf einem *anerkannten* öffentlichen Benchmark testen kann.

---

## Teil A — Das Forschungsprojekt (Blueprint)

### Warum dieses Feld für dich erreichbar ist
Agenten-Gedächtnis wird über öffentliche Benchmarks und API-Calls evaluiert, nicht über
GPU-Training. Datasets sind frei. Der Beitrag besteht aus *Architektur + sauberer Evaluation* —
genau das ist mit einem disziplinierten Builder + KI-Assistenz machbar.

### Forschungsfrage
Verbessert eine explizite Wissens-Lifecycle-Schicht (Supersession + Staleness) die Genauigkeit
bei Knowledge-Update-Aufgaben im Agenten-Gedächtnis — bei gleichem oder geringerem
Token-Verbrauch — gegenüber flachem top-k-Retrieval?

### Hypothese (falsifizierbar — Zahlen VOR dem Run festlegen)
H1: Auf den Knowledge-Update- und Temporal-Kategorien von LongMemEval erreicht GENOME-LM mit
`--lifecycle on` eine um mindestens **___ Prozentpunkte** höhere Accuracy als derselbe Code mit
`--lifecycle off`, **ohne** die Tokens-pro-Frage zu erhöhen.
H0 (Nullhypothese): kein Unterschied über das Rauschen hinaus.

### Was als Erfolg zählt
- **Erfolg** = die Hypothese wird bestätigt ODER widerlegt — *reproduzierbar* und *ehrlich berichtet*.
- Ein sauberes Negativergebnis ("Lifecycle hilft auf dieser Kategorie nicht") ist ein
  vollwertiges Ergebnis. Es wird NICHT weggeworfen.
- Kein Erfolg = ein Ergebnis, das nicht reproduzierbar ist oder auf Cherry-Picking beruht.

### Der Benchmark: LongMemEval
Anerkannter Memory-Benchmark, ~500 Fragen über mehrere Sessions, mit expliziten Kategorien
für Knowledge-Updates und temporales Reasoning. Variante: LongMemEval-S (kleiner, handhabbar).
Offiziell, öffentlich, downloadbar. Bewertung per LLM-as-Judge.

### Die Ablation (das Herz des Experiments)
EIN Schalter `--lifecycle {on,off}` fließt durch Ingest + Retrieval:
- `on`  : neue Atome über denselben Subject-Key superseden ältere; Retrieval liefert nur `current`.
- `off` : keine Supersession, kein Status-Filter — flaches top-k über ALLE Atome (Standard-Baseline).
Beide Modi nutzen denselben Extraktions-Schritt → der LLM-Anteil ist in beiden Armen identisch
und damit KEIN Störfaktor. Nur der Lifecycle unterscheidet sich.

### Wissenschaftliche Integrität (nicht verhandelbar)
1. **Pre-Registration:** `EXPERIMENT.md` mit Hypothese-Zahlen, fixem Judge-Prompt und
   Entscheidungsregel wird ausgefüllt und committet, BEVOR der erste Wertungs-Run läuft.
2. **Kein Peeking:** Das Harness erlaubt kein Tunen an den Test-Antworten.
3. **Vollständige Berichterstattung:** jeder Run landet in `results/`, auch fehlgeschlagene
   und negative. Nichts wird gelöscht.
4. **Reproduzierbarkeit:** fixe Seeds, gepinnte Dependencies, jeder Result-File enthält
   Config, Modellname, Dataset-Hash, Seed, Timestamp.

---

## Teil B — Der Build-Prompt

> Für Claude Code oder jede coding-fähige KI. Komplett in den Agenten einfügen.

```text
Baue GENOME-LM — ein Forschungsartefakt, das EINE falsifizierbare Hypothese auf dem
oeffentlichen Benchmark LongMemEval testet: Verbessert eine explizite Wissens-Lifecycle-Schicht
(Supersession + Staleness) die Genauigkeit bei Knowledge-Update-Aufgaben gegenueber flachem
top-k-Retrieval, bei gleichem oder geringerem Token-Verbrauch?

== HARTE VORGABEN ==
- Python >= 3.11. Einzige zwingende externe Dependency: das offizielle Anthropic-Python-SDK.
  BM25-Retrieval selbst implementieren (keine Retrieval-Dependency). Datasets sind JSON.
- Offline ausser den LLM-API-Calls. Saubere CLI mit argparse. Klare Fehler, sinnvolle Exit-Codes.
- requirements.txt mit gepinnten Versionen. Fixer Default-Seed.
- Liefere JEDE Datei vollstaendig und lauffaehig. Keine Snippets, keine "..."-Platzhalter.

== VERZEICHNIS-LAYOUT ==
genome-lm/
├── genome_lm/
│   ├── __init__.py
│   ├── config.py            # Modellnamen, Seed, Pfade, Default-Parameter
│   ├── memory.py            # Atom-Store: Datenklasse Atom, add/get/all
│   ├── extract.py           # LLM-gestuetzt: Session-Turn -> Atom(e) inkl. subject_key
│   ├── lifecycle.py         # die ABLATIERBARE Mechanik (siehe unten)
│   └── retrieve.py          # BM25-Retrieval (selbst implementiert)
├── harness/
│   ├── __init__.py
│   ├── run_longmemeval.py   # der Experiment-Runner
│   ├── judge.py             # LLM-as-Judge-Scoring
│   └── report.py            # Ergebnis-Tabellen, Aufschluesselung nach Kategorie
├── data/                    # LongMemEval-Dataset (in .gitignore)
├── results/                 # Run-Outputs als JSON, append-only-Charakter
├── EXPERIMENT.md            # Pre-Registration (siehe unten)
├── requirements.txt
├── .gitignore               # data/ , results/*.json , __pycache__ , .env
└── README.md

== ATOM (genome_lm/memory.py) ==
Datenklasse Atom mit Feldern:
  id (str), statement (str), atom_type (str), subject_key (str),
  turn_index (int)  # Reihenfolge in der Session-Historie
  status (str ∈ {"current","superseded","stale"}), supersedes (list[str]),
  source_session (str)
Memory haelt eine Liste von Atomen, mit add(), all(), und current() (= status=="current").

== extract.py ==
Funktion extract_atoms(session_turn_text, turn_index, source_session) -> list[Atom]
- Ruft das Modell (aus config) mit einem FIXEN Extraktions-Prompt auf: zerlege den Turn in
  knappe, atomare Aussagen; jede bekommt einen subject_key (die Entitaet+Attribut, ueber die
  die Aussage geht, z.B. "user.job", "user.home_city").
- Antwort als striktes JSON anfordern und robust parsen.
- WICHTIG: extract.py ist in BEIDEN Ablations-Armen identisch. Es ist kein Stoerfaktor.

== lifecycle.py — DIE ABLATION ==
Funktion apply_lifecycle(memory, new_atom, enabled: bool) -> None
- enabled = True:
    Existiert bereits ein Atom mit gleichem subject_key und kleinerem turn_index, wird das
    aeltere auf status="superseded" gesetzt und seine id in new_atom.supersedes aufgenommen.
    new_atom.status bleibt "current".
- enabled = False:
    No-op. Jedes Atom behaelt status="current". (= flache Baseline, stapelt alle Fakten.)
Funktion mark_stale_by_age(...) optional, in v1 nicht aktiv.

== retrieve.py ==
Eigene BM25-Implementierung (Tokenisierung, IDF, Scoring).
Funktion retrieve(memory, query, k, lifecycle_enabled: bool) -> list[Atom]
- lifecycle_enabled = True : Retrieval-Pool = memory.current()
- lifecycle_enabled = False: Retrieval-Pool = memory.all()  (flaches top-k ueber alles)
Gibt die top-k Atome nach BM25-Score zurueck.

== harness/run_longmemeval.py ==
- Laedt LongMemEval-S aus data/. Hole das offizielle Dataset vom LongMemEval-GitHub-Repo
  und richte dich nach dem TATSAECHLICHEN Dateiformat dort — Schema NICHT raten, sondern
  die echte Struktur einlesen. Falls data/ leer ist: klare Anweisung ausgeben, wie man das
  Dataset ablegt, dann sauber abbrechen.
- CLI: --lifecycle {on,off}  --limit N  --k K  --model NAME  --seed S  --out PFAD
- Pro Frage: alle Session-Turns der Historie via extract.py -> Atome; apply_lifecycle je Atom
  mit dem gewaehlten Modus; dann retrieve(k) fuer die Probe-Frage; Antwort-Prompt aus den
  retrievten Atomen bauen; Modellantwort holen.
- Token-Zaehlung pro Frage (Prompt + Completion) mitloggen, ebenso Latenz.
- Antwort an judge.py uebergeben.
- Schreibt nach results/ eine JSON mit: run-Metadaten (config, modell, dataset-hash, seed,
  timestamp, lifecycle-modus) und pro Frage: frage-id, kategorie, korrekt(bool), tokens, latenz.

== harness/judge.py ==
- LLM-as-Judge. Der Judge-Prompt ist FIX und wird aus EXPERIMENT.md geladen (nicht im Code
  hartkodiert), damit er vor dem Run eingefroren werden kann.
- Vergleicht Modellantwort gegen die Referenzantwort des Datasets -> korrekt True/False.

== harness/report.py ==
- Liest ein oder mehrere results/-JSONs.
- Erzeugt eine Tabelle: Accuracy gesamt UND pro LongMemEval-Kategorie (Knowledge-Update und
  Temporal getrennt sichtbar), mittlere Tokens/Frage, mittlere Latenz.
- Bei zwei Runs (on vs off): Differenz-Spalte je Kategorie.
- Reine Darstellung — interpretiert oder beschoenigt nichts.

== EXPERIMENT.md (generieren, mit auszufuellenden Platzhaltern) ==
Abschnitte:
  # Forschungsfrage
  # Hypothese H1 / H0   (mit Platzhalter <<MINDEST-DELTA IN PP>> — vom Menschen vor dem Run zu setzen)
  # Metrik & Entscheidungsregel  (wann gilt H1 als bestaetigt / widerlegt)
  # Fixer Judge-Prompt  (vollstaendiger Wortlaut — wird von judge.py geladen)
  # Datensatz & Version
  # Status: [ ] pre-registriert und committet  <-  muss VOR dem ersten Wertungs-Run angehakt sein
Deutlicher Hinweis im File: keine Wertungs-Runs starten, bevor dieser Abschnitt ausgefuellt
und committet ist.

== AKZEPTANZTESTS (am Ende nachweislich gruen) ==
1. Installation laut README laeuft; `python -m harness.run_longmemeval --help` zeigt alle Flags.
2. Synthetischer Test in tests/: zwei Atome gleicher subject_key, alter und neuer Wert.
   - Mit lifecycle on: das aeltere Atom hat status "superseded", retrieve liefert nur das neue.
   - Mit lifecycle off: beide Atome bleiben "current", retrieve kann das veraltete liefern.
3. `run_longmemeval --lifecycle off --limit 5` und `--lifecycle on --limit 5` laufen je
   end-to-end durch und schreiben ein valides results-JSON mit Kategorie-Aufschluesselung.
4. report.py erzeugt aus zwei results-JSONs eine Vergleichstabelle mit Differenz-Spalte.
5. Jedes results-JSON enthaelt config, modell, dataset-hash, seed, timestamp, lifecycle-modus.
6. EXPERIMENT.md wird mit allen Abschnitten und dem unausgefuellten Status-Haken erzeugt.

== AUSGABE ==
Liefere alle Dateien vollstaendig und lauffaehig, inkl. tests/, requirements.txt, .gitignore
und einem README mit: Setup, Dataset-Beschaffung, Beispiel-Runs, Reproduktions-Schritte.
Baue NUR das Artefakt und das Harness. Das Ausfuellen von EXPERIMENT.md, das Ausfuehren der
Wertungs-Runs und das Schreiben des Reports ist menschliche Arbeit — automatisiere es nicht weg.
Keine langen Erklaerungen — vollstaendiger, getesteter Code zaehlt.
```

---

## Teil C — Arbeitsweise im KI-Team

| Rolle | KI / Mensch | Auftrag |
|---|---|---|
| **Builder** | Claude Code | baut das Artefakt nach dem Prompt oben |
| **Skeptiker** | eine *andere* KI | bekommt Code + `EXPERIMENT.md` mit dem Auftrag: „Finde jeden methodischen Fehler, jeden versteckten Confounder, jeden Weg, wie dieses Experiment ein Scheinergebnis produzieren könnte." |
| **Statistik-Check** | eine KI | prüft: Stichprobengröße ausreichend? Differenz größer als das Rauschen? Mehrere Seeds nötig? |
| **Schiedsrichter** | **du** | entscheidest. Verifizierst, dass die Zahlen im Report aus echten `results/`-Dateien stammen. Niemand sonst hat dieses letzte Wort. |

### Ablauf bis zum Ergebnis
1. Artefakt mit dem Prompt bauen, Akzeptanztests grün.
2. `EXPERIMENT.md` ausfüllen — Mindest-Delta und Judge-Prompt festlegen — **committen**.
3. LongMemEval-S in `data/` ablegen.
4. Klein anfangen: `--limit 30` je Modus. (Voller Lauf = 500 Fragen × 2 Arme × Judge-Calls →
   das kostet echtes API-Geld, plan ein Budget ein.)
5. Skeptiker-KI auf Methode und Code ansetzen, *bevor* du dem Ergebnis glaubst.
6. Bei stabilem Bild: voller Lauf, mehrere Seeds, `report.py`, ehrlicher Writeup.
7. Code + Writeup öffentlich auf GitHub. Ein reproduzierbares Repo *ist* Teilnahme an der Forschung.

### Was in deiner Hand liegt — und was nicht
In deiner Hand: Rigorosität und Ehrlichkeit. Das entscheidet, ob es Forschung ist oder Marketing.
Nicht in deiner Hand: ob es jemand zitiert. Ein sauberes, reproduzierbares, ehrlich berichtetes
Ergebnis bleibt ein Beitrag — auch wenn der Lifecycle am Ende nichts bringt.
