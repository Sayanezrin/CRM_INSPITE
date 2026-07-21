import dotenv from "dotenv";
import mongoose from "mongoose";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
dns.setDefaultResultOrder("ipv4first");

const mongoConnectionString = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING || "";
const mongoDirectConnectionString = process.env.MONGODB_DIRECT_URI || "";
const databaseName = process.env.MONGODB_DATABASE_NAME || "inspite_people";
const portalCollectionName = process.env.MONGODB_PORTAL_COLLECTION || "portalState";
const connectionTimeoutMs = Number(process.env.MONGODB_CONNECTION_TIMEOUT_MS || 30000);
const dnsServers = (process.env.MONGODB_DNS_SERVERS || "")
  .split(",")
  .map((server) => server.trim())
  .filter(Boolean);

if (dnsServers.length) {
  dns.setServers(dnsServers);
}

let connectionPromise;
let modelsPromise;
let connectionStatus = "disconnected";

function hasMongoConnection() {
  return [mongoConnectionString, mongoDirectConnectionString].some((uri) => uri && !uri.includes("<db_password>"));
}

function getConnectionTargets() {
  return [
    { label: "primary", uri: mongoConnectionString },
    { label: "direct", uri: mongoDirectConnectionString }
  ].filter((target, index, targets) => (
    target.uri
    && !target.uri.includes("<db_password>")
    && targets.findIndex((item) => item.uri === target.uri) === index
  ));
}

export function isMongoConfigured() {
  return hasMongoConnection();
}

export function getMongoConnectionStatus() {
  if (!hasMongoConnection()) return "unconfigured";
  if (connectionStatus === "connected") return "connected";
  if (connectionStatus === "connecting") return "connecting";
  return "disconnected";
}

function createModels(connection) {
  const portalStateSchema = new mongoose.Schema({
    _id: String,
    dataJson: String,
    savedAt: Date
  }, { collection: portalCollectionName, versionKey: false, strict: false });

  const portalUserSchema = new mongoose.Schema({
    email: { type: String, index: true, unique: true },
    name: String,
    role: String,
    status: String,
    passwordHash: String,
    mustChangePassword: Boolean,
    passwordChangedAt: Date,
    updatedAt: Date
  }, { collection: "portalUsers", versionKey: false, strict: false });

  const timeLogSchema = new mongoose.Schema({
    id: { type: Number, index: true },
    project: String,
    job: String,
    notes: String,
    billable: Boolean,
    hours: Number,
    submitted: Boolean,
    createdAt: Date
  }, { collection: "timeLogs", versionKey: false, strict: false });

  const taskSchema = new mongoose.Schema({
    id: { type: Number, index: true },
    title: String,
    description: String,
    status: String,
    createdAt: Date
  }, { collection: "tasks", versionKey: false, strict: false });

  const candidateSchema = new mongoose.Schema({
    id: { type: Number, index: true },
    firstName: String,
    lastName: String,
    email: String,
    officialEmail: String,
    status: String,
    department: String,
    sourceOfHire: String,
    pan: String,
    uan: String,
    phone: String,
    joiningDate: String,
    createdAt: Date
  }, { collection: "Candidates", versionKey: false, strict: false });

  const attendanceSchema = new mongoose.Schema({
    id: { type: mongoose.Schema.Types.Mixed, index: true },
    employeeId: mongoose.Schema.Types.Mixed,
    userEmail: { type: String, index: true },
    userName: String,
    date: { type: String, index: true },
    checkInAt: Date,
    checkOutAt: Date,
    workedSeconds: Number,
    status: String
  }, { collection: "Attendance", versionKey: false, strict: false });

  return {
    PortalState: connection.model("PortalState", portalStateSchema),
    PortalUser: connection.model("PortalUser", portalUserSchema),
    TimeLog: connection.model("TimeLog", timeLogSchema),
    Task: connection.model("Task", taskSchema),
    Candidate: connection.model("Candidate", candidateSchema),
    Attendance: connection.model("Attendance", attendanceSchema)
  };
}

export async function getModels() {
  if (!hasMongoConnection()) return null;

  modelsPromise ??= (async () => {
    let lastError;
    for (const target of getConnectionTargets()) {
      try {
        console.log(`MongoDB connection started (${target.label})`);
        connectionStatus = "connecting";
        connectionPromise = mongoose.createConnection(target.uri, {
          dbName: databaseName,
          serverSelectionTimeoutMS: connectionTimeoutMs,
          connectTimeoutMS: connectionTimeoutMs,
          socketTimeoutMS: connectionTimeoutMs,
          family: 4
        }).asPromise();

        const connection = await connectionPromise;

        console.log(`MongoDB Connected (${target.label})`);
        console.log("Host:", connection.host);
        console.log("Database:", connection.name);

        connectionStatus = "connected";
        return createModels(connection);
      } catch (error) {
        lastError = error;
        connectionPromise = null;
        connectionStatus = "disconnected";
        console.error(`MongoDB ${target.label} connection failed:`, error.message);
      }
    }

    modelsPromise = null;
    throw lastError || new Error("MongoDB connection failed.");
  })();

  return modelsPromise;
}

export async function getModelsOrNull() {
  try {
    return await getModels();
  } catch {
    return null;
  }
}
