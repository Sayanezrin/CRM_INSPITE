# Inspite People System

React + ASP.NET Core implementation of the Inspite HR portal UI shown in the supplied reference screenshots.

## Run

Set your MongoDB connection string first. Replace `<db_password>` with the real database user password from MongoDB Atlas.

```powershell
$env:MONGODB_CONNECTION_STRING="mongodb+srv://sayanezrin_db_user:<db_password>@cluster0.0cfjjgq.mongodb.net/?appName=Cluster0"
$env:MONGODB_DATABASE_NAME="inspite_people"
$env:MONGODB_PORTAL_COLLECTION="portalState"
```

```powershell
cd D:\zoho_clone\server
dotnet run
```

If `dotnet` is not recognized in PowerShell, use:

```powershell
& "C:\Program Files\dotnet\dotnet.exe" run
```

```powershell
cd D:\zoho_clone\client
npm install
npm run dev
```

The server currently targets `.NET 10` because this machine has the .NET 10 runtime installed. The React app expects the API at `http://localhost:5018`. If MongoDB is not configured, the dashboard portal data falls back to `server/App_Data/portal-store.json` for local development.

The main dashboard data is stored in MongoDB database `inspite_people`, collection `portalState`. Replace `<db_password>` with the real MongoDB Atlas password before running the backend.

## Structure

- `client`: Vite React frontend
- `server`: ASP.NET Core minimal API backend with MongoDB storage
