# IdeaInspector

Open-source AI diligence for startup ideas, with a built-in **AI consultant**.

Describe an idea, get an honest investor-style memo (score out of 100, risks, roadmap, Go / Pass call), then **chat with a consultant** about it, fix anything the AI misunderstood, and **re-run the report in place**. No accounts. Bring your own AI key and use **any provider and any model**.

- **Landing page** that explains the platform (`/`), a **Builder** page (`/builder`) and the **Dashboard** (`/app`).
- **Reports**: same memo and PDF export as before (full PDF + one-page summary).
- **Consultant chat**: every chat belongs to one report. Open as many chats per report as you like.
- **Re-run from chat**: when the consultant understands your idea, press *Re-run report*. You review the updated description first, then the **same report is updated in place** (no old copies; the score change is shown).
- **Consulting toolkit**: the chat loads frameworks from the [business-consulting](https://github.com/abinauv/business-consulting) skill pack (16 skills, 8 one-click commands, 5 industry overlays), chosen per question.
- **Any AI**: Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Ollama / LM Studio, or any OpenAI-compatible URL.
- **Private**: reports and chats are stored in *your browser* (IndexedDB). Export/import a backup from Settings.

---

## How reports and chats are connected

| Rule | How it works |
|---|---|
| A report is only made from an idea | *New idea* is the only way to create a report. Chats can never create one. |
| Many chats per report | *Report page → Chat with consultant / + New chat*. |
| Re-run from a chat | *Chat → Re-run report from chat*. The AI summarises what it learned, you edit it, and the report is regenerated. |
| No old versions | A re-run overwrites the report. Only the previous **score** is kept, to show `▲ +20 vs previous run`. |
| Chats stay attached | Chats survive re-runs and always read the latest report. |
| Deleting a report | Also deletes its chats. |

The consultant never invents facts for the re-run: the updated description is built only from what *you* said, and you can edit it before it is scored.

---

## Run it locally

Needs [Node.js](https://nodejs.org) 18+. There are **no dependencies to install**.

```bash
git clone https://github.com/Bharat2456/IdeaInspector.git
cd IdeaInspector
npm start
```

Open http://localhost:3000 → **Dashboard** → **Settings**, pick a provider, paste your key, type a model name, **Save**, then **Test connection**.

Local models (Ollama / LM Studio) work when you run the app locally.

---

## Put it on GitHub

```bash
cd IdeaInspector            # the unzipped folder
git init
git add .
git commit -m "IdeaInspector v2: landing, dashboard, consultant chat"
git branch -M main
git remote add origin https://github.com/Bharat2456/IdeaInspector.git
git push -u origin main --force   # --force replaces the old version of the repo
```

(Drop `--force` if you push into a new, empty repository.)

## Deploy on Vercel

1. Go to https://vercel.com/new and **import the GitHub repo**.
2. Leave every setting as detected (Framework: *Other*). `vercel.json` already sets the output folder and API timeout. No build command, no environment variables.
3. Click **Deploy**. Share the URL: visitors land on the home page, click **Dashboard**, add their own key in **Settings**, and use it.

If Vercel complains about `maxDuration: 300` on your plan, change it to `60` in `vercel.json` (a report with web search may then occasionally time out).

> **Do not set `LLM_API_KEY` on a public deployment**: everyone who opens the site would spend *your* key. Leave it empty so each visitor uses their own.

---

## How it works

```
Browser (UI, storage, PDF)  →  /api/*  (stateless serverless functions)  →  your AI provider
   reports + chats in IndexedDB     builds prompts, picks consulting skills,      Claude / GPT / Gemini / ...
   key in localStorage              forwards your key for that one request
```

```
public/                 index.html (landing) · builder.html · app.html (dashboard)
  assets/css, assets/js   theme + report styles (unchanged look) · app, db, settings, pdf, render
api/                    report.js · consult.js · brief.js · test.js · config.js
lib/                    llm.js (provider adapters) · consultant.js (skill router + prompts)
                        guard.js (SSRF + settings validation) · report-prompt.js (original prompt)
                        consulting-data.json (packed skills; rebuild with `npm run build:consulting`)
consulting/             the original business-consulting files (MIT, by Abi)
server.js               zero-dependency local server (not used on Vercel)
test/                   `npm test` (unit tests) and a mock provider
```

**Consultant routing.** For each message the server scores the 16 skills against your question (plus the report's weakest categories), loads the best 1–3 `SKILL.md` files, an industry overlay if one fits, and the command brief if you used a quick button. *Settings → Consultant depth* controls how much is loaded (use *Compact* for small local models). Each answer shows which frameworks were used.

## Security notes

- Your key lives in your browser and is forwarded per request; the server stores nothing and logs nothing.
- All model output is HTML-escaped before display (the chat uses a small safe Markdown renderer). A strict CSP blocks inline scripts.
- On hosted deployments, custom base URLs must be public `https://` addresses (private networks are blocked).
- Attachments are limited to 3 MB total because Vercel functions accept ~4.5 MB request bodies.

## Limitations

- Web search is available only with the Anthropic provider (toggle in Settings). Other providers answer from the model's own knowledge.
- PDF attachments need a model that accepts PDFs; images need a vision model.
- Data lives in one browser. Clearing site data deletes it, so use *Export backup*.
- As before: this has never talked to a customer, the score is a judgment not a statistic, and it is not investment advice. Use it to reject fast, not to greenlight.

## Credits & licence

MIT. See [LICENSE](LICENSE). The consultant uses the [business-consulting](https://github.com/abinauv/business-consulting) plugin by Abi (MIT, see `consulting/LICENSE`).

Built by [Bharat Wagh](https://www.linkedin.com/in/bharat-wagh-96b3082a8).
