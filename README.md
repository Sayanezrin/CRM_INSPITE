# Inspite People System

React + Node.js implementation of the Inspite HR portal UI shown in the supplied reference screenshots.

## Run

Set your MongoDB connection string first. Replace `<db_password>` with the real database user password from MongoDB Atlas.

```powershell
$env:MONGODB_CONNECTION_STRING="mongodb+srv://sayanezrin_db_user:<db_password>@cluster0.0cfjjgq.mongodb.net/?appName=Cluster0"
$env:MONGODB_DATABASE_NAME="inspite_people"
$env:MONGODB_PORTAL_COLLECTION="portalState"
```

```powershell
cd D:\zoho_clone\server
npm install
npm start
```

```powershell
cd D:\zoho_clone\client
npm install
npm run dev
```

In local development, the React app expects the API at `http://localhost:5018`. In production on Vercel, the React app calls the same deployment through relative `/api` routes. If MongoDB is not configured, the dashboard portal data falls back to `server/App_Data/portal-store.json` for local development.

The main dashboard data is stored in MongoDB database `inspite_people`, collection `portalState`. Replace `<db_password>` with the real MongoDB Atlas password before running the backend.

## Vercel

This repo is configured as one Vercel app:

- React builds to `dist`
- Node.js API routes are served from `api/[...path].js`
- Browser requests to `/api/*` run the Express API on Vercel serverless functions
- All other routes serve the React app

Set these Vercel environment variables:

```text
MONGODB_CONNECTION_STRING=...
MONGODB_DATABASE_NAME=inspite_people
MONGODB_PORTAL_COLLECTION=portalState
APP_AUTH_SECRET=use-a-long-random-secret
CORS_ORIGINS=https://your-vercel-domain.vercel.app
```

`VITE_API_URL` is not required on Vercel because the frontend uses same-origin `/api` routes by default.

## Structure

- `client`: Vite React frontend
- `api`: Vercel serverless API entrypoint
- `server`: Node.js Express API source with MongoDB storage
