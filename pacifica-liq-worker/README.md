# PacificaLens Liquidation Worker

WebSocket worker that listens to Pacifica DEX and writes liquidation events to Supabase.

## Deploy on Render.com (free tier)

1. Push this folder to a GitHub repo
2. Render.com → New → Web Service → connect repo
3. Settings:
   - Build Command: `npm install`
   - Start Command: `node index.js`
4. Environment Variables:
   - `SUPABASE_URL` → your Supabase project URL
   - `SUPABASE_ANON_KEY` → your Supabase anon key
   - `RENDER_EXTERNAL_URL` → your Render service URL (e.g. https://pacifica-liq-worker.onrender.com)
