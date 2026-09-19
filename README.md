# ⛽ Prezzi Carburanti Italia — Dashboard

Dashboard interattiva dei prezzi carburanti italiani, aggiornata quotidianamente con i dati Open Data del MIMIT.

## 🔗 Demo

👉 **[carburanti.samuelecorona.it](https://carburanti.samuelecorona.it)** (o il tuo dominio)

## 📊 Funzionalità

- **Panoramica nazionale**: medie benzina, gasolio, GPL, metano (self/servito) con variazioni giornaliere
- **Grafico trend**: andamento ultimi 30/60/90 giorni
- **Vista regionale**: tabella delle 20 regioni con drill-down provinciale
- **Ricerca per comune/CAP**: trova i prezzi medi nella tua zona
- **Dark/Light mode**: toggle tema con persistenza

## 🏗️ Architettura

```
GitHub Actions (cron 7:00 UTC) → Python ETL → JSON → Cloudflare Pages
```

1. Ogni mattina GitHub Actions esegue `etl/fetch_and_process.py`
2. Lo script scarica i CSV dal MIMIT, calcola aggregazioni e variazioni
3. I risultati sono salvati come JSON in `data/` e `site/data/`
4. Il push automatico triggera il re-deploy su Cloudflare Pages

## 🚀 Setup

### 1. Fork del repository

Clicca "Fork" su GitHub per copiare il repo nel tuo account.

### 2. Collegare Cloudflare Pages

1. Vai su [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create**
2. Seleziona **Pages** → **Connect to Git**
3. Autorizza GitHub e seleziona il repo forkato
4. Configurazione build:
   - **Build command**: *(lascia vuoto)*
   - **Build output directory**: `site`
5. Clicca **Save and Deploy**

### 3. Custom Domain (opzionale)

1. In Cloudflare Pages → il tuo progetto → **Custom domains**
2. Aggiungi `carburanti.tuodominio.it`
3. Se il dominio è già su Cloudflare, il DNS viene configurato automaticamente

### 4. Primo run

1. Vai su **Actions** nel repo GitHub
2. Seleziona "Aggiornamento Prezzi Carburanti"
3. Clicca **Run workflow** → **Run workflow**
4. Attendi ~2 minuti, poi verifica che i file JSON appaiano in `data/`

### 5. Verifica

Visita il tuo dominio — dovresti vedere la dashboard con i dati aggiornati!

## 📁 Struttura

```
├── .github/workflows/
│   └── daily_update.yml        — Cron giornaliero
├── etl/
│   └── fetch_and_process.py    — Script ETL Python
├── site/
│   ├── index.html              — Dashboard HTML
│   ├── style.css               — Stili (dark/light theme)
│   ├── app.js                  — Logica interattiva
│   └── data/                   — JSON (copiati dal ETL)
├── data/                       — JSON generati dall'ETL
├── requirements.txt
└── README.md
```

## 📋 Dati

- **Fonte**: [MIMIT Open Data](https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti)
- **Licenza dati**: IODL 2.0
- **Aggiornamento**: quotidiano (snapshot alle 8:00)
- **Impianti**: ~22.000-25.000 attivi
- **Storico**: ultimi 90 giorni

## ⚠️ Note

- I CSV del MIMIT sono snapshot giornalieri (non incrementali)
- Se GitHub Actions salta un giorno, quel dato è perso
- I prezzi del metano sono in €/kg, non €/litro
- Il separatore CSV è `|` (pipe) dal 10 febbraio 2026
