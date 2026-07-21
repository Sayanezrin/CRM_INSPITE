import React, { useEffect, useRef, useState } from "react";
import inspiteLogoImage from "./assets/inspite-logo.png";

const STORAGE_KEY = "inspite.people.role.portal";
const SESSION_KEY = "inspite.people.role.session";
const LOCAL_PASSWORDS_KEY = "inspite.people.local.passwords";
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://127.0.0.1:5018" : "");

const roles = {
  admin: { title: "Admin", email: "sayanezrin@gmail.com", password: "admin123" },
  hr: { title: "HR / Accountant", email: "hr@inspite.local", password: "HR@123" },
  employee: { title: "Employee", email: "employee@inspite.local", password: "Employee@123" }
};

const seedState = {
  employees: [],
  logins: [],
  ledger: [],
  expenses: [],
  leaves: [],
  attendance: []
};

function today() {
  return dateInputValue(new Date());
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString().slice(-6)}`;
}

function readState() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? { ...seedState, ...JSON.parse(saved) } : seedState;
  } catch {
    return seedState;
  }
}

function writeState(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The UI remains usable even if browser storage is unavailable.
  }
}

function hasPortalData(value) {
  return Boolean(value?.employees && value?.ledger && value?.expenses && value?.leaves && value?.attendance);
}

function readSession() {
  try {
    const saved = window.localStorage.getItem(SESSION_KEY);
    const session = saved ? JSON.parse(saved) : null;
    return session?.token ? session : null;
  } catch {
    return null;
  }
}

function writeSession(value) {
  try {
    if (value) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Session persistence is a convenience; the current tab can still continue.
  }
}

function readLocalPasswords() {
  try {
    const saved = window.localStorage.getItem(LOCAL_PASSWORDS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function writeLocalPasswords(value) {
  try {
    window.localStorage.setItem(LOCAL_PASSWORDS_KEY, JSON.stringify(value));
  } catch {
    // Local fallback passwords are best-effort only.
  }
}

function normalizeRole(role) {
  return role?.trim().toLowerCase() === "hr / accountant" ? "hr" : role?.trim().toLowerCase() || "employee";
}

function getFirstName(name, email = "") {
  const nameFirst = String(name || "").trim().split(/\s+/).find(Boolean);
  const emailFirst = String(email || "").trim().split("@")[0]?.split(/[._-]/).find(Boolean);
  const rawFirst = nameFirst || emailFirst || "Employee";
  return rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();
}

function initialPasswordForUser(user) {
  return `${getFirstName(user?.name, user?.email)}@123`;
}

function localPasswordKey(email, role) {
  return `${normalizeRole(role)}:${String(email || "").trim().toLowerCase()}`;
}

function getLocalPasswordLogin({ email, password, selectedRole, store }) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedRole = normalizeRole(selectedRole);

  if (normalizedEmail === roles.admin.email) {
    if (normalizedRole !== "admin" || password.trim() !== roles.admin.password) return null;
    return { email: normalizedEmail, name: "Saya Nezrin", role: "admin", provider: "local-password", token: `local-${Date.now()}`, mustChangePassword: true };
  }

  const registeredUser = [
    { email: roles.hr.email, name: roles.hr.title, accessRole: "hr" },
    { email: roles.employee.email, name: roles.employee.title, accessRole: "employee" },
    ...(store.logins || []),
    ...(store.employees || [])
  ].find((user) => user.email?.trim().toLowerCase() === normalizedEmail && normalizeRole(user.accessRole) === normalizedRole);

  if (!registeredUser) return null;
  const savedPassword = readLocalPasswords()[localPasswordKey(normalizedEmail, normalizedRole)];
  if (savedPassword) {
    if (password.trim() !== savedPassword) return null;
  } else if (password.trim() !== initialPasswordForUser({ ...registeredUser, email: normalizedEmail })) {
    return null;
  }

  return {
    email: normalizedEmail,
    name: registeredUser?.name || roles[normalizedRole]?.title || "Employee",
    role: normalizedRole,
    provider: "local-password",
    token: `local-${Date.now()}`,
    mustChangePassword: !savedPassword
  };
}

async function apiJson(path, options = {}) {
  const session = readSession();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const error = new Error(`API request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

async function savePortalState(value) {
  writeState(value);
  try {
    await apiJson("/api/portal", {
      method: "PUT",
      body: JSON.stringify(value)
    });
  } catch {
    // Local storage remains the offline fallback when the API is unavailable.
  }
}

function money(value) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN")}`;
}

const ledgerCsvColumns = ["id", "type", "date", "account", "category", "amount", "note", "createdBy"];
const expenseCsvColumns = ["id", "employeeId", "employeeName", "category", "date", "amount", "notes", "status", "submittedAt", "createdBy", "receiptName"];
const financeExportColumns = ["source", "id", "type", "date", "employeeName", "account", "category", "amount", "status", "note", "createdBy", "receiptName"];
const debitExpenseCategories = ["Salary", "Food & Meals", "Office Supplies", "Local Transportation (Cab, Auto, Parking, Toll)", "Other"];
const TOAST_EVENT = "inspite-toast";

function toast(message, type = "success") {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { id: uid("TOAST"), message, type } }));
}

function ToastHost() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const onToast = (event) => {
      const item = event.detail;
      setItems((current) => [...current, item]);
      window.setTimeout(() => {
        setItems((current) => current.filter((toastItem) => toastItem.id !== item.id));
      }, 3200);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((item) => (
        <div className={`toast-message ${item.type}`} key={item.id}>{item.message}</div>
      ))}
    </div>
  );
}

function downloadCsv(filename, rows, columns) {
  const headers = columns || Object.keys(rows[0] || {});
  if (!headers.length) {
    toast("No records available to export.", "error");
    return;
  }
  const exportRows = rows.map((row) => ({
    ...row,
    receiptName: row.receipt?.name || ""
  }));
  const csv = [
    headers.join(","),
    ...exportRows.map((row) => headers.map((key) => `"${String(row[key] ?? "").replace(/"/g, '""')}"`).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("CSV export downloaded.");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseRecordDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value);
  const raw = String(value).trim();
  const yyyymmdd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const ddmmyyyy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateInputValue(value) {
  const date = parseRecordDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isWithinDateRange(value, from, to) {
  const date = parseRecordDate(value);
  if (!date) return false;
  date.setHours(12, 0, 0, 0);
  const start = from ? parseRecordDate(from) : null;
  const end = to ? parseRecordDate(to) : null;
  if (start) start.setHours(0, 0, 0, 0);
  if (end) end.setHours(23, 59, 59, 999);
  return (!start || date >= start) && (!end || date <= end);
}

function isSameRecordDate(value, selectedDate) {
  if (!selectedDate) return true;
  return dateInputValue(value) === selectedDate;
}

function isSameRecordMonth(value, selectedMonth) {
  if (!selectedMonth) return true;
  return dateInputValue(value).startsWith(selectedMonth);
}

function getPeriodRange(period) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (period === "weekly") {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (period === "monthly") {
    start.setDate(1);
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 0);
  } else if (period === "yearly") {
    start.setMonth(0, 1);
    end.setFullYear(start.getFullYear(), 11, 31);
  }

  return { start, end };
}

function isWithinPeriod(value, period) {
  const date = parseRecordDate(value);
  if (!date) return false;
  const { start, end } = getPeriodRange(period);
  return date >= start && date <= end;
}

function ledgerEntryFromExpense(expense, createdBy = expense.createdBy || "Admin") {
  return {
    id: uid("TXN"),
    type: "Debit",
    date: expense.date || expense.submittedAt || today(),
    account: expense.employeeName || "Admin / Company",
    category: expense.category,
    amount: Number(expense.amount || 0),
    note: expense.notes || "",
    createdBy,
    sourceExpenseId: expense.id
  };
}

function buildFinanceRows(store) {
  const ledgerRows = (store.ledger || [])
    .filter((item) => String(item.type || "Debit").toLowerCase() === "debit")
    .map((item) => ({
    source: "Ledger",
    id: item.id,
    type: "Debit",
    date: item.date,
    employeeName: "",
    account: item.account,
    category: item.category,
    amount: Number(item.amount || 0),
    status: "Recorded",
    note: item.note,
    createdBy: item.createdBy || "HR",
    receiptName: ""
  }));

  const ledgerExpenseIds = new Set((store.ledger || []).map((item) => item.sourceExpenseId).filter(Boolean));
  const expenseRows = (store.expenses || [])
    .filter((item) => item.status === "Approved" && !ledgerExpenseIds.has(item.id))
    .map((item) => ({
    source: "Expense",
    id: item.id,
    type: "Debit",
    date: item.date || item.submittedAt,
    employeeName: item.employeeName,
    account: item.employeeId,
    category: item.category,
    amount: Number(item.amount || 0),
    status: item.status,
    note: item.notes,
    createdBy: item.createdBy || "Employee",
    receiptName: item.receipt?.name || ""
  }));

  return [...ledgerRows, ...expenseRows].sort((a, b) => {
    const first = parseRecordDate(a.date)?.getTime() || 0;
    const second = parseRecordDate(b.date)?.getTime() || 0;
    return second - first;
  });
}

function downloadExcelReport(filename, title, sheets) {
  const hasRows = sheets.some((sheet) => sheet.rows.length);
  if (!hasRows) {
    toast("No records available for this report.", "error");
    return;
  }

  const body = sheets.map((sheet) => `
    <h2>${escapeHtml(sheet.title)}</h2>
    <table>
      <thead><tr>${sheet.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
      <tbody>
        ${sheet.rows.map((row) => `<tr>${sheet.columns.map((column) => `<td>${escapeHtml(column === "amount" || column === "salary" ? Number(row[column] || 0) : row[column] ?? "")}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif}h1,h2{margin:12px 0}table{border-collapse:collapse;margin-bottom:24px}th,td{border:1px solid #b8c2cf;padding:6px 8px;white-space:nowrap}th{background:#e9eef6}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Excel report downloaded.");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function App() {
  const [store, setStore] = useState(readState);
  const [session, setSession] = useState(readSession);
  const [activePage, setActivePage] = useState("home");
  const [apiStatus, setApiStatus] = useState("connecting");
  const healthFailuresRef = useRef(0);

  const refreshBackendHealth = () => fetch(`${API_URL}/api/health/mongodb`)
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Health check failed: ${response.status}`)))
    .then((payload) => {
      if (payload.storage === "mongodb") {
        healthFailuresRef.current = 0;
        setApiStatus("connected");
      } else if (payload.storage === "connecting") {
        healthFailuresRef.current = 0;
        setApiStatus((current) => current === "connected" ? "connected" : "connecting");
      } else {
        healthFailuresRef.current += 1;
        if (healthFailuresRef.current >= 2) setApiStatus("offline");
      }
      return payload;
    })
    .catch(() => {
      healthFailuresRef.current += 1;
      if (healthFailuresRef.current >= 2) setApiStatus("offline");
      return null;
    });

  const refreshPortalState = () => apiJson("/api/portal")
    .then((payload) => {
      if (!hasPortalData(payload)) return null;
      const nextPayload = { ...seedState, ...payload, logins: payload.logins || [] };
      setStore(nextPayload);
      writeState(nextPayload);
      return nextPayload;
    })
    .catch(() => {
      return null;
    });

  useEffect(() => {
    if (!session?.token) return;
    let cancelled = false;
    let retryTimer;
    let healthInterval;
    let portalInterval;

    const loadPortal = () => {
      refreshPortalState()
        .then((payload) => {
          if (cancelled) return;
          if (payload) return;
          retryTimer = window.setTimeout(loadPortal, 3000);
        });
    };

    refreshBackendHealth();
    healthInterval = window.setInterval(refreshBackendHealth, 10000);
    loadPortal();
    portalInterval = window.setInterval(refreshPortalState, 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(healthInterval);
      window.clearInterval(portalInterval);
    };
  }, [session?.token]);

  useEffect(() => {
    if (!session) return;
    const allowed = getNavItemsForRole(session.role).some((item) => item.id === activePage);
    if (!allowed) setActivePage("home");
  }, [activePage, session]);

  const commit = (updater) => {
    setStore((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      savePortalState(next).then(() => {
        window.setTimeout(refreshPortalState, 250);
      });
      return next;
    });
  };

  const commitAttendance = async (updater) => {
    let savedLocal = false;
    try {
      const latest = await apiJson("/api/portal");
      const base = hasPortalData(latest) ? { ...seedState, ...latest, logins: latest.logins || [] } : readState();
      const next = typeof updater === "function" ? updater(base) : updater;
      writeState(next);
      setStore(next);
      savedLocal = true;
      await apiJson("/api/portal", {
        method: "PUT",
        body: JSON.stringify(next)
      });
      window.setTimeout(refreshPortalState, 250);
      return true;
    } catch {
      if (!savedLocal) commit(updater);
      toast("Attendance saved on this device only. Admin can see it after backend storage reconnects.", "error");
      return false;
    }
  };

  if (!session) {
    return <><LoginScreen store={store} onLogin={(nextSession) => { writeSession(nextSession); setSession(nextSession); setActivePage("home"); }} /><ToastHost /></>;
  }

  if (session.mustChangePassword) {
    return <><PasswordChangeScreen session={session} onChanged={(nextSession) => { writeSession(nextSession); setSession(nextSession); setActivePage("home"); }} onLogout={() => { writeSession(null); setSession(null); }} /><ToastHost /></>;
  }

  return (
    <div className="portal-shell">
      <Sidebar session={session} activePage={activePage} onPageChange={setActivePage} onLogout={() => { writeSession(null); setSession(null); }} />
      <main className="portal-main">
        <Header session={session} store={store} activePage={activePage} apiStatus={apiStatus} />
        <RolePage session={session} activePage={activePage} store={store} commit={commit} commitAttendance={commitAttendance} />
      </main>
      <ToastHost />
    </div>
  );
}

function LoginScreen({ store, onLogin }) {
  const [selectedRole, setSelectedRole] = useState("admin");
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const selectRole = (role) => {
    setSelectedRole(role);
    setForm({ email: "", password: "" });
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    try {
      const login = await apiJson("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ email: form.email, password: form.password, selectedRole })
      });
      toast("Signed in successfully.");
      onLogin({ ...login.user, token: login.token });
    } catch (error) {
      const localLogin = getLocalPasswordLogin({ ...form, selectedRole, store });
      if (localLogin) {
        toast("Signed in with local fallback storage.");
        onLogin(localLogin);
        return;
      }
      setError(error.status === 401
        ? "Check the selected dashboard, email, and password."
        : "Backend login is unavailable. Check the selected dashboard, email, and password.");
    }
  };

  return (
    <div className="login-page">
      <section className="login-copy">
        <img src={inspiteLogoImage} alt="Inspite Technologies" />
        <h1>Work smarter. Track better. Approve faster.</h1>
        <p>Choose one of the three logins to manage employee records, finance entries, approvals, attendance, leave, and reimbursements.</p>
      </section>
      <form className="login-panel" onSubmit={submit}>
        <h2>Sign in</h2>
        <div className="role-picker" aria-label="Select login role">
          {Object.entries(roles).map(([key, role]) => (
            <button type="button" key={key} className={selectedRole === key ? "active" : ""} onClick={() => selectRole(key)}>
              {role.title}
            </button>
          ))}
        </div>
        <label>Email<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>Password
          <span className="password-field">
            <input type={showPassword ? "text" : "password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {showPassword ? (
                  <>
                    <path d="M3 3l18 18" />
                    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                    <path d="M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.2 10 7a15.7 15.7 0 0 1-3.1 4" />
                    <path d="M6.6 6.6A15.5 15.5 0 0 0 2 12c1.5 2.8 5 7 10 7 1.4 0 2.7-.3 3.8-.8" />
                  </>
                ) : (
                  <>
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" type="submit">Open Dashboard</button>
        <div className="credential-list">
          <span>First password: FirstName@123</span>
          <span>Use the email assigned by Admin.</span>
        </div>
      </form>
    </div>
  );
}

function PasswordChangeScreen({ session, onChanged, onLogout }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      setError("New password and confirmation must match.");
      toast("New password and confirmation must match.", "error");
      return;
    }
    if (form.newPassword.trim().length < 6) {
      setError("New password must be at least 6 characters.");
      toast("New password must be at least 6 characters.", "error");
      return;
    }
    if (session.provider === "local-password") {
      const passwordKey = localPasswordKey(session.email, session.role);
      const savedPasswords = readLocalPasswords();
      const currentPassword = savedPasswords[passwordKey] || initialPasswordForUser(session);
      if (form.currentPassword.trim() !== currentPassword) {
        setError("Current password is incorrect.");
        toast("Current password is incorrect.", "error");
        return;
      }
      if (form.newPassword.trim() === currentPassword) {
        setError("Choose a new password that is different from the initial password.");
        toast("Choose a different new password.", "error");
        return;
      }
      const nextPasswords = { ...savedPasswords, [passwordKey]: form.newPassword.trim() };
      writeLocalPasswords(nextPasswords);
      toast("Password changed successfully.");
      onChanged({ ...session, mustChangePassword: false });
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Password change failed.");
      toast("Password changed successfully.");
      onChanged({ ...payload.user, token: payload.token });
    } catch (error) {
      setError(error.message);
      toast(error.message, "error");
    }
  };

  return (
    <div className="login-page password-change-page">
      <section className="login-copy">
        <img src={inspiteLogoImage} alt="Inspite Technologies" />
        <h1>Set your new password</h1>
        <p>Your first password is only for the first sign in. Create a private password before opening the dashboard.</p>
      </section>
      <form className="login-panel" onSubmit={submit}>
        <h2>Password required</h2>
        <p className="change-note">Signed in as {session.email}</p>
        <label>Current password<input type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} /></label>
        <label>New password<input type="password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} /></label>
        <label>Confirm password<input type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" type="submit">Change Password</button>
        <button className="secondary-button" type="button" onClick={onLogout}>Sign out</button>
      </form>
    </div>
  );
}

const navItems = [
  { id: "home", label: "Home" },
  { id: "logins", label: "Add Login", roles: ["admin"] },
  { id: "employees", label: "Employees" },
  { id: "finance", label: "Finance", roles: ["admin", "hr"] },
  { id: "leave", label: "Leave" },
  { id: "expenses", label: "Expenses" },
  { id: "attendance", label: "Attendance" }
];

function getNavItemsForRole(role) {
  return navItems.filter((item) => !item.roles || item.roles.includes(role));
}

function Sidebar({ session, activePage, onPageChange, onLogout }) {
  const availableItems = getNavItemsForRole(session.role);
  return (
    <aside className="sidebar">
      <img src={inspiteLogoImage} alt="" />
      <nav>
        <span className="nav-pill">{session.name}</span>
        {availableItems.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`nav-link ${activePage === item.id ? "active" : ""}`}
            onClick={() => onPageChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <button onClick={onLogout}>Sign out</button>
    </aside>
  );
}

function Header({ session, store, activePage, apiStatus }) {
  const approvedExpenses = store.expenses.filter((item) => item.status === "Approved").reduce((sum, item) => sum + Number(item.amount), 0);
  const pendingApprovals = store.expenses.filter((item) => item.status === "Pending").length + store.leaves.filter((item) => item.status === "Pending").length;
  const pageTitle = getNavItemsForRole(session.role).find((item) => item.id === activePage)?.label || "Home";
  const statusLabel = apiStatus === "connected"
    ? "Backend storage connected"
    : apiStatus === "connecting"
      ? "Backend storage connecting"
      : "Offline fallback storage";
  return (
    <header className="page-header">
      <div>
        <p>{session.email}</p>
        <h1>{session.name} - {pageTitle}</h1>
        <span className={`api-status ${apiStatus}`}>{statusLabel}</span>
      </div>
      {session.role !== "employee" && (
        <div className="header-metrics">
          <Metric label="Employees" value={store.employees.length} />
          <Metric label="Pending Approvals" value={pendingApprovals} />
          <Metric label="Approved Expenses" value={money(approvedExpenses)} />
        </div>
      )}
    </header>
  );
}

function RolePage({ session, activePage, store, commit, commitAttendance }) {
  if (session.role === "admin") return <AdminPage activePage={activePage} store={store} commit={commit} commitAttendance={commitAttendance} session={session} />;
  if (session.role === "hr") return <HrPage activePage={activePage} store={store} commit={commit} commitAttendance={commitAttendance} session={session} />;
  return <EmployeePage activePage={activePage} store={store} commit={commit} commitAttendance={commitAttendance} session={session} />;
}

function AdminPage({ activePage, store, commit, commitAttendance, session }) {
  if (activePage === "logins") return <DashboardGrid><AddLoginPanel commit={commit} /><LoginAccessTable logins={store.logins || []} commit={commit} className="full-row-panel" /></DashboardGrid>;
  if (activePage === "employees") return <DashboardGrid><AddEmployeePanel commit={commit} /><EmployeeTable employees={store.employees} commit={commit} canDelete className="full-row-panel" /></DashboardGrid>;
  if (activePage === "finance") return <DashboardGrid><AdminExpenseFormPanel store={store} commit={commit} createdBy="Admin" title="Add Debit Expense" /><FinancePanel store={store} canExport className="full-row-panel" /><LedgerTable store={store} className="full-row-panel" /></DashboardGrid>;
  if (activePage === "leave") return <DashboardGrid><ApprovalPanel title="Leave Applications" items={store.leaves} kind="leaves" commit={commit} /><LeaveTable leaves={store.leaves} /></DashboardGrid>;
  if (activePage === "expenses") return <DashboardGrid><AdminExpenseFormPanel store={store} commit={commit} /><ApprovalPanel title="Expense Approvals" items={store.expenses} kind="expenses" commit={commit} className="full-row-panel" /><ExpenseTable expenses={store.expenses} className="full-row-panel" /></DashboardGrid>;
  if (activePage === "attendance") return <AttendancePage store={store} commit={commit} commitAttendance={commitAttendance} session={session} />;
  return <AdminHome store={store} commit={commit} />;
}

function HrPage({ activePage, store, commit, commitAttendance, session }) {
  if (activePage === "employees") return <DashboardGrid><EmployeeTable employees={store.employees} /></DashboardGrid>;
  if (activePage === "leave") return <DashboardGrid><LeaveTable leaves={store.leaves} /></DashboardGrid>;
  if (activePage === "expenses") return <DashboardGrid><ApprovalPanel title="Expense Approval Queue" items={store.expenses} kind="expenses" commit={commit} /><ExpenseTable expenses={store.expenses} /></DashboardGrid>;
  if (activePage === "attendance") return <AttendancePage store={store} commit={commit} commitAttendance={commitAttendance} session={session} />;
  if (activePage === "finance") return <DashboardGrid><AdminExpenseFormPanel store={store} commit={commit} createdBy="HR" title="Add Debit Expense" /><FinancePanel store={store} canExport className="full-row-panel" /><LedgerTable store={store} className="full-row-panel" /></DashboardGrid>;
  return <DashboardGrid><FinancePanel store={store} canExport className="full-row-panel" /><ApprovalPanel title="Expense Approval Queue" items={store.expenses} kind="expenses" commit={commit} className="full-row-panel" /></DashboardGrid>;
}

function EmployeePage({ activePage, store, commit, commitAttendance, session }) {
  const currentEmployee = getEmployeeForSession(store, session);
  if (!currentEmployee) return <EmployeeProfileMissing session={session} />;
  if (activePage === "employees") return <DashboardGrid><EmployeeProfilePanel employee={currentEmployee} /></DashboardGrid>;
  if (activePage === "leave") return <DashboardGrid><LeaveFormPanel store={store} commit={commit} currentEmployee={currentEmployee} /><LeaveTable leaves={store.leaves.filter((item) => item.employeeId === currentEmployee.id)} /></DashboardGrid>;
  if (activePage === "expenses") return <DashboardGrid><ExpenseFormPanel store={store} commit={commit} currentEmployee={currentEmployee} /><ExpenseTable expenses={store.expenses.filter((item) => item.employeeId === currentEmployee.id)} /></DashboardGrid>;
  if (activePage === "attendance") return <DashboardGrid><EmployeeAttendancePanel store={store} commit={commitAttendance} currentEmployee={currentEmployee} /></DashboardGrid>;
  return <EmployeeHome store={store} commit={commit} commitAttendance={commitAttendance} currentEmployee={currentEmployee} />;
}

function EmployeeProfilePanel({ employee }) {
  const fields = [
    ["Employee ID", employee.id],
    ["Name", employee.name],
    ["Email", employee.email],
    ["Dashboard Access", roles[employee.accessRole]?.title || employee.accessRole || "Employee"],
    ["Department", employee.department],
    ["Role", employee.role],
    ["Salary", money(employee.salary)],
    ["Date of Joining", employee.joinedAt],
    ["Birthday", employee.birthday],
    ["Mobile", employee.mobile],
    ["Alternative Number", employee.alternativeNumber],
    ["Aadhaar Number", employee.aadhaar],
    ["PAN", employee.pan],
    ["UAN", employee.uan],
    ["Experience", employee.experience],
    ["Qualification", employee.qualification],
    ["College", employee.college],
    ["Address", employee.address],
    ["Status", employee.status]
  ];

  return (
    <Panel title="My Profile" className="full-row-panel employee-profile-panel">
      <div className="profile-detail-grid">
        {fields.map(([label, value]) => (
          <div className="profile-detail" key={label}>
            <span>{label}</span>
            <strong>{value || "--"}</strong>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function EmployeeProfileMissing({ session }) {
  return (
    <DashboardGrid>
      <Panel title="Employee Profile Required" className="full-row-panel">
        <p className="empty-note">No employee profile is registered for {session.email}. Ask Admin to add this employee in the Employee Directory first.</p>
      </Panel>
    </DashboardGrid>
  );
}

function getEmployeeForSession(store, session) {
  const email = session.email?.toLowerCase();
  const employee = store.employees.find((item) => item.email?.toLowerCase() === email);
  if (employee) return employee;

  const login = (store.logins || []).find((item) => item.email?.toLowerCase() === email);
  if (!login) return null;

  return {
    id: login.employeeId || `LOGIN-${login.email}`,
    name: login.name || session.name,
    email: login.email,
    accessRole: login.accessRole || session.role,
    department: "General",
    role: roles[login.accessRole]?.title || "Employee",
    salary: 0,
    joinedAt: "",
    birthday: "",
    mobile: "",
    alternativeNumber: "",
    aadhaar: "",
    pan: "",
    uan: "",
    experience: "",
    qualification: "",
    college: "",
    address: "",
    status: login.status || "Active"
  };
}

function AttendancePage({ store, commit, commitAttendance, session }) {
  const currentEmployee = getEmployeeForSession(store, session);
  return (
    <DashboardGrid>
      {currentEmployee ? (
        <EmployeeAttendancePanel store={store} commit={commitAttendance || commit} currentEmployee={currentEmployee} />
      ) : (
        <Panel title="My Attendance" className="full-row-panel">
          <p className="empty-note">No employee profile is linked to {session.email}. Add this email in Employee Directory to mark attendance.</p>
        </Panel>
      )}
      <AttendanceTable attendance={store.attendance} className="full-row-panel" />
    </DashboardGrid>
  );
}

function AdminHome({ store, commit }) {
  const totals = getTotals(buildFinanceRows(store));
  return (
    <DashboardGrid>
      <Panel title="Admin Overview" className="full-row-panel">
        <div className="overview-grid">
          <Metric label="Employees" value={store.employees.length} />
          <Metric label="Credit" value={money(totals.credit)} />
          <Metric label="Debit" value={money(totals.debit)} />
          <Metric label="Total" value={money(totals.credit - totals.debit)} />
          <Metric label="Pending Leaves" value={store.leaves.filter((item) => item.status === "Pending").length} />
          <Metric label="Pending Expenses" value={store.expenses.filter((item) => item.status === "Pending").length} />
        </div>
      </Panel>
      <ApprovalPanel title="Leave Applications" items={store.leaves.filter((item) => item.status === "Pending")} kind="leaves" commit={commit} className="full-row-panel" />
      <ApprovalPanel title="Expense Approvals" items={store.expenses.filter((item) => item.status === "Pending")} kind="expenses" commit={commit} className="full-row-panel" />
      <AttendanceTable attendance={store.attendance.slice(0, 5)} title="Recent Attendance" className="full-row-panel" />
    </DashboardGrid>
  );
}

function EmployeeHome({ store, commit, commitAttendance, currentEmployee }) {
  const leaves = store.leaves.filter((item) => item.employeeId === currentEmployee.id);
  const expenses = store.expenses.filter((item) => item.employeeId === currentEmployee.id);
  return (
    <DashboardGrid>
      <Panel title="My Overview">
        <div className="overview-grid">
          <Metric label="Leave Requests" value={leaves.length} />
          <Metric label="Expense Claims" value={expenses.length} />
          <Metric label="Approved Amount" value={money(expenses.filter((item) => item.status === "Approved").reduce((sum, item) => sum + Number(item.amount), 0))} />
        </div>
      </Panel>
      <EmployeeAttendancePanel store={store} commit={commitAttendance || commit} currentEmployee={currentEmployee} />
      <LeaveFormPanel store={store} commit={commit} currentEmployee={currentEmployee} />
      <ExpenseFormPanel store={store} commit={commit} currentEmployee={currentEmployee} />
    </DashboardGrid>
  );
}

function AddLoginPanel({ commit }) {
  const blankLogin = { name: "", email: "", accessRole: "employee" };
  const [login, setLogin] = useState(blankLogin);

  const addLogin = (event) => {
    event.preventDefault();
    if (!login.name.trim() || !login.email.trim()) {
      toast("Enter name and email before adding login.", "error");
      return;
    }
    commit((current) => ({
      ...current,
      logins: [
        {
          id: uid("LOGIN"),
          name: login.name.trim(),
          email: login.email.trim().toLowerCase(),
          accessRole: login.accessRole,
          status: "Active"
        },
        ...(current.logins || [])
      ]
    }));
    toast("Login access added.");
    setLogin(blankLogin);
  };

  return (
    <Panel title="Add Login" className="full-row-panel">
      <form className="form-grid" onSubmit={addLogin}>
        <input placeholder="Name" value={login.name} onChange={(event) => setLogin({ ...login, name: event.target.value })} />
        <input placeholder="Email" value={login.email} onChange={(event) => setLogin({ ...login, email: event.target.value })} />
        <select value={login.accessRole} onChange={(event) => setLogin({ ...login, accessRole: event.target.value })}>
          <option value="admin">Admin dashboard</option>
          <option value="hr">HR / Accountant dashboard</option>
          <option value="employee">Employee dashboard</option>
        </select>
        <button className="primary-button">Add Login</button>
      </form>
    </Panel>
  );
}

function LoginAccessTable({ logins, commit, className = "" }) {
  const deleteLogin = (loginId) => {
    commit((current) => ({
      ...current,
      logins: (current.logins || []).filter((login) => login.id !== loginId)
    }));
    toast("Login access deleted.");
  };

  if (!logins.length) return <Panel title="Login Access" className={className}><p className="empty-note">No login access added yet.</p></Panel>;

  return (
    <Panel title="Login Access" className={className}>
      <div className="data-table login-records">
        <div className="data-head">
          <span>name</span>
          <span>email</span>
          <span>dashboard</span>
          <span>status</span>
          <span>delete</span>
        </div>
        {logins.map((login) => (
          <div className="data-row" key={login.id}>
            <span>{login.name}</span>
            <span>{login.email}</span>
            <span>{roles[login.accessRole]?.title || "Employee"}</span>
            <span>{login.status}</span>
            <span>
              <button className="icon-action danger" type="button" aria-label={`Delete ${login.email}`} title="Delete login" onClick={() => deleteLogin(login.id)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16" />
                  <path d="M9 7V5h6v2" />
                  <path d="M6 7l1 14h10l1-14" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AddEmployeePanel({ commit }) {
  const blankEmployee = {
    name: "",
    email: "",
    accessRole: "employee",
    department: "",
    role: "",
    salary: "",
    joinedAt: "",
    birthday: "",
    address: "",
    mobile: "",
    alternativeNumber: "",
    aadhaar: "",
    pan: "",
    uan: "",
    experience: "",
    qualification: "",
    college: ""
  };
  const [employee, setEmployee] = useState(blankEmployee);

  const addEmployee = (event) => {
    event.preventDefault();
    if (!employee.name.trim() || !employee.email.trim()) {
      toast("Enter employee name and email.", "error");
      return;
    }
    const nextEmployee = {
      id: uid("EMP"),
      name: employee.name.trim(),
      email: employee.email.trim().toLowerCase(),
      accessRole: employee.accessRole,
      department: employee.department || "General",
      role: employee.role || "Employee",
      salary: Number(employee.salary || 0),
      joinedAt: employee.joinedAt,
      birthday: employee.birthday,
      address: employee.address.trim(),
      mobile: employee.mobile.trim(),
      alternativeNumber: employee.alternativeNumber.trim(),
      aadhaar: employee.aadhaar.trim(),
      pan: employee.pan.trim(),
      uan: employee.uan.trim(),
      experience: employee.experience.trim(),
      qualification: employee.qualification.trim(),
      college: employee.college.trim(),
      status: "Active"
    };
    commit((current) => ({
      ...current,
      employees: [
        nextEmployee,
        ...(current.employees || [])
      ],
      logins: [
        {
          id: uid("LOGIN"),
          name: nextEmployee.name,
          email: nextEmployee.email,
          accessRole: nextEmployee.accessRole,
          employeeId: nextEmployee.id,
          status: "Active"
        },
        ...(current.logins || []).filter((login) => login.email?.toLowerCase() !== nextEmployee.email)
      ]
    }));
    toast("Employee added to directory.");
    setEmployee(blankEmployee);
  };

  return (
    <Panel title="Add Employee" className="full-row-panel">
      <form className="form-grid employee-form-grid" onSubmit={addEmployee}>
        <input placeholder="Employee name" value={employee.name} onChange={(event) => setEmployee({ ...employee, name: event.target.value })} />
        <input placeholder="Email" value={employee.email} onChange={(event) => setEmployee({ ...employee, email: event.target.value })} />
        <select value={employee.accessRole} onChange={(event) => setEmployee({ ...employee, accessRole: event.target.value })}>
          <option value="admin">Admin dashboard</option>
          <option value="hr">HR / Accountant dashboard</option>
          <option value="employee">Employee dashboard</option>
        </select>
        <input placeholder="Department" value={employee.department} onChange={(event) => setEmployee({ ...employee, department: event.target.value })} />
        <input placeholder="Role" value={employee.role} onChange={(event) => setEmployee({ ...employee, role: event.target.value })} />
        <input type="number" placeholder="Salary" value={employee.salary} onChange={(event) => setEmployee({ ...employee, salary: event.target.value })} />
        <label>Date of joining<input type="date" value={dateInputValue(employee.joinedAt)} onChange={(event) => setEmployee({ ...employee, joinedAt: event.target.value })} /></label>
        <label>Birthday<input type="date" value={dateInputValue(employee.birthday)} onChange={(event) => setEmployee({ ...employee, birthday: event.target.value })} /></label>
        <input placeholder="Mobile number" value={employee.mobile} onChange={(event) => setEmployee({ ...employee, mobile: event.target.value })} />
        <input placeholder="Alternative number" value={employee.alternativeNumber} onChange={(event) => setEmployee({ ...employee, alternativeNumber: event.target.value })} />
        <input placeholder="Aadhaar number" value={employee.aadhaar} onChange={(event) => setEmployee({ ...employee, aadhaar: event.target.value })} />
        <input placeholder="PAN optional" value={employee.pan} onChange={(event) => setEmployee({ ...employee, pan: event.target.value })} />
        <input placeholder="UAN optional" value={employee.uan} onChange={(event) => setEmployee({ ...employee, uan: event.target.value })} />
        <input placeholder="Experience" value={employee.experience} onChange={(event) => setEmployee({ ...employee, experience: event.target.value })} />
        <input placeholder="Latest qualification" value={employee.qualification} onChange={(event) => setEmployee({ ...employee, qualification: event.target.value })} />
        <input placeholder="College" value={employee.college} onChange={(event) => setEmployee({ ...employee, college: event.target.value })} />
        <input className="wide-input" placeholder="Address" value={employee.address} onChange={(event) => setEmployee({ ...employee, address: event.target.value })} />
        <button className="primary-button">Add Employee</button>
      </form>
    </Panel>
  );
}

function LedgerEntryPanel({ commit, className = "" }) {
  const [entry, setEntry] = useState({ type: "Credit", amount: "", account: "", category: "", note: "", date: "" });

  const addLedger = (event) => {
    event.preventDefault();
    if (!entry.amount || !entry.account.trim()) {
      toast("Enter amount and account before saving ledger.", "error");
      return;
    }
    commit((current) => ({
      ...current,
      ledger: [{ id: uid("TXN"), ...entry, amount: Number(entry.amount), createdBy: "HR" }, ...current.ledger]
    }));
    toast("Ledger entry saved.");
    setEntry({ type: "Credit", amount: "", account: "", category: "", note: "", date: "" });
  };

  return (
    <Panel title="Credit / Debit Entry" className={className}>
      <form className="form-grid" onSubmit={addLedger}>
        <select value={entry.type} onChange={(event) => setEntry({ ...entry, type: event.target.value })}><option>Credit</option><option>Debit</option></select>
        <input type="number" placeholder="Amount" value={entry.amount} onChange={(event) => setEntry({ ...entry, amount: event.target.value })} />
        <input placeholder="Account" value={entry.account} onChange={(event) => setEntry({ ...entry, account: event.target.value })} />
        <input placeholder="Category" value={entry.category} onChange={(event) => setEntry({ ...entry, category: event.target.value })} />
        <input type="date" value={dateInputValue(entry.date)} onChange={(event) => setEntry({ ...entry, date: event.target.value })} />
        <input placeholder="Note" value={entry.note} onChange={(event) => setEntry({ ...entry, note: event.target.value })} />
        <button className="primary-button">Save to Ledger</button>
      </form>
    </Panel>
  );
}

function AdminExpenseFormPanel({ store, commit, createdBy = "Admin", title = "Add Expense" }) {
  const [expense, setExpense] = useState({ employeeId: "company", category: "Salary", amount: "", date: "", notes: "" });
  const [receipt, setReceipt] = useState(null);
  const [receiptError, setReceiptError] = useState("");

  const handleReceiptUpload = async (event) => {
    const file = event.target.files?.[0];
    setReceiptError("");
    if (!file) {
      setReceipt(null);
      return;
    }
    const allowed = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!allowed) {
      setReceiptError("Upload an image or PDF receipt.");
      toast("Upload an image or PDF receipt.", "error");
      event.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setReceiptError("Receipt must be 2 MB or smaller for web storage.");
      toast("Receipt must be 2 MB or smaller.", "error");
      event.target.value = "";
      return;
    }
    try {
      setReceipt({ name: file.name, type: file.type, size: file.size, dataUrl: await fileToDataUrl(file) });
      toast("Receipt uploaded.");
    } catch {
      setReceiptError("Could not read this receipt. Please try another file.");
      toast("Could not read this receipt.", "error");
    }
  };

  const addExpense = (event) => {
    event.preventDefault();
    if (!expense.amount) {
      toast("Enter expense amount before adding.", "error");
      return;
    }
    const selectedEmployee = store.employees.find((employee) => employee.id === expense.employeeId);
    const expenseRecord = {
        id: uid("EXP"),
        employeeId: selectedEmployee?.id || "ADMIN",
        employeeName: selectedEmployee?.name || `${createdBy} / Company`,
        category: expense.category,
        amount: Number(expense.amount),
        date: expense.date,
        notes: expense.notes.trim(),
        receipt,
        status: "Approved",
        submittedAt: today(),
        createdBy
    };
    const ledgerRecord = ledgerEntryFromExpense(expenseRecord, createdBy);
    commit((current) => ({
      ...current,
      expenses: [expenseRecord, ...current.expenses],
      ledger: [ledgerRecord, ...(current.ledger || [])]
    }));
    toast("Debit expense added to finance and ledger.");
    setExpense({ employeeId: "company", category: "Salary", amount: "", date: "", notes: "" });
    setReceipt(null);
    setReceiptError("");
    event.currentTarget.reset();
  };

  return (
    <Panel title={title} className="full-row-panel">
      <form className="form-grid admin-expense-form" onSubmit={addExpense}>
        <select value={expense.employeeId} onChange={(event) => setExpense({ ...expense, employeeId: event.target.value })}>
          <option value="company">Admin / Company Expense</option>
          {store.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select>
        <select value={expense.category} onChange={(event) => setExpense({ ...expense, category: event.target.value })}>
          {debitExpenseCategories.map((category) => <option key={category}>{category}</option>)}
        </select>
        <input type="number" placeholder="Amount" value={expense.amount} onChange={(event) => setExpense({ ...expense, amount: event.target.value })} />
        <input type="date" value={dateInputValue(expense.date)} onChange={(event) => setExpense({ ...expense, date: event.target.value })} />
        <input className="wide-input" placeholder="Notes" value={expense.notes} onChange={(event) => setExpense({ ...expense, notes: event.target.value })} />
        <label className="receipt-field">
          <span>Receipt</span>
          <input type="file" accept="image/*,.pdf,application/pdf" onChange={handleReceiptUpload} />
          <small>{receipt ? receipt.name : "Image or PDF, max 2 MB"}</small>
          {receiptError && <em>{receiptError}</em>}
        </label>
        <button className="primary-button compact-submit-button">Add Expense</button>
      </form>
    </Panel>
  );
}

function EmployeeAttendancePanel({ store, commit, currentEmployee }) {
  const [savingAttendance, setSavingAttendance] = useState(false);
  const employeeAttendance = store.attendance.filter((item) => item.employeeId === currentEmployee.id);
  const activeAttendance = employeeAttendance.find((item) => item.date === today() && item.status !== "Checked Out" && !item.checkOut);
  const checkInDisabled = Boolean(activeAttendance);
  const checkOutDisabled = !activeAttendance;

  const markAttendance = async (status) => {
    if (checkInDisabled || savingAttendance) return;
    const record = {
      id: uid("ATT"),
      employeeId: currentEmployee.id,
      employeeName: currentEmployee.name,
      date: today(),
      status,
      checkIn: new Date().toTimeString().slice(0, 5),
      checkOut: ""
    };
    setSavingAttendance(true);
    try {
      const saved = await commit((current) => {
        const attendance = (current.attendance || []).filter((item) => item.id !== record.id);
        attendance.unshift(record);
        return { ...current, attendance };
      });
      if (saved !== false) toast(status === "Work From Home" ? "Work from home marked." : "Check-in marked.");
    } finally {
      setSavingAttendance(false);
    }
  };

  const checkoutAttendance = async () => {
    if (checkOutDisabled || savingAttendance) return;
    const now = new Date().toTimeString().slice(0, 5);
    setSavingAttendance(true);
    try {
      const saved = await commit((current) => {
        const existingIndex = (current.attendance || []).findIndex((item) => item.id === activeAttendance.id);
        if (existingIndex < 0) return current;
        const attendance = [...current.attendance];
        attendance[existingIndex] = {
          ...attendance[existingIndex],
          status: "Checked Out",
          checkOut: now
        };
        return { ...current, attendance };
      });
      if (saved !== false) toast("Check-out marked.");
    } finally {
      setSavingAttendance(false);
    }
  };

  return (
    <Panel title="Today Attendance">
      <div className="attendance-actions">
        <button className="primary-button" onClick={() => markAttendance("Checked In")} disabled={checkInDisabled || savingAttendance}>Check In</button>
        <button className="secondary-button" onClick={() => markAttendance("Work From Home")} disabled={checkInDisabled || savingAttendance}>Work From Home</button>
        <button className="secondary-button checkout-button" onClick={checkoutAttendance} disabled={checkOutDisabled || savingAttendance}>Check Out</button>
      </div>
      <DataTable rows={employeeAttendance} columns={["date", "status", "checkIn", "checkOut"]} />
    </Panel>
  );
}

function LeaveFormPanel({ commit, currentEmployee }) {
  const [leave, setLeave] = useState({ type: "Casual Leave", duration: "Full Day Leave", from: "", to: "", reason: "" });

  const applyLeave = (event) => {
    event.preventDefault();
    if (!leave.reason.trim()) {
      toast("Enter a leave reason before applying.", "error");
      return;
    }
    commit((current) => ({
      ...current,
      leaves: [{ id: uid("LV"), employeeId: currentEmployee.id, employeeName: currentEmployee.name, ...leave, status: "Pending", appliedAt: today() }, ...current.leaves]
    }));
    toast("Leave application submitted.");
    setLeave({ type: "Casual Leave", duration: "Full Day Leave", from: "", to: "", reason: "" });
  };

  return (
    <Panel title="Apply Leave" className="full-row-panel">
      <form className="form-grid" onSubmit={applyLeave}>
        <select value={leave.type} onChange={(event) => setLeave({ ...leave, type: event.target.value })}><option>Casual Leave</option><option>Sick Leave</option><option>Earned Leave</option></select>
        <select value={leave.duration} onChange={(event) => setLeave({ ...leave, duration: event.target.value })}><option>Full Day Leave</option><option>Half Day Leave</option></select>
        <input type="date" value={dateInputValue(leave.from)} onChange={(event) => setLeave({ ...leave, from: event.target.value })} />
        <input type="date" value={dateInputValue(leave.to)} onChange={(event) => setLeave({ ...leave, to: event.target.value })} />
        <input placeholder="Reason" value={leave.reason} onChange={(event) => setLeave({ ...leave, reason: event.target.value })} />
        <button className="primary-button">Apply Leave</button>
      </form>
    </Panel>
  );
}

function ExpenseFormPanel({ commit, currentEmployee }) {
  const [expense, setExpense] = useState({ category: "Uber", amount: "", date: "", notes: "" });
  const [receipt, setReceipt] = useState(null);
  const [receiptError, setReceiptError] = useState("");

  const handleReceipt = async (event) => {
    const file = event.target.files?.[0];
    setReceipt(null);
    setReceiptError("");
    if (!file) return;
    const allowed = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!allowed) {
      setReceiptError("Upload an image or PDF receipt.");
      toast("Upload an image or PDF receipt.", "error");
      event.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setReceiptError("Receipt must be 2 MB or smaller for web storage.");
      toast("Receipt must be 2 MB or smaller.", "error");
      event.target.value = "";
      return;
    }
    try {
      setReceipt({ name: file.name, type: file.type, size: file.size, dataUrl: await fileToDataUrl(file) });
      toast("Receipt uploaded.");
    } catch {
      setReceiptError("Could not read this receipt. Please try another file.");
      toast("Could not read this receipt.", "error");
    }
  };

  const submitExpense = (event) => {
    event.preventDefault();
    if (!expense.amount || !receipt) {
      if (!receipt) setReceiptError("Add the receipt before submitting the expense.");
      toast(!expense.amount ? "Enter expense amount before submitting." : "Add the receipt before submitting.", "error");
      return;
    }
    commit((current) => ({
      ...current,
      expenses: [{ id: uid("EXP"), employeeId: currentEmployee.id, employeeName: currentEmployee.name, ...expense, amount: Number(expense.amount), receipt, status: "Pending", submittedAt: today() }, ...current.expenses]
    }));
    toast("Expense submitted for approval.");
    setExpense({ category: "Uber", amount: "", date: "", notes: "" });
    setReceipt(null);
    setReceiptError("");
    event.currentTarget.reset();
  };

  return (
    <Panel title="Add Expense" className="full-row-panel">
      <form className="form-grid expense-entry-form" onSubmit={submitExpense}>
        <select value={expense.category} onChange={(event) => setExpense({ ...expense, category: event.target.value })}>
          <option>Uber</option><option>Travel</option><option>Food</option><option>Hotel</option><option>Internet</option><option>Other</option>
        </select>
        <input type="number" placeholder="Amount" value={expense.amount} onChange={(event) => setExpense({ ...expense, amount: event.target.value })} />
        <input type="date" value={dateInputValue(expense.date)} onChange={(event) => setExpense({ ...expense, date: event.target.value })} />
        <input placeholder="Notes" value={expense.notes} onChange={(event) => setExpense({ ...expense, notes: event.target.value })} />
        <label className="receipt-field">
          <span>Receipt</span>
          <input type="file" accept="image/*,.pdf,application/pdf" onChange={handleReceipt} />
          <small>{receipt ? receipt.name : "Image or PDF, max 2 MB"}</small>
          {receiptError && <em>{receiptError}</em>}
        </label>
        <button className="primary-button expense-submit-button">Submit Expense</button>
      </form>
    </Panel>
  );
}

function DashboardGrid({ children }) {
  return <section className="dashboard-grid">{children}</section>;
}

function Panel({ title, children, className = "" }) {
  return (
    <section className={`panel ${className}`.trim()}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

const employeeColumns = ["id", "name", "email", "accessRole", "department", "role", "salary", "joinedAt", "birthday", "mobile", "alternativeNumber", "aadhaar", "pan", "uan", "experience", "qualification", "college", "address", "status"];

function EmployeeTable({ employees, commit, canDelete = false, className = "" }) {
  const [editingEmployee, setEditingEmployee] = useState(null);

  const deleteEmployee = (employeeId) => {
    if (!canDelete || !commit) return;
    const employeeToDelete = employees.find((employee) => employee.id === employeeId);
    const employeeEmail = employeeToDelete?.email?.toLowerCase();
    commit((current) => ({
      ...current,
      employees: current.employees.filter((employee) => employee.id !== employeeId),
      leaves: current.leaves.filter((leave) => leave.employeeId !== employeeId),
      expenses: current.expenses.filter((expense) => expense.employeeId !== employeeId),
      attendance: current.attendance.filter((record) => record.employeeId !== employeeId),
      logins: (current.logins || []).filter((login) => login.employeeId !== employeeId && login.email?.toLowerCase() !== employeeEmail)
    }));
    toast("Employee deleted.");
  };

  const updateEmployee = (updatedEmployee) => {
    if (!canDelete || !commit || !editingEmployee) return;
    const previousEmail = editingEmployee.email?.toLowerCase();
    const nextEmail = updatedEmployee.email?.toLowerCase();

    commit((current) => {
      const existingLogin = (current.logins || []).find((login) => (
        login.employeeId === updatedEmployee.id ||
        login.email?.toLowerCase() === previousEmail ||
        login.email?.toLowerCase() === nextEmail
      ));

      const syncedLogin = {
        id: existingLogin?.id || uid("LOGIN"),
        name: updatedEmployee.name,
        email: updatedEmployee.email,
        accessRole: updatedEmployee.accessRole,
        employeeId: updatedEmployee.id,
        status: updatedEmployee.status || existingLogin?.status || "Active"
      };

      return {
        ...current,
        employees: (current.employees || []).map((employee) => (
          employee.id === updatedEmployee.id ? updatedEmployee : employee
        )),
        logins: [
          syncedLogin,
          ...(current.logins || []).filter((login) => (
            login.id !== existingLogin?.id &&
            login.employeeId !== updatedEmployee.id &&
            login.email?.toLowerCase() !== previousEmail &&
            login.email?.toLowerCase() !== nextEmail
          ))
        ]
      };
    });

    setEditingEmployee(null);
    toast("Employee profile updated.");
  };

  if (!canDelete) {
    return (
      <Panel title="Employee Directory" className={className}>
        <DataTable rows={employees} columns={employeeColumns} className="employee-records" />
      </Panel>
    );
  }

  return (
    <Panel title="Employee Directory" className={className}>
      {employees.length ? (
        <div className="data-table employee-records">
          <div className="data-head">
            <span>id</span>
            <span>name</span>
            <span>email</span>
            <span>login</span>
            <span>department</span>
            <span>role</span>
            <span>salary</span>
            <span>joining</span>
            <span>birthday</span>
            <span>mobile</span>
            <span>alt number</span>
            <span>Aadhaar</span>
            <span>PAN</span>
            <span>UAN</span>
            <span>experience</span>
            <span>qualification</span>
            <span>college</span>
            <span>address</span>
            <span>status</span>
            <span>action</span>
          </div>
          {employees.map((employee) => (
            <div className="data-row" key={employee.id}>
              <span>{employee.id}</span>
              <span>{employee.name}</span>
              <span>{employee.email}</span>
              <span>{roles[employee.accessRole]?.title || "Employee"}</span>
              <span>{employee.department}</span>
              <span>{employee.role}</span>
              <span>{money(employee.salary)}</span>
              <span>{employee.joinedAt || "--"}</span>
              <span>{employee.birthday || "--"}</span>
              <span>{employee.mobile || "--"}</span>
              <span>{employee.alternativeNumber || "--"}</span>
              <span>{employee.aadhaar || "--"}</span>
              <span>{employee.pan || "--"}</span>
              <span>{employee.uan || "--"}</span>
              <span>{employee.experience || "--"}</span>
              <span>{employee.qualification || "--"}</span>
              <span>{employee.college || "--"}</span>
              <span>{employee.address || "--"}</span>
              <span>{employee.status}</span>
              <span className="employee-action-buttons">
                <button className="icon-action" type="button" aria-label={`Edit ${employee.name}`} title="Edit employee" onClick={() => setEditingEmployee(employee)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </button>
                <button className="icon-action danger" type="button" aria-label={`Delete ${employee.name}`} title="Delete employee" onClick={() => deleteEmployee(employee.id)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7h16" />
                    <path d="M9 7V5h6v2" />
                    <path d="M6 7l1 14h10l1-14" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : <p className="empty-note">No employees yet.</p>}
      {editingEmployee ? (
        <EmployeeEditModal
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          onSave={updateEmployee}
        />
      ) : null}
    </Panel>
  );
}

function EmployeeEditModal({ employee, onClose, onSave }) {
  const [form, setForm] = useState({
    name: employee.name || "",
    email: employee.email || "",
    accessRole: employee.accessRole || "employee",
    department: employee.department || "",
    role: employee.role || "",
    salary: employee.salary ?? "",
    joinedAt: employee.joinedAt || "",
    birthday: employee.birthday || "",
    mobile: employee.mobile || "",
    alternativeNumber: employee.alternativeNumber || "",
    aadhaar: employee.aadhaar || "",
    pan: employee.pan || "",
    uan: employee.uan || "",
    experience: employee.experience || "",
    qualification: employee.qualification || "",
    college: employee.college || "",
    address: employee.address || "",
    status: employee.status || "Active"
  });

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submitEdit = (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast("Enter employee name and email.", "error");
      return;
    }

    onSave({
      ...employee,
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      accessRole: form.accessRole,
      department: form.department.trim() || "General",
      role: form.role.trim() || "Employee",
      salary: Number(form.salary || 0),
      joinedAt: form.joinedAt.trim(),
      birthday: form.birthday.trim(),
      mobile: form.mobile.trim(),
      alternativeNumber: form.alternativeNumber.trim(),
      aadhaar: form.aadhaar.trim(),
      pan: form.pan.trim(),
      uan: form.uan.trim(),
      experience: form.experience.trim(),
      qualification: form.qualification.trim(),
      college: form.college.trim(),
      address: form.address.trim(),
      status: form.status || "Active"
    });
  };

  return (
    <div className="receipt-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="receipt-modal employee-edit-modal" role="dialog" aria-modal="true" aria-label="Edit employee profile" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>Edit Employee Profile</h2>
            <p>{employee.email}</p>
          </div>
          <button type="button" className="icon-action" aria-label="Close employee editor" title="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </header>
        <form className="form-grid employee-form-grid employee-edit-form" onSubmit={submitEdit}>
          <label>Name<input value={form.name} onChange={(event) => updateField("name", event.target.value)} /></label>
          <label>Email<input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} /></label>
          <label>Dashboard Access<select value={form.accessRole} onChange={(event) => updateField("accessRole", event.target.value)}><option value="employee">Employee</option><option value="hr">HR / Accountant</option><option value="admin">Admin</option></select></label>
          <label>Department<input value={form.department} onChange={(event) => updateField("department", event.target.value)} /></label>
          <label>Role<input value={form.role} onChange={(event) => updateField("role", event.target.value)} /></label>
          <label>Salary<input type="number" min="0" value={form.salary} onChange={(event) => updateField("salary", event.target.value)} /></label>
          <label>Date of Joining<input type="date" value={dateInputValue(form.joinedAt)} onChange={(event) => updateField("joinedAt", event.target.value)} /></label>
          <label>Birthday<input type="date" value={dateInputValue(form.birthday)} onChange={(event) => updateField("birthday", event.target.value)} /></label>
          <label>Mobile<input value={form.mobile} onChange={(event) => updateField("mobile", event.target.value)} /></label>
          <label>Alternative Number<input value={form.alternativeNumber} onChange={(event) => updateField("alternativeNumber", event.target.value)} /></label>
          <label>Aadhaar Number<input value={form.aadhaar} onChange={(event) => updateField("aadhaar", event.target.value)} /></label>
          <label>PAN<input value={form.pan} onChange={(event) => updateField("pan", event.target.value)} /></label>
          <label>UAN<input value={form.uan} onChange={(event) => updateField("uan", event.target.value)} /></label>
          <label>Experience<input value={form.experience} onChange={(event) => updateField("experience", event.target.value)} /></label>
          <label>Qualification<input value={form.qualification} onChange={(event) => updateField("qualification", event.target.value)} /></label>
          <label>College<input value={form.college} onChange={(event) => updateField("college", event.target.value)} /></label>
          <label>Status<select value={form.status} onChange={(event) => updateField("status", event.target.value)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
          <label className="wide-input">Address<textarea value={form.address} onChange={(event) => updateField("address", event.target.value)} /></label>
          <div className="modal-form-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button">Save Profile</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function LedgerTable({ store, className = "" }) {
  const debitLedger = (store.ledger || []).filter((item) => String(item.type || "Debit").toLowerCase() === "debit");
  return (
    <Panel title="Debit Ledger Records" className={className}>
      <DataTable rows={debitLedger} columns={["id", "type", "date", "account", "category", "amount", "note"]} />
    </Panel>
  );
}

function LeaveTable({ leaves, title = "Leave Records" }) {
  return (
    <Panel title={title}>
      <DataTable rows={leaves} columns={["id", "employeeName", "type", "duration", "from", "to", "reason", "status"]} />
    </Panel>
  );
}

function ExpenseTable({ expenses, title = "Expense Records", className = "" }) {
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const filteredExpenses = expenses.filter((expense) => (
    isSameRecordMonth(expense.date || expense.submittedAt, selectedMonth) &&
    isSameRecordDate(expense.date || expense.submittedAt, selectedDate)
  ));

  if (!expenses.length) {
    return (
      <Panel title={title} className={className}>
        <p className="empty-note">No records yet.</p>
      </Panel>
    );
  }

  return (
    <Panel title={title} className={className}>
      <div className="table-filter-bar">
        <label>Month<input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></label>
        <label>Date<input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
        <button type="button" className="secondary-button" onClick={() => { setSelectedMonth(""); setSelectedDate(""); }}>Clear</button>
      </div>
      {filteredExpenses.length ? (
        <div className="data-table expense-records">
          <div className="data-head">
            <span>id</span>
            <span>employee</span>
            <span>category</span>
            <span>date</span>
            <span>amount</span>
            <span>notes</span>
            <span>receipt</span>
            <span>status</span>
          </div>
          {filteredExpenses.map((expense) => (
            <div className="data-row" key={expense.id}>
              <span>{expense.id}</span>
              <span>{expense.employeeName}</span>
              <span>{expense.category}</span>
              <span>{expense.date || expense.submittedAt || "--"}</span>
              <span>{money(expense.amount)}</span>
              <span>{expense.notes || "--"}</span>
              <span>{expense.receipt ? <button type="button" className="table-action" onClick={() => setReceiptPreview(expense.receipt)}>View Receipt</button> : "--"}</span>
              <span><Status status={expense.status} /></span>
            </div>
          ))}
        </div>
      ) : <p className="empty-note">No records match the selected date filters.</p>}
      {receiptPreview && (
        <ReceiptPreviewModal receipt={receiptPreview} onClose={() => setReceiptPreview(null)} />
      )}
    </Panel>
  );
}

function ReceiptPreviewModal({ receipt, onClose }) {
  const isPdf = receipt.type === "application/pdf" || receipt.name?.toLowerCase().endsWith(".pdf");

  return (
    <div className="receipt-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="receipt-modal" role="dialog" aria-modal="true" aria-label="Receipt preview" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>Receipt Preview</h2>
            <p>{receipt.name || "Uploaded receipt"}</p>
          </div>
          <button type="button" className="icon-action" aria-label="Close receipt preview" title="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="receipt-preview-frame">
          {!receipt.dataUrl ? (
            <p className="empty-note">Receipt data is unavailable for this record.</p>
          ) : isPdf ? (
            <iframe title={receipt.name || "Receipt PDF"} src={receipt.dataUrl} />
          ) : (
            <img src={receipt.dataUrl} alt={receipt.name || "Receipt"} />
          )}
        </div>
        {receipt.dataUrl && (
          <a className="secondary-button receipt-download-link" href={receipt.dataUrl} download={receipt.name || "receipt"}>
            Download Receipt
          </a>
        )}
      </section>
    </div>
  );
}

function AttendanceTable({ attendance, title = "Attendance Records", className = "" }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const filteredAttendance = fromDate || toDate
    ? attendance.filter((record) => isWithinDateRange(record.date, fromDate, toDate))
    : attendance;

  return (
    <Panel title={title} className={className}>
      <div className="table-filter-bar">
        <label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label>To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <button type="button" className="secondary-button" onClick={() => { setFromDate(""); setToDate(""); }}>Clear</button>
      </div>
      <DataTable rows={filteredAttendance} columns={["id", "employeeName", "date", "status", "checkIn", "checkOut"]} className="attendance-records" />
    </Panel>
  );
}

function getTotals(rows) {
  return rows.reduce((summary, item) => {
    if (item.source === "Expense" && item.status !== "Approved") return summary;
    summary[item.type.toLowerCase()] += Number(item.amount);
    return summary;
  }, { credit: 0, debit: 0 });
}

function FinancePanel({ store, canExport = false, className = "" }) {
  const financeRows = buildFinanceRows(store);
  const totals = getTotals(financeRows);
  const approvedExpenses = (store.expenses || []).filter((item) => item.status === "Approved").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingExpenses = (store.expenses || []).filter((item) => item.status === "Pending").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const adminHrExpenses = (store.expenses || []).filter((item) => item.status === "Approved" && item.createdBy !== "Employee").reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const downloadPeriodReport = (period) => {
    const label = `${period.charAt(0).toUpperCase()}${period.slice(1)} Finance Report`;
    const periodFinanceRows = financeRows.filter((row) => isWithinPeriod(row.date, period));
    const periodExpenses = (store.expenses || []).filter((item) => isWithinPeriod(item.date || item.submittedAt, period)).map((item) => ({
      ...item,
      receiptName: item.receipt?.name || ""
    }));
    const periodLedger = (store.ledger || []).filter((item) => isWithinPeriod(item.date, period));
    const periodLeaves = (store.leaves || []).filter((item) => isWithinPeriod(item.appliedAt || item.from, period));
    const periodAttendance = (store.attendance || []).filter((item) => isWithinPeriod(item.date, period));

    downloadExcelReport(`inspite-${period}-finance-report.xls`, label, [
      { title: "Finance Register", columns: financeExportColumns, rows: periodFinanceRows },
      { title: "Expenses", columns: expenseCsvColumns, rows: periodExpenses },
      { title: "Ledger", columns: ledgerCsvColumns, rows: periodLedger },
      { title: "Leaves", columns: ["id", "employeeName", "type", "duration", "from", "to", "reason", "status", "appliedAt"], rows: periodLeaves },
      { title: "Attendance", columns: ["id", "employeeName", "date", "status", "checkIn", "checkOut"], rows: periodAttendance }
    ]);
  };

  return (
    <Panel title="Debit Finance Register" className={className}>
      <div className="finance-summary">
        <Metric label="Debit" value={money(totals.debit)} />
        <Metric label="Approved Expenses" value={money(approvedExpenses)} />
        <Metric label="Pending Expenses" value={money(pendingExpenses)} />
        <Metric label="Admin / HR Expenses" value={money(adminHrExpenses)} />
        <Metric label="Finance Rows" value={financeRows.length} />
      </div>
      <div className="finance-export-actions">
        <button className="secondary-button" onClick={() => downloadPeriodReport("weekly")}>Weekly Excel</button>
        <button className="secondary-button" onClick={() => downloadPeriodReport("monthly")}>Monthly Excel</button>
        <button className="secondary-button" onClick={() => downloadPeriodReport("yearly")}>Yearly Excel</button>
        <button className="secondary-button" onClick={() => downloadCsv("credit-debit-ledger.csv", store.ledger, ledgerCsvColumns)}>Export Ledger CSV</button>
        {canExport && <button className="secondary-button" onClick={() => downloadCsv("employee-expenses.csv", store.expenses, expenseCsvColumns)}>Export Expenses CSV</button>}
      </div>
      <DataTable rows={financeRows} columns={financeExportColumns} />
    </Panel>
  );
}

function ApprovalPanel({ title, items, kind, commit, className = "" }) {
  const updateStatus = (id, status) => {
    commit((current) => {
      const targetItem = current[kind].find((item) => item.id === id);
      const nextItems = current[kind].map((item) => item.id === id ? { ...item, status } : item);
      if (kind !== "expenses" || status !== "Approved" || !targetItem) {
        return { ...current, [kind]: nextItems };
      }

      const alreadyInLedger = (current.ledger || []).some((ledgerItem) => ledgerItem.sourceExpenseId === targetItem.id);
      if (alreadyInLedger) {
        return { ...current, [kind]: nextItems };
      }

      const approvedExpense = { ...targetItem, status };
      return {
        ...current,
        [kind]: nextItems,
        ledger: [ledgerEntryFromExpense(approvedExpense, "Approval"), ...(current.ledger || [])]
      };
    });
    toast(`${kind === "leaves" ? "Leave" : "Expense"} ${status.toLowerCase()}.`);
  };

  return (
    <Panel title={title} className={className}>
      <div className="approval-list">
        {items.length ? items.map((item) => (
          <article className="approval-row" key={item.id}>
            <div>
              <strong>{item.employeeName}</strong>
              <span>{item.type || item.category} {item.duration ? `- ${item.duration}` : ""} {item.amount ? `- ${money(item.amount)}` : ""}</span>
              <small>{item.reason || item.notes || `${item.from || item.date} to ${item.to || item.date}`}</small>
            </div>
            <Status status={item.status} />
            <button onClick={() => updateStatus(item.id, "Approved")} disabled={item.status === "Approved"}>Approve</button>
            <button onClick={() => updateStatus(item.id, "Rejected")} disabled={item.status === "Rejected"}>Reject</button>
          </article>
        )) : <p className="empty-note">No records yet.</p>}
      </div>
    </Panel>
  );
}

function Status({ status }) {
  return <span className={`status ${String(status).toLowerCase()}`}>{status}</span>;
}

function DataTable({ rows, columns, className = "" }) {
  if (!rows.length) return <p className="empty-note">No records yet.</p>;
  return (
    <div className={`data-table ${className}`.trim()}>
      <div className="data-head" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(130px, 1fr))` }}>
        {columns.map((column) => <span key={column}>{column}</span>)}
      </div>
      {rows.map((row, index) => (
        <div className="data-row" key={row.id || index} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(130px, 1fr))` }}>
          {columns.map((column) => <span key={column}>{column === "salary" || column === "amount" ? money(row[column]) : row[column] || "--"}</span>)}
        </div>
      ))}
    </div>
  );
}

export default App;
