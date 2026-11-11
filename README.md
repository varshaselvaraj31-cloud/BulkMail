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

3. Optionally copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL` if the backend is not at `http://localhost:5000/api`.

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

## Deploying with Vercel and Render

1. Create a MongoDB Atlas database and allow connections from your Render service. Use a dedicated database user and keep its connection string private.
2. In Render, create a Blueprint from this repository and use `render.yaml`. Set `MONGODB_URI`, `ADMIN_PASS`, `EMAIL_USER`, and `EMAIL_PASS` as private environment values. Use a strong, unique admin password and a Gmail App Password; never use your regular Gmail password.
3. After the Render API is deployed, copy its service URL, such as `https://bulkmail-api.onrender.com`.
4. In Vercel, import this repository and set the project root directory to `frontend`. Add the `VITE_API_URL` environment variable with the Render URL followed by `/api`, for example `https://bulkmail-api.onrender.com/api`.
5. After Vercel deploys, set Render's `CLIENT_ORIGIN` to the exact Vercel site origin, such as `https://bulkmail.vercel.app`, then redeploy the Render service.

Keep all production credentials in the hosting providers' private environment-variable settings. Do not commit `.env` files or share secrets in chat.
