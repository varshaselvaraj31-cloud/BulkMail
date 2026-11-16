# Bulk Mail

A React and Express bulk email app with MongoDB campaign history. Recipients are added as BCC, and each send attempt is recorded with its status.

## Architecture

| Part | Folder | Runs on |
| --- | --- | --- |
| Frontend, React + Vite single-page app | `frontend/` | Vercel |
| API, Express 5 + Mongoose + Nodemailer, HTTP Basic auth | `backend/` | Render |
| Database | MongoDB Atlas | Atlas |
| Optional: the same API as a Vercel serverless function | `api/[...path].js` | Vercel (only if you skip Render) |

The frontend calls the API at `VITE_API_URL`. The API only answers browsers whose origin is listed in `CLIENT_ORIGIN`.

## Requirements

- Node.js 18.17 or newer
- MongoDB running locally, or a MongoDB Atlas connection string
- A mail account with SMTP access (Gmail users must use a Google App Password, not their account password)

## Local setup

1. Install dependencies:

   ```sh
   npm install
   npm install --prefix backend
   npm install --prefix frontend
   ```

2. Copy `backend/.env.example` to `backend/.env` and set `ADMIN_USER`, a strong `ADMIN_PASS`, `EMAIL_USER`, `EMAIL_PASS`, and (if needed) `MONGODB_URI`. Never put admin or SMTP credentials in frontend configuration.

3. Optionally copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL` if the backend is not at `http://localhost:5001/api`.

4. Start MongoDB, then run both applications:

   ```sh
   npm run dev
   ```

   The frontend is at `http://localhost:5173`; the API listens on `http://localhost:5001`.

5. Run the API tests (no database needed):

   ```sh
   npm test
   ```

## API

- `GET /` — service banner
- `GET /api/health` — liveness. Always `200` while the process runs; reports `database`, `mailConfigured`, `adminConfigured` and `allowedOrigins` so a deployment can be checked from the browser.
- `GET /api/ready` — readiness. `200` only when MongoDB is connected, otherwise `503`.
- `GET /api/emails` — latest 50 send attempts
- `POST /api/emails` — send and save an email

The send endpoint accepts `{ "subject": "...", "body": "...", "recipients": "a@example.com, b@example.com" }` with up to 100 unique addresses per request.

The history and send endpoints require HTTP Basic authentication using the admin credentials. The frontend keeps the credentials in memory only; use HTTPS when exposing the app outside localhost. While the database is unreachable these endpoints answer `503` with the reason instead of hanging.

## Backend environment variables

| Variable | Required | Production example | Notes |
| --- | --- | --- | --- |
| `PORT` | no | provided by Render | Do not set on Render. |
| `MONGODB_URI` | yes | `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/bulkmail` | Atlas string. `127.0.0.1` only works on your own laptop. |
| `CLIENT_ORIGIN` | yes | `https://your-app.vercel.app,https://your-app-*.vercel.app` | Comma separated, exact scheme and host, no trailing slash. `*` matches one DNS label. |
| `ADMIN_USER`, `ADMIN_PASS` | yes | | Dashboard sign-in. |
| `EMAIL_SERVICE` | no | `gmail` | Nodemailer well-known service name. |
| `EMAIL_USER`, `EMAIL_PASS` | for sending | | Gmail App Password. |

In production (`RENDER=true` or `NODE_ENV=production`) there are no localhost fallbacks: a missing `MONGODB_URI` is reported by `/api/health` and the logs, and only the origins in `CLIENT_ORIGIN` are allowed.

## Deploying: API on Render, frontend on Vercel

### 1. MongoDB Atlas

1. Database Access: create a dedicated database user with read/write on `bulkmail`. Do not reuse the dashboard admin password.
2. Network Access: add `0.0.0.0/0`. Render's free tier has no fixed outbound IP, so a single-IP rule will not work.
3. Connect > Drivers: copy the `mongodb+srv://` string, replace `<password>`, and put `/bulkmail` before the `?` so the database name is set.

### 2. Render (API)

1. New > Web Service > this repository. Root Directory `backend`, Build Command `npm ci`, Start Command `npm start`. (New > Blueprint reads `render.yaml` and creates the same service.)
2. Environment tab: add every variable from the table above. Leave `PORT` out.
3. Deploy, then open Logs. A healthy start prints:

   ```
   Bulk Mail API listening on port 10000
   Allowed origins: https://your-app.vercel.app
   MongoDB connected to cluster0.xxxxx.mongodb.net.
   ```

4. Open `https://<your-service>.onrender.com/api/health` in a browser. It must show `"database": "connected"` and your Vercel URL under `allowedOrigins`.

### 3. Vercel (frontend)

1. Import the repository. Keep the Root Directory at the repository root (`vercel.json` builds `frontend/` into `dist/`).
2. Environment Variables: `VITE_API_URL=https://<your-service>.onrender.com/api`. Vite inlines this at build time, so redeploy after changing it.
3. Open the Vercel URL and sign in with `ADMIN_USER` and `ADMIN_PASS`.

Whenever the Vercel URL changes, add the new one to `CLIENT_ORIGIN` on Render (comma separated) and save; Render restarts the service.

### Troubleshooting

| What you see | Cause | Fix |
| --- | --- | --- |
| Browser: `No 'Access-Control-Allow-Origin' header`, and the Render URL hangs or returns 404 | The API process never started, usually a MongoDB connection failure | Open Render Logs; fix `MONGODB_URI`; redeploy |
| Browser CORS error, but `/api/health` loads | The Vercel origin is not in `CLIENT_ORIGIN` | Add the exact origin (`https://`, no trailing slash). Render Logs print `CORS: blocked origin ...` with the value to add |
| Log: `ECONNREFUSED 127.0.0.1:27017` | `MONGODB_URI` still points at localhost | Set the Atlas string |
| Log: `Could not connect to any servers in your MongoDB Atlas cluster` | Atlas Network Access blocks Render | Add `0.0.0.0/0` in Atlas |
| Log: `bad auth` | Wrong Atlas database user or password | Fix the user in Atlas Database Access, update `MONGODB_URI` |
| `503 Email delivery is not configured` | `EMAIL_USER` or `EMAIL_PASS` missing | Set them on Render |
| `502 Email delivery failed` | Gmail rejected the login | Use an App Password with 2-step verification enabled |
| Login: `Cannot reach the API at ...` | API down, or wrong `VITE_API_URL` | Check `/api/health`; fix the Vercel variable and redeploy |
| First request after a long idle takes a minute | Render free tier spins the service down | Expected; the first request wakes it |

## Alternative: full-stack on Vercel

The repository can also deploy the frontend and the API together on Vercel. The API then runs as the serverless function in `api/[...path].js`; MongoDB and SMTP stay external.

1. Import the repository with the Root Directory at the repository root.
2. Add `MONGODB_URI`, `ADMIN_USER`, `ADMIN_PASS`, `EMAIL_USER`, `EMAIL_PASS` (and `EMAIL_SERVICE`) as Production environment variables. Leave `VITE_API_URL` unset so the frontend calls the same-origin `/api`.
3. Deploy, open the Vercel URL and sign in.

## Security notes

- Never commit `.env` files or paste real credentials into chat or messaging apps. If a secret has been shared that way, rotate it: Gmail App Password, Atlas database user password, `ADMIN_PASS`.
- Use different passwords for the Atlas database user and the dashboard admin.
- Credentials travel as HTTP Basic auth, so the API must only be reached over HTTPS (Render and Vercel provide it).
