# Project: Genome

## GENOME — Boot-Regel
Lies beim Start NICHT automatisch das ganze Repo, RUN_LOG.md, docs/ oder archive/.
Kompiliere zuerst die Context Capsule:
  node .genome/genome.mjs brief "<aktuelle aufgabe>" --budget 3500
Lies dann NUR .context/current.capsule.md plus die direkt betroffenen Code-Dateien.
Weitere Dateien nur, wenn die Capsule dafür keinen Kontext liefert.
Nach Abschluss:
  1. Lern-Vorschläge nach .genome/inbox.json schreiben.
  2. node .genome/genome.mjs receipt --task "..." --used <ids> --files <dateien>
  3. node .genome/genome.mjs reflex
Neues Wissen gelangt erst nach `genome review` ins Genome — niemals automatisch.
