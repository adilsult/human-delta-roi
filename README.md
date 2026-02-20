# AI KB ROI Calculator — Human Delta (Demo)

Minimal static site for GitHub Pages (no build step, no frameworks).

## Structure

```text
human-delta-roi/
├── index.html
├── calculator.html
├── assets/
│   ├── css/styles.css
│   ├── js/app.js
│   └── img/.gitkeep
└── README.md
```

## Run locally

```bash
cd human-delta-roi
python -m http.server 8080
```

Open: `http://localhost:8080`

## Create repo and push

```bash
cd human-delta-roi
git init
git add .
git commit -m "Initial demo"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

## Enable GitHub Pages

1. GitHub repo → **Settings** → **Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `main` and **folder**: `/(root)`
4. Save

Demo URL will be:
- Landing: `https://<username>.github.io/<repo>/`
- Calculator: `https://<username>.github.io/<repo>/calculator.html`

## Smoke check

- Open Calculator button works
- Copy Demo Link copies current URL
- Guided → Expert flow works
- Presets work
- Export/Copy/Print work
- Sanity warning appears when annual query estimates diverge by more than `3x`
