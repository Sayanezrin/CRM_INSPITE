using MongoDB.Bson;
using MongoDB.Driver;

namespace InspitePeople.Api;

public sealed class PeopleStore
{
    private readonly IMongoCollection<TimeLog> _timeLogs;
    private readonly IMongoCollection<EmployeeTask> _tasks;
    private readonly IMongoCollection<BsonDocument> _candidates;
    private readonly IMongoCollection<BsonDocument> _attendance;

    public PeopleStore(IConfiguration configuration)
    {
        var connectionString =
            configuration["MongoDb:ConnectionString"]
            ?? configuration["MONGODB_CONNECTION_STRING"]
            ?? Environment.GetEnvironmentVariable("MONGODB_CONNECTION_STRING");

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("MongoDB connection string is missing. Set MongoDb:ConnectionString or MONGODB_CONNECTION_STRING.");
        }

        var databaseName =
            configuration["MongoDb:DatabaseName"]
            ?? configuration["MONGODB_DATABASE_NAME"]
            ?? Environment.GetEnvironmentVariable("MONGODB_DATABASE_NAME")
            ?? "inspite_people";

        var client = new MongoClient(connectionString);
        var database = client.GetDatabase(databaseName);

        _timeLogs = database.GetCollection<TimeLog>("timeLogs");
        _tasks = database.GetCollection<EmployeeTask>("tasks");
        _candidates = database.GetCollection<BsonDocument>("Candidates");
        _attendance = database.GetCollection<BsonDocument>("Attendance");
    }

    public Employee Employee { get; } = new(1, "SAYA NEZRIN", "1", "Yet to check-in", "General", "9:00 AM-6:00 PM", "21-Jun-2026 - 27-Jun-2026");

    public IReadOnlyList<ModuleItem> Modules { get; } =
    [
        new("home", "Home", "home", "main"),
        new("onboarding", "Onboarding", "handshake", "main"),
        new("leave", "Leave Tracker", "umbrella", "main"),
        new("attendance", "Attendance", "calendarCheck", "main"),
        new("time", "Time Tracker", "stopwatch", "main"),
        new("performance", "Performance", "trophy", "main"),
        new("files", "Files", "folder", "main"),
        new("hrletters", "HR Letters", "star", "more"),
        new("engagement", "Employee E...", "spark", "more"),
        new("travel", "Travel", "star", "more"),
        new("tasks", "Tasks", "briefcase", "more"),
        new("compensation", "Compensation", "briefcase", "more"),
        new("general", "General", "building", "more"),
        new("okr", "OKR", "target", "more"),
        new("operations", "Operations", "settings", "footer"),
        new("reports", "Reports", "chart", "footer")
    ];

    public IReadOnlyDictionary<string, IReadOnlyList<string>> Lists { get; } = new Dictionary<string, IReadOnlyList<string>>
    {
        ["onboarding"] = ["First name", "Last name", "Email ID", "Official Email", "Onboarding Status", "Department", "Source of Hire", "PAN card number", "UAN number"],
        ["hrletters"] = ["EmployeeID", "Date of request", "Is there any chan...", "Reason for request", "Enter the Reason for request (If others is cho...", "New Present Address"],
        ["travel"] = ["Employee ID", "Travel ID", "Employee Dep...", "Place of visit", "Expected date of departure", "Expected date of arrival", "Purpose of visit", "Expected duration in days"],
        ["general"] = ["Employee ID", "Interviewer", "Separation date", "Reason for leaving", "Working for this organization again", "Think the organization do to improve staff w...", "What did you"]
    };

    public async Task<IReadOnlyList<Candidate>> GetCandidatesAsync()
    {
        var documents = await _candidates.Find(Builders<BsonDocument>.Filter.Empty).SortByDescending(document => document["createdAt"]).ToListAsync();
        return documents.Select(ToCandidate).ToList();
    }

    public async Task<IReadOnlyList<EmployeeTask>> GetTasksAsync() =>
        await _tasks.Find(Builders<EmployeeTask>.Filter.Empty).SortByDescending(task => task.CreatedAt).ToListAsync();

    public async Task<TimeSummary> GetTimeSummaryAsync()
    {
        var logs = await _timeLogs.Find(Builders<TimeLog>.Filter.Empty).SortByDescending(log => log.CreatedAt).ToListAsync();
        return new TimeSummary(
            logs.Sum(log => log.Hours),
            logs.Where(log => log.Submitted).Sum(log => log.Hours),
            logs.Where(log => !log.Submitted).Sum(log => log.Hours),
            logs);
    }

    public async Task<object> GetBootstrapAsync() => new
    {
        employee = Employee,
        modules = Modules,
        lists = Lists,
        candidates = await GetCandidatesAsync(),
        timeSummary = await GetTimeSummaryAsync(),
        tasks = await GetTasksAsync()
    };

    public async Task<TimeLog> AddTimeLogAsync(TimeLogRequest request)
    {
        var log = new TimeLog(
            await GetNextIdAsync(_timeLogs),
            request.Project,
            request.Job,
            request.Notes,
            request.Billable,
            request.Hours,
            false,
            DateTimeOffset.UtcNow);
        await _timeLogs.InsertOneAsync(log);
        return log;
    }

    public async Task<EmployeeTask> AddTaskAsync(TaskRequest request)
    {
        var task = new EmployeeTask(
            await GetNextIdAsync(_tasks),
            request.Title,
            request.Description,
            "Open",
            DateTimeOffset.UtcNow);
        await _tasks.InsertOneAsync(task);
        return task;
    }

    public async Task<Candidate> AddCandidateAsync(CandidateRequest request)
    {
        var candidate = new Candidate(
            await GetNextDocumentIdAsync(_candidates),
            request.FirstName,
            request.LastName,
            request.Email,
            request.OfficialEmail,
            request.Status,
            request.Department,
            request.SourceOfHire,
            request.Pan,
            request.Uan,
            request.Phone,
            request.JoiningDate,
            DateTimeOffset.UtcNow);
        await _candidates.InsertOneAsync(new BsonDocument
        {
            ["id"] = candidate.Id,
            ["firstName"] = candidate.FirstName,
            ["lastName"] = candidate.LastName,
            ["email"] = candidate.Email,
            ["officialEmail"] = candidate.OfficialEmail,
            ["status"] = candidate.Status,
            ["department"] = candidate.Department,
            ["sourceOfHire"] = candidate.SourceOfHire,
            ["pan"] = candidate.Pan,
            ["uan"] = candidate.Uan,
            ["phone"] = candidate.Phone,
            ["joiningDate"] = candidate.JoiningDate,
            ["createdAt"] = candidate.CreatedAt.UtcDateTime
        });
        return candidate;
    }

    public async Task<bool> DeleteCandidateAsync(int id)
    {
        var result = await _candidates.DeleteOneAsync(Builders<BsonDocument>.Filter.Eq("id", id));
        return result.DeletedCount > 0;
    }

    public async Task<AttendanceRecord?> GetTodayAttendanceAsync(string userEmail)
    {
        var today = DateTimeOffset.Now.ToString("yyyy-MM-dd");
        var filter = Builders<BsonDocument>.Filter.And(
            Builders<BsonDocument>.Filter.Eq("userEmail", userEmail),
            Builders<BsonDocument>.Filter.Eq("date", today));
        var document = await _attendance.Find(filter).SortByDescending(record => record["id"]).FirstOrDefaultAsync();
        return document is null ? null : ToAttendanceRecord(document);
    }

    public async Task<IReadOnlyList<AttendanceRecord>> GetAttendanceAsync(string userEmail)
    {
        var documents = await _attendance
            .Find(Builders<BsonDocument>.Filter.Eq("userEmail", userEmail))
            .SortByDescending(record => record["date"])
            .ThenByDescending(record => record["id"])
            .ToListAsync();
        return documents.Select(ToAttendanceRecord).ToList();
    }

    public async Task<AttendanceRecord> CheckInAsync(AttendanceCheckInRequest request)
    {
        var userEmail = string.IsNullOrWhiteSpace(request.UserEmail) ? "unknown@inspite.local" : request.UserEmail;
        var today = DateTimeOffset.Now.ToString("yyyy-MM-dd");
        var todayFilter = Builders<BsonDocument>.Filter.And(
            Builders<BsonDocument>.Filter.Eq("userEmail", userEmail),
            Builders<BsonDocument>.Filter.Eq("date", today));
        var existingDocument = await _attendance
            .Find(todayFilter)
            .SortByDescending(record => record["id"])
            .FirstOrDefaultAsync();
        var existing = existingDocument is null ? null : ToAttendanceRecord(existingDocument);

        if (existing is not null && existing.CheckOutAt is null)
        {
            return existing;
        }

        var record = new AttendanceRecord(
            await GetNextDocumentIdAsync(_attendance),
            request.EmployeeId,
            userEmail,
            string.IsNullOrWhiteSpace(request.UserName) ? userEmail : request.UserName,
            today,
            DateTimeOffset.Now,
            null,
            existing?.WorkedSeconds ?? 0,
            "In");

        await _attendance.InsertOneAsync(ToAttendanceDocument(record));
        return record;
    }

    public async Task<AttendanceRecord?> CheckOutAsync(AttendanceCheckOutRequest request)
    {
        var today = DateTimeOffset.Now.ToString("yyyy-MM-dd");
        var openFilter = Builders<BsonDocument>.Filter.And(
            Builders<BsonDocument>.Filter.Eq("userEmail", request.UserEmail),
            Builders<BsonDocument>.Filter.Eq("date", today),
            Builders<BsonDocument>.Filter.Eq("checkOutAt", BsonNull.Value));
        var document = await _attendance
            .Find(openFilter)
            .SortByDescending(item => item["id"])
            .FirstOrDefaultAsync();
        var record = document is null ? null : ToAttendanceRecord(document);

        if (record is null)
        {
            return await GetTodayAttendanceAsync(request.UserEmail);
        }

        var checkOutAt = DateTimeOffset.Now;
        var workedSeconds = record.WorkedSeconds + Math.Max(0, (int)Math.Floor((checkOutAt - record.CheckInAt).TotalSeconds));
        var updated = record with
        {
            CheckOutAt = checkOutAt,
            WorkedSeconds = workedSeconds,
            Status = "Checked out"
        };

        await _attendance.ReplaceOneAsync(Builders<BsonDocument>.Filter.Eq("id", record.Id), ToAttendanceDocument(updated));
        return updated;
    }

    private static async Task<int> GetNextIdAsync<T>(IMongoCollection<T> collection) where T : IHasIntId
    {
        var latest = await collection.Find(Builders<T>.Filter.Empty).SortByDescending(item => item.Id).Limit(1).FirstOrDefaultAsync();
        return (latest?.Id ?? 0) + 1;
    }

    private static async Task<int> GetNextDocumentIdAsync(IMongoCollection<BsonDocument> collection)
    {
        var latest = await collection.Find(Builders<BsonDocument>.Filter.Exists("id")).SortByDescending(item => item["id"]).Limit(1).FirstOrDefaultAsync();
        return latest is null ? 1 : GetInt(latest, "id") + 1;
    }

    private static Candidate ToCandidate(BsonDocument document) => new(
        GetInt(document, "id"),
        GetString(document, "firstName"),
        GetString(document, "lastName"),
        GetString(document, "email"),
        GetString(document, "officialEmail"),
        GetString(document, "status", "Added"),
        GetString(document, "department"),
        GetString(document, "sourceOfHire"),
        GetString(document, "pan"),
        GetString(document, "uan"),
        GetString(document, "phone"),
        GetString(document, "joiningDate"),
        GetDate(document, "createdAt"));

    private static AttendanceRecord ToAttendanceRecord(BsonDocument document) => new(
        GetInt(document, "id"),
        GetInt(document, "employeeId"),
        GetString(document, "userEmail"),
        GetString(document, "userName"),
        GetString(document, "date"),
        GetDate(document, "checkInAt"),
        document.TryGetValue("checkOutAt", out var checkOutAt) && !checkOutAt.IsBsonNull ? GetDate(document, "checkOutAt") : null,
        GetInt(document, "workedSeconds"),
        GetString(document, "status"));

    private static BsonDocument ToAttendanceDocument(AttendanceRecord record) => new()
    {
        ["id"] = record.Id,
        ["employeeId"] = record.EmployeeId,
        ["userEmail"] = record.UserEmail,
        ["userName"] = record.UserName,
        ["date"] = record.Date,
        ["checkInAt"] = record.CheckInAt.UtcDateTime,
        ["checkOutAt"] = record.CheckOutAt.HasValue ? BsonValue.Create(record.CheckOutAt.Value.UtcDateTime) : BsonNull.Value,
        ["workedSeconds"] = record.WorkedSeconds,
        ["status"] = record.Status
    };

    private static int GetInt(BsonDocument document, string name) =>
        document.TryGetValue(name, out var value) && value.IsNumeric ? value.ToInt32() : 0;

    private static string GetString(BsonDocument document, string name, string fallback = "-") =>
        document.TryGetValue(name, out var value) && !value.IsBsonNull ? value.ToString() : fallback;

    private static DateTimeOffset GetDate(BsonDocument document, string name) =>
        document.TryGetValue(name, out var value) && value.IsValidDateTime
            ? new DateTimeOffset(value.ToUniversalTime())
            : DateTimeOffset.UtcNow;
}

public interface IHasIntId
{
    int Id { get; }
}

public sealed record Employee(int Id, string Name, string EmployeeCode, string Status, string Shift, string ShiftHours, string WeekRange);
public sealed record ModuleItem(string Id, string Label, string Icon, string Group);
public sealed record TimeSummary(decimal TotalHours, decimal SubmittedHours, decimal NotSubmittedHours, IReadOnlyList<TimeLog> Logs);
public sealed record TimeLog(int Id, string Project, string Job, string Notes, bool Billable, decimal Hours, bool Submitted, DateTimeOffset CreatedAt) : IHasIntId;
public sealed record TimeLogRequest(string Project, string Job, string Notes, bool Billable, decimal Hours);
public sealed record EmployeeTask(int Id, string Title, string Description, string Status, DateTimeOffset CreatedAt) : IHasIntId;
public sealed record TaskRequest(string Title, string Description);
public sealed record Candidate(int Id, string FirstName, string LastName, string Email, string OfficialEmail, string Status, string Department, string SourceOfHire, string Pan, string Uan, string Phone, string JoiningDate, DateTimeOffset CreatedAt) : IHasIntId;
public sealed record CandidateRequest(string FirstName, string LastName, string Email, string OfficialEmail, string Status, string Department, string SourceOfHire, string Pan, string Uan, string Phone, string JoiningDate);
public sealed record AttendanceRecord(int Id, int EmployeeId, string UserEmail, string UserName, string Date, DateTimeOffset CheckInAt, DateTimeOffset? CheckOutAt, int WorkedSeconds, string Status) : IHasIntId;
public sealed record AttendanceCheckInRequest(int EmployeeId, string UserEmail, string UserName);
public sealed record AttendanceCheckOutRequest(string UserEmail);
