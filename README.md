# Signal Scan

Web-App, die historische Kursdaten nach frei kombinierbaren Indikator-Bedingungen
durchsucht (z.B. `Regime = Bull` UND `SMI ≤ -26`) und den durchschnittlichen
Kursverlauf der folgenden N Kerzen nach jedem Treffer zeigt.

- **Frontend:** reines HTML/CSS/JS (kein Build-Schritt, kein Framework) – läuft
  als statische Seite über **GitHub Pages**.
- **Daten:** werden per **GitHub Actions** täglich über [yfinance](https://github.com/ranaroussi/yfinance)
  (Yahoo Finance) geladen und als JSON ins Repo committet. Kein API-Key nötig,
  kein Server, kein Streamlit.

```
docs/                     ← GitHub-Pages-Root
  index.html
  app.js                  ← UI-Logik
  indicators.js           ← Indikatoren + Scan-Engine (hier neue Indikatoren ergänzen)
  chart.js                ← Chart-Rendering (Canvas)
  style.css
  data/                   ← wird vom Workflow befüllt (manifest.json + *_1d/1h/5m.json)
scripts/
  fetch_data.py           ← lädt Daten via yfinance (hier neue Symbole ergänzen)
  requirements.txt
.github/workflows/
  update-data.yml         ← geplanter täglicher Datenupdate-Job
```

## Setup (einmalig)

1. **GitHub Pages aktivieren:**
   `Settings → Pages → Source: Deploy from a branch → Branch: main, Folder: /docs → Save`

2. **Workflow einmal manuell anstoßen**, damit die erste Datenladung passiert:
   `Actions-Tab → "Update market data" → Run workflow`
   (Bei einem neu erstellten Repo müssen Actions ggf. unter `Settings → Actions →
   General` erst erlaubt werden.)

3. Nach ein bis zwei Minuten ist der Lauf fertig, `docs/data/*.json` wurde committet.
   Die Pages-Seite (URL steht unter `Settings → Pages`) zeigt jetzt die Märkte
   in der Auswahl an.

Der Workflow läuft danach automatisch **täglich** (Cron in `update-data.yml`,
anpassbar) und lässt sich jederzeit auch manuell erneut starten.

## Wichtig: Grenzen der Intraday-Historie

Yahoo Finance liefert über yfinance nur eine begrenzte Rückschau:

| Zeiteinheit | verfügbare Historie pro Abruf |
|---|---|
| 1d | mehrere Jahre (voll) |
| 1h | ca. 730 Tage |
| 5m | ca. 60 Tage |

`fetch_data.py` **merged** neu geladene Bars mit den bereits gespeicherten
(statt sie zu überschreiben) – die 5-Minuten- und 1-Stunden-Historie wächst
also mit jedem täglichen Lauf weiter. Direkt nach dem ersten Lauf ist die
5-Min-Stichprobe entsprechend noch klein; für belastbare Auswertungen auf
5m-Basis braucht es etwas Zeit (oder Wochen/Monate laufen lassen).

## Neue Symbole hinzufügen

In `scripts/fetch_data.py` das `SYMBOLS`-Dict erweitern (Anzeigename → Yahoo-Ticker,
z.B. `"USDJPY": "USDJPY=X"`, für Aktien z.B. `"AAPL": "AAPL"`). Beim nächsten
Workflow-Lauf wird das Symbol automatisch mitgeladen und erscheint in der App.

## Neue Indikatoren hinzufügen

In `docs/indicators.js` ein neues Objekt im `INDICATOR_REGISTRY` ergänzen:

```js
meinIndikator: {
  id: "meinIndikator",
  label: "Mein Indikator",
  valueType: "numeric",       // oder "category" (wie bei Regime)
  range: [0, 100],            // nur für Anzeige/Chart-Zwecke
  params: [
    { key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 200 },
  ],
  compute: (bars, params) => {
    return bars.map(() => null);
  },
},
```

Die UI baut sich automatisch aus dieser Definition auf.

## Disclaimer

Rein statistische Auswertung historischer Daten. Keine Anlageberatung, keine
Garantie, dass sich beobachtete Muster in der Zukunft wiederholen.
