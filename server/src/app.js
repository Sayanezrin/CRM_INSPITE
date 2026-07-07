import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { OAuth2Client } from "google-auth-library";
import helmet from "helmet";
import { getModels, getModelsOrNull, isMongoConfigured } from "./database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
const appDataDir = path.join(serverRoot, "App_Data");
const portalFilePath = path.join(appDataDir, "portal-store.json");

const roles = {
  admin: { title: "Admin", email: "sayanezrin@gmail.com", password: "admin123" },
  hr: { title: "HR / Accountant", email: "hr@inspite.local" },
  employee: { title: "Employee", email: "employee@inspite.local" }
};

const employee = {
  id: 1,
  name: "SAYA NEZRIN",
  employeeCode: "1",
  status: "Yet to check-in",
  shift: "General",
  shiftHours: "9:00 AM-6:00 PM",
  weekRange: "21-Jun-2026 - 27-Jun-2026"
};

const modules = [
  { id: "home", label: "Home", icon: "home", group: "main" },
  { id: "onboarding", label: "Onboarding", icon: "handshake", group: "main" },
  { id: "leave", label: "Leave Tracker", icon: "umbrella", group: "main" },
  { id: "attendance", label: "Attendance", icon: "calendarCheck", group: "main" },
  { id: "time", label: "Time Tracker", icon: "stopwatch", group: "main" },
  { id: "performance", label: "Performance", icon: "trophy", group: "main" },
  { id: "files", label: "Files", icon: "folder", group: "main" },
  { id: "hrletters", label: "HR Letters", icon: "star", group: "more" },
  { id: "engagement", label: "Employee E...", icon: "spark", group: "more" },
  { id: "travel", label: "Travel", icon: "star", group: "more" },
  { id: "tasks", label: "Tasks", icon: "briefcase", group: "more" },
  { id: "compensation", label: "Compensation", icon: "briefcase", group: "more" },
  { id: "general", label: "General", icon: "building", group: "more" },
  { id: "okr", label: "OKR", icon: "target", group: "more" },
  { id: "operations", label: "Operations", icon: "settings", group: "footer" },
  { id: "reports", label: "Reports", icon: "chart", group: "footer" }
];

const lists = {
  onboarding: ["First name", "Last name", "Email ID", "Official Email", "Onboarding Status", "Department", "Source of Hire", "PAN card number", "UAN number"],
  hrletters: ["EmployeeID", "Date of request", "Is there any chan...", "Reason for request", "Enter the Reason for request (If others is cho...", "New Present Address"],
  travel: ["Employee ID", "Travel ID", "Employee Dep...", "Place of visit", "Expected date of departure", "Expected date of arrival", "Purpose of visit", "Expected duration in days"],
  general: ["Employee ID", "Interviewer", "Separation date", "Reason for leaving", "Working for this organization again", "Think the organization do to improve staff w...", "What did you"]
};

const tokenSecret = process.env.APP_AUTH_SECRET || "local-development-token-secret-change-before-production";
const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
const googleClient = new OAuth2Client(googleClientId || undefined);
function normalizeRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (value === "accountant" || value === "hr / accountant") return "hr";
  if (value === "admin" || value === "hr") return value;
  return "employee";
}

function getFirstName(name, email = "") {
  const nameFirst = String(name || "").trim().split(/\s+/).find(Boolean);
  const emailFirst = String(email || "").trim().split("@")[0];
  const rawFirst = nameFirst || emailFirst || "Employee";
  return rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();
}

function initialPasswordForUser(user) {
  return `${getFirstName(user?.name, user?.email)}@123`;
}

function hashPassword(password) {
  return crypto.createHmac("sha256", tokenSecret).update(String(password || "")).digest("hex");
}

function verifyUserPassword(password, user) {
  if (user?.passwordHash) return hashPassword(password) === user.passwordHash;
  return String(password || "") === initialPasswordForUser(user);
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function createToken(user) {
  const session = {
    email: user.email,
    name: user.name,
    role: user.role,
    expiresAt: Math.floor(Date.now() / 1000) + 8 * 60 * 60
  };
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = crypto.createHmac("sha256", tokenSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function validateBearerToken(header) {
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = crypto.createHmac("sha256", tokenSecret).update(payload).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    const session = JSON.parse(base64UrlDecode(payload));
    if (!session?.expiresAt || session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

function isAllowed(session, pathValue, method) {
  if (session.role === "admin") return true;
  if (session.role === "hr") return !pathValue.startsWith("/api/candidates") || method !== "DELETE";
  if (session.role === "employee") {
    return pathValue.startsWith("/api/portal")
      || pathValue.startsWith("/api/attendance")
      || pathValue.startsWith("/api/tasks");
  }
  return false;
}

async function readPortalFile() {
  try {
    const raw = await fs.readFile(portalFilePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writePortalFile(payload) {
  await fs.mkdir(appDataDir, { recursive: true });
  await fs.writeFile(portalFilePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function getPortalState() {
  const models = await getModelsOrNull();
  if (models) {
    const document = await models.PortalState.findOne({ _id: "main" }).lean();
    return document?.dataJson ? JSON.parse(document.dataJson) : null;
  }
  return readPortalFile();
}

async function syncPortalUsers(models, payload) {
  if (!models) return;
  const users = [...(payload.logins || []), ...(payload.employees || [])];
  const activeEmails = [];
  for (const user of users) {
    const email = user.email?.trim().toLowerCase();
    if (!email) continue;
    activeEmails.push(email);
    await models.PortalUser.updateOne(
      { email },
      {
        $set: {
          email,
          name: user.name?.trim() || "",
          role: normalizeRole(user.accessRole),
          status: user.status || "Active",
          updatedAt: new Date()
        },
        $setOnInsert: {
          mustChangePassword: true
        }
      },
      { upsert: true }
    );
  }
  await models.PortalUser.deleteMany({
    email: {
      $nin: activeEmails
    }
  });
}

async function savePortalState(payload) {
  const models = await getModelsOrNull();
  if (models) {
    await syncPortalUsers(models, payload);
    await models.PortalState.updateOne(
      { _id: "main" },
      { $set: { dataJson: JSON.stringify(payload), savedAt: new Date() } },
      { upsert: true }
    );
    return { saved: true, storage: "mongodb", savedAt: new Date().toISOString() };
  }
  await writePortalFile(payload);
  return { saved: true, storage: "json", savedAt: new Date().toISOString() };
}

function findUserInPortalPayload(payload, email) {
  const users = [...(payload?.logins || []), ...(payload?.employees || [])];
  const user = users.find((item) => item.email?.trim().toLowerCase() === email);
  if (!user) return null;
  return { email, name: user.name || "", role: normalizeRole(user.accessRole), mustChangePassword: true };
}

async function findRegisteredUser(email) {
  if (email === roles.hr.email) return { email, name: roles.hr.title, role: "hr", mustChangePassword: true };

  const models = await getModelsOrNull();
  if (models) {
    const user = await models.PortalUser.findOne({ email }).lean();
    if (user) {
      return {
        email,
        name: user.name || "",
        role: normalizeRole(user.role),
        passwordHash: user.passwordHash || "",
        mustChangePassword: user.mustChangePassword !== false
      };
    }
  }

  if (email === roles.admin.email) return { email, name: "Saya Nezrin", role: "admin", passwordHash: "", mustChangePassword: true };
  return findUserInPortalPayload(await readPortalFile(), email);
}

async function getNextId(model) {
  const latest = await model.findOne({ id: { $exists: true } }).sort({ id: -1 }).lean();
  return Number(latest?.id || 0) + 1;
}

async function getPeopleModels() {
  const models = await getModels();
  if (!models) throw new Error("MongoDB connection string is missing. Set MONGODB_URI or MONGODB_CONNECTION_STRING.");
  return models;
}

async function getTimeSummary() {
  const { TimeLog } = await getPeopleModels();
  const logs = await TimeLog.find({}).sort({ createdAt: -1 }).lean();
  return {
    totalHours: logs.reduce((sum, log) => sum + Number(log.hours || 0), 0),
    submittedHours: logs.filter((log) => log.submitted).reduce((sum, log) => sum + Number(log.hours || 0), 0),
    notSubmittedHours: logs.filter((log) => !log.submitted).reduce((sum, log) => sum + Number(log.hours || 0), 0),
    logs
  };
}

function toDateString() {
  return new Date().toISOString().slice(0, 10);
}

const app = express();
const corsOrigins = (process.env.CORS_ORIGINS || "http://127.0.0.1:5174,http://localhost:5174")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isLocalDevOrigin(origin) {
  return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin || "");
}

function isVercelOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "https:" && hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin) || isLocalDevOrigin(origin) || isVercelOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin is not allowed by CORS."));
  },
  credentials: false
}));
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  const isPublicApi = req.path.startsWith("/api/auth") || req.path === "/api/bootstrap" || req.path.startsWith("/api/health") || req.path === "/api/ping";
  if (!req.path.startsWith("/api") || isPublicApi) return next();

  const session = validateBearerToken(req.get("authorization"));
  if (!session) return res.status(401).json({ error: "Authentication required." });
  if (!isAllowed(session, req.path, req.method)) return res.status(403).json({ error: "This role cannot access this API route." });

  req.session = session;
  next();
});

app.get("/", (_req, res) => res.json({ ok: true, service: "InspitePeople.Api.Node" }));
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    mongoConfigured: isMongoConfigured()
  });
});

app.get("/api/health/mongodb", async (_req, res) => {
  const models = await getModelsOrNull();
  res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    storage: models ? "mongodb" : "fallback"
  });
});

app.get("/api/ping", async (_req, res) => {
  const checkedAt = new Date().toISOString();
  const models = await getModelsOrNull();
  if (!models) {
    return res.json({
      ok: true,
      checkedAt,
      storage: "fallback",
      warmed: false
    });
  }

  await models.PortalState.findOne({ _id: "main" }).select("_id").lean();
  res.json({
    ok: true,
    checkedAt,
    storage: "mongodb",
    warmed: true
  });
});

app.post("/api/auth/password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const selectedRole = normalizeRole(req.body.selectedRole);
  const password = String(req.body.password || "").trim();

  const registered = await findRegisteredUser(email);

  if (email === roles.admin.email && selectedRole === "admin" && !registered?.passwordHash && password === roles.admin.password) {
    const user = { email, name: "Saya Nezrin", role: "admin", provider: "password", mustChangePassword: true };
    return res.json({ token: createToken(user), user });
  }

  if (!registered || registered.role !== selectedRole || !verifyUserPassword(password, registered)) {
    return res.status(401).json({ error: "Invalid password login." });
  }

  const user = {
    email,
    name: registered.name,
    role: selectedRole,
    provider: "password",
    mustChangePassword: !(selectedRole === "admin" && email === roles.admin.email) && (!registered.passwordHash || registered.mustChangePassword === true)
  };
  res.json({ token: createToken(user), user });
});

app.post("/api/auth/change-password", async (req, res) => {
  const session = validateBearerToken(req.get("authorization"));
  if (!session) return res.status(401).json({ error: "Authentication required." });

  const currentPassword = String(req.body.currentPassword || "").trim();
  const newPassword = String(req.body.newPassword || "").trim();
  if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
  if (newPassword === currentPassword) return res.status(400).json({ error: "Choose a new password that is different from the initial password." });

  const models = await getModels();
  if (!models) return res.status(503).json({ error: "MongoDB storage is required to change passwords." });

  const registered = await findRegisteredUser(session.email);
  const currentPasswordValid = session.email === roles.admin.email && !registered?.passwordHash
    ? currentPassword === roles.admin.password
    : verifyUserPassword(currentPassword, registered);
  if (!registered || registered.role !== session.role || !currentPasswordValid) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  await models.PortalUser.updateOne(
    { email: session.email },
    {
      $set: {
        email: session.email,
        name: registered.name || session.name,
        role: session.role,
        passwordHash: hashPassword(newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  const user = { ...session, provider: "password", mustChangePassword: false };
  res.json({ token: createToken(user), user });
});

app.post("/api/auth/google", async (req, res) => {
  if (!googleClientId) return res.status(401).json({ error: "Google client ID is missing on the server." });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: googleClientId });
    const payload = ticket.getPayload();
    const email = payload.email.trim().toLowerCase();
    const selectedRole = normalizeRole(req.body.selectedRole);
    const registered = await findRegisteredUser(email);
    const role = registered?.role;
    if (!registered || role !== selectedRole) return res.status(401).json({ error: "This Google account is not registered for dashboard access." });
    const user = { email, name: registered.name || payload.name || email, role, provider: "google", picture: payload.picture };
    res.json({ token: createToken(user), user });
  } catch {
    res.status(401).json({ error: "Invalid Google credential." });
  }
});

app.get("/api/portal", async (_req, res, next) => {
  try {
    res.json(await getPortalState());
  } catch (error) {
    next(error);
  }
});

app.put("/api/portal", async (req, res, next) => {
  try {
    res.json(await savePortalState(req.body));
  } catch (error) {
    next(error);
  }
});

app.get("/api/bootstrap", async (_req, res) => {
  try {
    res.json({
      employee,
      modules,
      lists,
      candidates: await (await getPeopleModels()).Candidate.find({}).sort({ createdAt: -1 }).lean(),
      timeSummary: await getTimeSummary(),
      tasks: await (await getPeopleModels()).Task.find({}).sort({ createdAt: -1 }).lean()
    });
  } catch (error) {
    res.json({
      employee: null,
      modules: [],
      lists: {},
      candidates: [],
      timeSummary: { totalHours: 0, submittedHours: 0, pendingHours: 0, logs: [] },
      tasks: [],
      warning: "Bootstrap data is unavailable.",
      detail: process.env.NODE_ENV === "production" ? null : error.message
    });
  }
});

app.get("/api/employee", (_req, res) => res.json(employee));
app.get("/api/modules", (_req, res) => res.json(modules));
app.get("/api/lists/:module", (req, res) => {
  const columns = lists[req.params.module];
  if (!columns) return res.sendStatus(404);
  res.json(columns);
});

app.get("/api/time/summary", async (_req, res, next) => {
  try {
    res.json(await getTimeSummary());
  } catch (error) {
    next(error);
  }
});

app.post("/api/time/logs", async (req, res, next) => {
  try {
    const { TimeLog } = await getPeopleModels();
    const log = {
      id: await getNextId(TimeLog),
      project: req.body.project,
      job: req.body.job,
      notes: req.body.notes,
      billable: Boolean(req.body.billable),
      hours: Number(req.body.hours || 0),
      submitted: false,
      createdAt: new Date()
    };
    await TimeLog.create(log);
    res.status(201).location(`/api/time/logs/${log.id}`).json(log);
  } catch (error) {
    next(error);
  }
});

app.get("/api/candidates", async (_req, res, next) => {
  try {
    const { Candidate } = await getPeopleModels();
    res.json(await Candidate.find({}).sort({ createdAt: -1 }).lean());
  } catch (error) {
    next(error);
  }
});

app.post("/api/candidates", async (req, res, next) => {
  try {
    const { Candidate } = await getPeopleModels();
    const candidate = {
      id: await getNextId(Candidate),
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      officialEmail: req.body.officialEmail,
      status: req.body.status,
      department: req.body.department,
      sourceOfHire: req.body.sourceOfHire,
      pan: req.body.pan,
      uan: req.body.uan,
      phone: req.body.phone,
      joiningDate: req.body.joiningDate,
      createdAt: new Date()
    };
    await Candidate.create(candidate);
    res.status(201).location(`/api/candidates/${candidate.id}`).json(candidate);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/candidates/:id", async (req, res, next) => {
  try {
    const { Candidate } = await getPeopleModels();
    const result = await Candidate.deleteOne({ id: Number(req.params.id) });
    res.sendStatus(result.deletedCount ? 204 : 404);
  } catch (error) {
    next(error);
  }
});

app.get("/api/attendance/today", async (req, res, next) => {
  try {
    const { Attendance } = await getPeopleModels();
    const record = await Attendance.findOne({ userEmail: req.query.userEmail, date: toDateString() }).sort({ id: -1 }).lean();
    res.json(record || null);
  } catch (error) {
    next(error);
  }
});

app.get("/api/attendance", async (req, res, next) => {
  try {
    const { Attendance } = await getPeopleModels();
    res.json(await Attendance.find({ userEmail: req.query.userEmail }).sort({ date: -1, id: -1 }).lean());
  } catch (error) {
    next(error);
  }
});

app.post("/api/attendance/check-in", async (req, res, next) => {
  try {
    const { Attendance } = await getPeopleModels();
    const userEmail = req.body.userEmail || "unknown@inspite.local";
    const today = toDateString();
    const existing = await Attendance.findOne({ userEmail, date: today }).sort({ id: -1 }).lean();
    if (existing && !existing.checkOutAt) return res.status(201).json(existing);
    const record = {
      id: await getNextId(Attendance),
      employeeId: Number(req.body.employeeId || 0),
      userEmail,
      userName: req.body.userName || userEmail,
      date: today,
      checkInAt: new Date(),
      checkOutAt: null,
      workedSeconds: existing?.workedSeconds || 0,
      status: "In"
    };
    await Attendance.create(record);
    res.status(201).location(`/api/attendance/${record.id}`).json(record);
  } catch (error) {
    next(error);
  }
});

app.post("/api/attendance/check-out", async (req, res, next) => {
  try {
    const { Attendance } = await getPeopleModels();
    const today = toDateString();
    const record = await Attendance.findOne({ userEmail: req.body.userEmail, date: today, checkOutAt: null }).sort({ id: -1 }).lean();
    if (!record) {
      const latest = await Attendance.findOne({ userEmail: req.body.userEmail, date: today }).sort({ id: -1 }).lean();
      return latest ? res.json(latest) : res.sendStatus(404);
    }
    const checkOutAt = new Date();
    const workedSeconds = Number(record.workedSeconds || 0) + Math.max(0, Math.floor((checkOutAt - record.checkInAt) / 1000));
    const updated = { ...record, checkOutAt, workedSeconds, status: "Checked out" };
    await Attendance.replaceOne({ id: record.id }, updated);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks", async (_req, res, next) => {
  try {
    const { Task } = await getPeopleModels();
    res.json(await Task.find({}).sort({ createdAt: -1 }).lean());
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks", async (req, res, next) => {
  try {
    const { Task } = await getPeopleModels();
    const task = {
      id: await getNextId(Task),
      title: req.body.title,
      description: req.body.description,
      status: "Open",
      createdAt: new Date()
    };
    await Task.create(task);
    res.status(201).location(`/api/tasks/${task.id}`).json(task);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Server error.", detail: process.env.NODE_ENV === "production" ? undefined : error.message });
});

export default app;
