using System.Text.Json;
using MongoDB.Bson;
using MongoDB.Driver;

namespace InspitePeople.Api;

public sealed class PortalStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly string _filePath;
    private readonly IMongoCollection<BsonDocument>? _portalState;
    private readonly IMongoCollection<BsonDocument>? _portalUsers;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public PortalStore(IWebHostEnvironment environment, IConfiguration configuration)
    {
        var directory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(directory);
        _filePath = Path.Combine(directory, "portal-store.json");

        var connectionString =
            configuration["MongoDb:ConnectionString"]
            ?? configuration["MONGODB_CONNECTION_STRING"]
            ?? Environment.GetEnvironmentVariable("MONGODB_CONNECTION_STRING");

        if (string.IsNullOrWhiteSpace(connectionString) || connectionString.Contains("<db_password>", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var databaseName =
            configuration["MongoDb:DatabaseName"]
            ?? configuration["MONGODB_DATABASE_NAME"]
            ?? Environment.GetEnvironmentVariable("MONGODB_DATABASE_NAME")
            ?? "inspite_people";

        var collectionName =
            configuration["MongoDb:PortalCollectionName"]
            ?? configuration["MONGODB_PORTAL_COLLECTION"]
            ?? Environment.GetEnvironmentVariable("MONGODB_PORTAL_COLLECTION")
            ?? "portalState";

        var client = new MongoClient(connectionString);
        var database = client.GetDatabase(databaseName);
        _portalState = database.GetCollection<BsonDocument>(collectionName);
        _portalUsers = database.GetCollection<BsonDocument>("portalUsers");
    }

    public async Task<IResult> GetAsync()
    {
        if (_portalState is not null)
        {
            var document = await _portalState.Find(Builders<BsonDocument>.Filter.Eq("_id", "main")).FirstOrDefaultAsync();
            return document is null
                ? Results.Ok(null)
                : Results.Text(document.GetValue("dataJson", "{}").AsString, "application/json");
        }

        await _gate.WaitAsync();
        try
        {
            if (!File.Exists(_filePath))
            {
                return Results.Ok(null);
            }

            await using var stream = File.OpenRead(_filePath);
            var document = await JsonDocument.ParseAsync(stream);
            return Results.Json(document.RootElement.Clone(), JsonOptions);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IResult> SaveAsync(JsonElement payload)
    {
        if (_portalState is not null)
        {
            await SyncPortalUsersAsync(payload);
            var update = Builders<BsonDocument>.Update
                .Set("dataJson", payload.GetRawText())
                .Set("savedAt", DateTimeOffset.UtcNow);
            await _portalState.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("_id", "main"),
                update,
                new UpdateOptions { IsUpsert = true });
            return Results.Ok(new { saved = true, storage = "mongodb", savedAt = DateTimeOffset.UtcNow });
        }

        await _gate.WaitAsync();
        try
        {
            await using var stream = File.Create(_filePath);
            await JsonSerializer.SerializeAsync(stream, payload, JsonOptions);
            return Results.Ok(new { saved = true, storage = "json", savedAt = DateTimeOffset.UtcNow });
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task SyncPortalUsersAsync(JsonElement payload)
    {
        if (_portalUsers is null)
        {
            return;
        }

        if (payload.TryGetProperty("logins", out var logins))
        {
            foreach (var login in logins.EnumerateArray())
            {
                await UpsertPortalUserAsync(login);
            }
        }

        if (!payload.TryGetProperty("employees", out var employees))
        {
            return;
        }

        foreach (var employee in employees.EnumerateArray())
        {
            await UpsertPortalUserAsync(employee);
        }
    }

    private async Task UpsertPortalUserAsync(JsonElement user)
    {
        if (_portalUsers is null) return;

        var email = user.TryGetProperty("email", out var emailValue) ? emailValue.GetString()?.Trim().ToLowerInvariant() : "";
        if (string.IsNullOrWhiteSpace(email)) return;

        var name = user.TryGetProperty("name", out var nameValue) ? nameValue.GetString()?.Trim() ?? "" : "";
        var role = user.TryGetProperty("accessRole", out var roleValue) ? roleValue.GetString() ?? "employee" : "employee";
        role = role.Trim().ToLowerInvariant() switch
        {
            "admin" => "admin",
            "hr" => "hr",
            "accountant" => "hr",
            "hr / accountant" => "hr",
            _ => "employee"
        };

        var update = Builders<BsonDocument>.Update
            .Set("email", email)
            .Set("name", name)
            .Set("role", role)
            .Set("status", user.TryGetProperty("status", out var statusValue) ? statusValue.GetString() ?? "Active" : "Active")
            .Set("updatedAt", DateTimeOffset.UtcNow);

        await _portalUsers.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("email", email),
            update,
            new UpdateOptions { IsUpsert = true });
    }
}
