# Forschungsfrage

Verbessert eine explizite Wissens-Lifecycle-Schicht (Supersession + Staleness)
die Genauigkeit bei Knowledge-Update-Aufgaben im Agenten-Gedächtnis — bei
gleichem oder geringerem Token-Verbrauch — gegenüber flachem top-k-Retrieval?

# Hypothese H1 / H0

**H1 (Alternativhypothese):** Auf den Knowledge-Update- und Temporal-Kategorien
von LongMemEval-S erreicht GENOME-LM mit `--lifecycle on` eine um mindestens
**<<MINDEST-DELTA IN PP>>** Prozentpunkte höhere Accuracy als derselbe Code mit
`--lifecycle off`, **ohne** die Tokens pro Frage zu erhöhen (Δtokens ≤ 0).

**H0 (Nullhypothese):** Kein Unterschied über das Rauschen hinaus.

# Metrik & Entscheidungsregel

- **Hauptmetrik:** Accuracy auf den Kategorien `knowledge-update` und
  `temporal-reasoning`, bewertet durch den unten fixierten Judge-Prompt.
- **Sekundärmetrik:** mittlere Tokens pro Frage (Prompt + Completion der
  Antwortphase).
- **Voraussetzungen für eine gültige Wertung:**
  - mindestens **<<MINIMALE STICHPROBE PRO KATEGORIE PRO ARM>>** Fragen je
    relevanter Kategorie pro Arm,
  - mindestens **<<MINIMUM SEEDS>>** Seeds; berichtet wird Median ± Spannweite.
- **H1 gilt bestätigt**, wenn der Median Δaccuracy **≥ <<MINDEST-DELTA IN PP>>**
  Prozentpunkte über *beiden* relevanten Kategorien beträgt **UND** der
  Tokens-Mehrverbrauch ≤ 0 ist.
- **H1 gilt widerlegt**, wenn das Konfidenzband um Δaccuracy bei 0 oder
  darunter liegt, oder wenn Lifecycle in einer der relevanten Kategorien
  schlechter abschneidet.

# Fixer Judge-Prompt

You are a strict grader. Decide whether the candidate answer is *semantically
equivalent* to the reference answer for the given question.

Rules:
- Match the substance, not the wording. Different phrasings of the same fact
  count as correct.
- Numeric values must match within the rounding the reference itself implies.
- If the candidate adds extra correct information, still correct. If it
  contradicts the reference, incorrect.
- If the candidate says it doesn't know, incorrect — unless the reference also
  says so.
- Answer with a single word on the first line: "yes" if correct, "no"
  otherwise. After the verdict you may add one short sentence of justification.

Question:
{{question}}

Reference answer:
{{reference}}

Candidate answer:
{{answer}}

# Datensatz & Version

- **Dataset:** LongMemEval-S
- **Quelle:** <https://github.com/xiaowu0162/LongMemEval>
- **Commit-SHA des Datensatzes:** <<COMMIT-SHA EINTRAGEN>>
- **Datei:** `data/longmemeval_s.json`
- **Hash (SHA-256):** wird automatisch in jedes results-JSON geschrieben.

# Status

- [ ] **pre-registriert und committet** — dieser Haken MUSS gesetzt und das
  ausgefüllte File committet sein, bevor der erste Wertungs-Run startet.

> **Wichtig.** Iterations-Runs mit `--limit 5` zum Debuggen sind in Ordnung;
> sie zählen nicht zur Hypothesen-Prüfung. Sobald die Pre-Registration
> committet ist, dürfen die Wertungs-Runs starten — und ab dann darf an dieser
> Datei nichts mehr geändert werden.
