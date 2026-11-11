# Bulk Mail

A React and Express bulk email app with MongoDB campaign history. Recipients are added as BCC, and each send attempt is recorded with its status.

## Requirements

- Node.js 18 or newer
- MongoDB running locally, or a MongoDB connection string
- A mail account with SMTP access (Gmail users must use a Google app password, not their account password)

## Setup

1. Install the project and app dependencies:

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

## API

- `GET /api/health` — API and database status
- `GET /api/emails` — latest 50 send attempts
- `POST /api/emails` — send and save an email

The send endpoint accepts `{ "subject": "...", "body": "...", "recipients": "a@example.com, b@example.com" }`. It accepts up to 100 unique email addresses per request.

The history and send endpoints require HTTP Basic authentication using the admin credentials. The frontend keeps the credentials in memory only; use HTTPS when exposing the app outside localhost.

## Deploying on Vercel

The repository is configured to deploy the React frontend and Express API together as one Vercel project. The API uses a Vercel serverless function; MongoDB and SMTP are external services.

1. Create a MongoDB Atlas database and allow network access for the deployed Vercel function. Use a dedicated database user and keep its connection string private.
2. In Vercel, import this GitHub repository and keep the project root directory at the repository root (do not set it to `frontend`, because that would exclude the API function).
3. Before deploying, add these environment variables in the Vercel project settings for Production: `MONGODB_URI`, `ADMIN_USER`, `ADMIN_PASS`, `EMAIL_USER`, and `EMAIL_PASS`. Set `EMAIL_SERVICE` to `gmail` if using Gmail. Use a strong, unique admin password and a Gmail App Password, never a regular Gmail password.
4. Deploy the project. The frontend calls the same-origin `/api` routes, so no frontend API URL setting is needed.
5. After deployment, open the Vercel-provided URL and sign in with `ADMIN_USER` and `ADMIN_PASS`.

Keep production credentials only in Vercel's private environment-variable settings. Do not commit `.env` files or share secrets in chat.
