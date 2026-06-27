using InspitePeople.Api;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins("http://127.0.0.1:5174", "http://localhost:5174")
            .AllowAnyHeader()
            .AllowAnyMethod());
});
builder.Services.AddSingleton<PeopleStore>();

var app = builder.Build();

app.UseCors();

app.MapGet("/", () => Results.Redirect("/api/bootstrap"));
app.MapGet("/api/bootstrap", async (PeopleStore store) => await store.GetBootstrapAsync());
app.MapGet("/api/employee", (PeopleStore store) => store.Employee);
app.MapGet("/api/modules", (PeopleStore store) => store.Modules);
app.MapGet("/api/lists/{module}", (PeopleStore store, string module) =>
    store.Lists.TryGetValue(module, out var columns)
        ? (IResult)Results.Ok(columns)
        : Results.NotFound());
app.MapGet("/api/time/summary", async (PeopleStore store) => await store.GetTimeSummaryAsync());
app.MapPost("/api/time/logs", async (PeopleStore store, TimeLogRequest request) =>
{
    var log = await store.AddTimeLogAsync(request);
    return Results.Created($"/api/time/logs/{log.Id}", log);
});
app.MapGet("/api/candidates", async (PeopleStore store) => await store.GetCandidatesAsync());
app.MapPost("/api/candidates", async (PeopleStore store, CandidateRequest request) =>
{
    var candidate = await store.AddCandidateAsync(request);
    return Results.Created($"/api/candidates/{candidate.Id}", candidate);
});
app.MapDelete("/api/candidates/{id:int}", async (PeopleStore store, int id) =>
    await store.DeleteCandidateAsync(id) ? Results.NoContent() : Results.NotFound());
app.MapGet("/api/attendance/today", async (PeopleStore store, string userEmail) =>
    await store.GetTodayAttendanceAsync(userEmail) is { } attendance
        ? Results.Ok(attendance)
        : Results.Ok(null));
app.MapGet("/api/attendance", async (PeopleStore store, string userEmail) =>
    await store.GetAttendanceAsync(userEmail));
app.MapPost("/api/attendance/check-in", async (PeopleStore store, AttendanceCheckInRequest request) =>
{
    var attendance = await store.CheckInAsync(request);
    return Results.Created($"/api/attendance/{attendance.Id}", attendance);
});
app.MapPost("/api/attendance/check-out", async (PeopleStore store, AttendanceCheckOutRequest request) =>
    await store.CheckOutAsync(request) is { } attendance
        ? Results.Ok(attendance)
        : Results.NotFound());
app.MapGet("/api/tasks", async (PeopleStore store) => await store.GetTasksAsync());
app.MapPost("/api/tasks", async (PeopleStore store, TaskRequest request) =>
{
    var task = await store.AddTaskAsync(request);
    return Results.Created($"/api/tasks/{task.Id}", task);
});

app.Run("http://localhost:5018");
