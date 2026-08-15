# ⚡ pixpower — Hauskosten-Dashboard

Erfassung und Auswertung aller Hauskosten (Strom, Wasser, Abwasser, Brennholz,
Kaminkehrer, Wartung) mit sauberer Monatsübersicht, Filtern und druckfertigem
Jahresbericht. Später: Investitionsplanung für Heizungserneuerung
(Wärmepumpe / Pellet / PV) mit ROI-Rechnung.

**Live:** https://hannespix.github.io/pixpower/ (deployt automatisch bei jedem Merge auf `main`)

## Architektur: Git ist die Datenbank

Keine Datenbank, kein Server. Die Wahrheit liegt in drei JSON-Dateien:

| Datei | Inhalt |
|---|---|
| `data/invoices.json` | Belege: Abrechnungen, Abschläge, Einkäufe, Einzelbelege |
| `data/readings.json` | Zählerstände (Strom, Wasser) |
| `data/settings.json` | Haus-Stammdaten, Gradtagzahl-Profil, Holz-Verteilung |

Jede Änderung läuft als PR: Der Diff zeigt exakt, welche Zahlen dazukommen,
die CI validiert gegen Zod-Schemas (`app/scripts/validate.ts`), nach dem Merge
deployt GitHub Actions auf Pages. `git log` ist die Historie, jeder Clone das Backup.

### Daten einpflegen

1. **Der bequeme Weg:** Rechnung (PDF/Foto) in einer Claude-Session abgeben —
   sie wird gelesen, normalisiert und als PR eingepflegt.
2. **Der manuelle Weg:** Im Dashboard unter *Erfassen* das Formular ausfüllen,
   validierten JSON-Schnipsel kopieren, in `data/invoices.json` einfügen.

Original-PDFs bleiben **lokal** (per `.gitignore` ausgeschlossen); Belege
referenzieren sie über `sourceFile`.

## Zahlung ist nicht Verbrauch — die Periodisierung

Der Kern der Auswertung (`app/src/lib/engine.ts`):

- **Abrechnungen** werden über ihren Leistungszeitraum verteilt und
  **verdrängen Abschläge** derselben Kategorie in diesem Zeitraum. Solange die
  Jahresabrechnung fehlt, gelten die Abschläge als beste Schätzung.
- **Wärmekosten** werden mit **Gradtagzahlen** gewichtet (Jan ≈ 17 % der
  Jahresheizarbeit, Jul ≈ 1 %) — ein Wintermonat kostet real mehr als ein Sommermonat.
- **Holzeinkäufe** gehen ins Lager und werden ab Kaufdatum über
  `woodSpreadMonths` (Standard 12) Monate heizlastgewichtet aufgelöst —
  der Kauf im Mai macht nicht den Mai teuer, sondern den folgenden Winter.

## Datenschutz: verschlüsseltes Deployment

GitHub Pages ist immer öffentlich erreichbar. Deshalb kann das Daten-Bundle im
Build **AES-256-GCM-verschlüsselt** werden (PBKDF2-SHA256, 310 000 Iterationen):

1. Repository-Secret **`DATA_PASSPHRASE`** setzen
   (*Settings → Secrets and variables → Actions*).
2. Ab dem nächsten Deploy liegt auf Pages nur Ciphertext; das Dashboard fragt
   die Passphrase ab und entschlüsselt **vollständig im Browser** (WebCrypto).

Ohne Secret wird im Klartext gebaut (Demo-Betrieb) — der Build warnt dann im Log.

## Entwicklung

```bash
cd app
npm ci
npm run dev        # baut data.json aus /data und startet Vite
npm run validate   # Datenvalidierung (läuft auch in CI)
npm run build      # validate + data + tsc + vite build
```

Stack: Vite · React · TypeScript · Tailwind CSS 4 · Apache ECharts (SVG) ·
TanStack Table · Zod. PDF-Export über die Druckansicht (*Bericht →
Drucken / Als PDF speichern*).

## Roadmap

- [ ] Echte Rechnungen einpflegen (`demoData: false`)
- [ ] Investitionsmodul: Szenarienvergleich Wärmepumpe / Pellet / Scheitholz neu,
      PV mit PVGIS-Ertragsdaten, Annuitätenmethode (VDI 2067), Förderung (KfW 458),
      CO₂-Preispfad, Sensitivitäten, Amortisation
- [ ] Zählerstands-Schnellerfassung per GitHub Issue-Form + Action
- [ ] Witterungsbereinigung mit echten Gradtagzahlen des Standorts
