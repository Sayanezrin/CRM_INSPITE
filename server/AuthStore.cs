using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Google.Apis.Auth;
using MongoDB.Bson;
using MongoDB.Driver;

namespace InspitePeople.Api;

public sealed record GoogleLoginRequest(string Credential, string SelectedRole);
public sealed record PasswordLoginRequest(string Email, string Password, string SelectedRole);
public sealed record LoginUser(string Email, string Name, string Role, string Provider, string? Picture = null);
public sealed record LoginResponse(string Token, LoginUser User);
public sealed record AppSession(string Email, string Name, string Role, long ExpiresAt);

public sealed class AuthStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _googleClientId;
    private readonly string _tokenSecret;
    private readonly IMongoCollection<BsonDocument>? _users;
    private readonly string _portalFilePath;

    public AuthStore(IConfiguration configuration, IWebHostEnvironment environment)
    {
        _googleClientId =
            configuration["Google:ClientId"]
            ?? configuration["VITE_GOOGLE_CLIENT_ID"]
            ?? Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID")
            ?? Environment.GetEnvironmentVariable("VITE_GOOGLE_CLIENT_ID")
            ?? "";

        _tokenSecret =
            configuration["Auth:TokenSecret"]
            ?? Environment.GetEnvironmentVariable("APP_AUTH_SECRET")
            ?? "local-development-token-secret-change-before-production";

        var connectionString =
            configuration["MongoDb:ConnectionString"]
            ?? configuration["MONGODB_CONNECTION_STRING"]
            ?? Environment.GetEnvironmentVariable("MONGODB_CONNECTION_STRING");

        if (!string.IsNullOrWhiteSpace(connectionString) && !connectionString.Contains("<db_password>", StringComparison.OrdinalIgnoreCase))
        {
            var databaseName =
                configuration["MongoDb:DatabaseName"]
                ?? configuration["MONGODB_DATABASE_NAME"]
                ?? Environment.GetEnvironmentVariable("MONGODB_DATABASE_NAME")
                ?? "inspite_people";

            var client = new MongoClient(connectionString);
            _users = client.GetDatabase(databaseName).GetCollection<BsonDocument>("portalUsers");
        }

        _portalFilePath = Path.Combine(environment.ContentRootPath, "App_Data", "portal-store.json");
    }

    public async Task<LoginResponse> LoginWithGoogleAsync(GoogleLoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(_googleClientId))
        {
            throw new InvalidOperationException("Google client ID is missing on the server.");
        }

        var payload = await GoogleJsonWebSignature.ValidateAsync(request.Credential, new GoogleJsonWebSignature.ValidationSettings
        {
            Audience = [_googleClientId]
        });

        var user = await GetRegisteredUserAsync(payload.Email, request.SelectedRole, payload.Name, "google", payload.Picture);
        return new LoginResponse(CreateToken(user), user);
    }

    public async Task<LoginResponse> LoginWithPasswordAsync(PasswordLoginRequest request)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var selectedRole = NormalizeRole(request.SelectedRole);
        var password = request.Password.Trim();

        if (email == "sayanezrin@gmail.com" && password == PasswordForRole(selectedRole))
        {
            var admin = new LoginUser(email, "Saya Nezrin", selectedRole, "password");
            return new LoginResponse(CreateToken(admin), admin);
        }

        var registered = await FindRegisteredUserAsync(email);
        if (registered is null)
        {
            throw new UnauthorizedAccessException("This email is not registered.");
        }

        if (registered.Value.Role != selectedRole || password != PasswordForRole(selectedRole))
        {
            throw new UnauthorizedAccessException("Invalid password login.");
        }

        var user = new LoginUser(email, registered.Value.Name, selectedRole, "password");
        return new LoginResponse(CreateToken(user), user);
    }

    public AppSession? ValidateBearerToken(string? authorizationHeader)
    {
        if (string.IsNullOrWhiteSpace(authorizationHeader) || !authorizationHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var token = authorizationHeader["Bearer ".Length..].Trim();
        var parts = token.Split('.');
        if (parts.Length != 2) return null;

        var expectedSignature = Sign(parts[0]);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expectedSignature), Encoding.UTF8.GetBytes(parts[1])))
        {
            return null;
        }

        var json = Encoding.UTF8.GetString(Base64UrlDecode(parts[0]));
        var session = JsonSerializer.Deserialize<AppSession>(json, JsonOptions);
        if (session is null || session.ExpiresAt <= DateTimeOffset.UtcNow.ToUnixTimeSeconds())
        {
            return null;
        }

        return session;
    }

    public bool IsAllowed(AppSession session, PathString path, string method)
    {
        if (session.Role == "admin") return true;

        var value = path.Value ?? "";
        if (session.Role == "hr")
        {
            return !value.StartsWith("/api/candidates", StringComparison.OrdinalIgnoreCase) || method != "DELETE";
        }

        if (session.Role == "employee")
        {
            return value.StartsWith("/api/portal", StringComparison.OrdinalIgnoreCase)
                || value.StartsWith("/api/attendance", StringComparison.OrdinalIgnoreCase)
                || value.StartsWith("/api/tasks", StringComparison.OrdinalIgnoreCase);
        }

        return false;
    }

    private async Task<LoginUser> GetRegisteredUserAsync(string email, string selectedRole, string name, string provider, string? picture)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();
        var normalizedRole = NormalizeRole(selectedRole);

        var registered = await FindRegisteredUserAsync(normalizedEmail);
        if (registered is null)
        {
            throw new UnauthorizedAccessException("This Google account is not registered for dashboard access.");
        }

        var role = normalizedEmail == "sayanezrin@gmail.com" ? normalizedRole : registered.Value.Role;
        if (role != normalizedRole)
        {
            throw new UnauthorizedAccessException($"{normalizedEmail} is registered as {registered.Value.Role}.");
        }

        return new LoginUser(normalizedEmail, string.IsNullOrWhiteSpace(registered.Value.Name) ? name : registered.Value.Name, role, provider, picture);
    }

    private async Task<(string Name, string Role)?> FindRegisteredUserAsync(string email)
    {
        if (email == "sayanezrin@gmail.com") return ("Saya Nezrin", "admin");
        if (email == "hr@inspite.local") return ("HR / Accountant", "hr");

        if (_users is not null)
        {
            var user = await _users.Find(Builders<BsonDocument>.Filter.Eq("email", email)).FirstOrDefaultAsync();
            if (user is not null)
            {
                return (user.GetValue("name", "").AsString, NormalizeRole(user.GetValue("role", "employee").AsString));
            }
        }

        if (!File.Exists(_portalFilePath)) return null;

        await using var stream = File.OpenRead(_portalFilePath);
        using var document = await JsonDocument.ParseAsync(stream);
        if (document.RootElement.TryGetProperty("logins", out var logins))
        {
            var loginUser = FindUserInArray(logins, email);
            if (loginUser is not null) return loginUser;
        }

        if (!document.RootElement.TryGetProperty("employees", out var employees)) return null;

        return FindUserInArray(employees, email);
    }

    private static (string Name, string Role)? FindUserInArray(JsonElement users, string email)
    {
        foreach (var user in users.EnumerateArray())
        {
            var userEmail = user.TryGetProperty("email", out var emailValue) ? emailValue.GetString() : "";
            if (!string.Equals(userEmail, email, StringComparison.OrdinalIgnoreCase)) continue;

            var userName = user.TryGetProperty("name", out var nameValue) ? nameValue.GetString() ?? "" : "";
            var userRole = user.TryGetProperty("accessRole", out var roleValue) ? roleValue.GetString() ?? "employee" : "employee";
            return (userName, NormalizeRole(userRole));
        }

        return null;
    }

    private string CreateToken(LoginUser user)
    {
        var session = new AppSession(user.Email, user.Name, user.Role, DateTimeOffset.UtcNow.AddHours(8).ToUnixTimeSeconds());
        var payload = Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(session, JsonOptions));
        return $"{payload}.{Sign(payload)}";
    }

    private string Sign(string payload)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_tokenSecret));
        return Base64UrlEncode(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload)));
    }

    private static string NormalizeRole(string? role) =>
        role?.Trim().ToLowerInvariant() switch
        {
            "admin" => "admin",
            "hr" => "hr",
            "accountant" => "hr",
            "hr / accountant" => "hr",
            _ => "employee"
        };

    private static string PasswordForRole(string role) =>
        role switch
        {
            "admin" => "admin123",
            "hr" => "hr123",
            _ => "emp123"
        };

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
        return Convert.FromBase64String(base64);
    }
}
