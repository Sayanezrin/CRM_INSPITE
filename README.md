# Inspite People System

React + ASP.NET Core implementation of the Inspite HR portal UI shown in the supplied reference screenshots.

## Run

Set your MongoDB connection string first. Replace `<db_password>` with the real database user password from MongoDB Atlas.

```powershell
$env:MONGODB_CONNECTION_STRING="mongodb+srv://sayanezrin_db_user:<db_password>@cluster0.0cfjjgq.mongodb.net/?appName=Cluster0"
$env:MONGODB_DATABASE_NAME="inspite_people"
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

The server currently targets `.NET 10` because this machine has the .NET 10 runtime installed. The React app expects the API at `http://localhost:5018`. If the backend is not running, the UI falls back to built-in demo data so the frontend remains viewable.

## Structure

- `client`: Vite React frontend
- `server`: ASP.NET Core minimal API backend with MongoDB storage
