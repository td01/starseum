# Starseum

An AI-powered museum of extraordinary lives. Generates immersive, scroll-animated timelines for historical figures — with real photos from Wikipedia and YouTube documentaries.

## Tech stack

- Vanilla HTML/CSS/JS (no build step needed)
- Netlify serverless function to proxy Claude API calls
- Wikipedia REST API for photos
- YouTube embeds for documentaries

## Project structure

```
starseum/
├── public/
│   └── index.html        # The entire frontend
├── netlify/
│   └── functions/
│       └── claude.js     # API proxy (keeps your key secret)
├── netlify.toml          # Netlify routing + headers config
├── .gitignore
└── README.md
```

## Setup

### 1. Clone and push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/starseum.git
git push -u origin main
```

### 2. Connect to Netlify

1. Go to [netlify.com](https://netlify.com) → **Add new site** → **Import from GitHub**
2. Select your `starseum` repo
3. Build settings are auto-detected from `netlify.toml` — no changes needed
4. Click **Deploy site**

### 3. Add your API key

In Netlify dashboard → **Site configuration** → **Environment variables** → **Add variable**:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (from [console.anthropic.com](https://console.anthropic.com)) |

Then go to **Deploys** → **Trigger deploy** to pick up the new env var.

### 4. Done

Your site is live. Every push to `main` auto-deploys.

## Local development

Install the Netlify CLI to run functions locally:

```bash
npm install -g netlify-cli
# Create a .env file with your key:
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
# Run locally:
netlify dev
# Open http://localhost:8888
```
