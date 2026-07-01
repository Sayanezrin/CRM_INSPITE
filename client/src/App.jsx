import React, { useEffect, useState } from "react";
import inspiteLogoImage from "./assets/inspite-logo.png";

const STORAGE_KEY = "inspite.people.role.portal";
const SESSION_KEY = "inspite.people.role.session";
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:5018";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

const roles = {
  admin: { title: "Admin", email: "sayanezrin@gmail.com", password: "admin123" },
  hr: { title: "HR / Accountant", email: "hr@inspite.local", password: "hr123" },
  employee: { title: "Employee", email: "employee@inspite.local", password: "emp123" }
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
  return new Date().toISOString().slice(0, 10);
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
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
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

function downloadCsv(filename, rows, columns) {
  const headers = columns || Object.keys(rows[0] || {});
  if (!headers.length) return;
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
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function viewReceipt(receipt) {
  if (!receipt?.dataUrl) return;
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  if (receipt.type === "application/pdf") {
    win.document.write(`<iframe title="Receipt" src="${receipt.dataUrl}" style="border:0;width:100%;height:100vh"></iframe>`);
    return;
  }
  win.document.write(`<img alt="Receipt" src="${receipt.dataUrl}" style="max-width:100%;height:auto;display:block;margin:0 auto" />`);
}

function loadGoogleIdentityScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve(window.google);
      return;
    }
    const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.google), { once: true });
      existingScript.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function App() {
  const [store, setStore] = useState(readState);
  const [session, setSession] = useState(readSession);
  const [activePage, setActivePage] = useState("home");
  const [apiConnected, setApiConnected] = useState(false);

  useEffect(() => {
    if (!session?.token) return;
    let cancelled = false;
    let retryTimer;

    const loadPortal = () => {
      apiJson("/api/portal")
        .then((payload) => {
          if (cancelled) return;
          setApiConnected(true);
          if (hasPortalData(payload)) {
            const nextPayload = { ...seedState, ...payload, logins: payload.logins || [] };
            setStore(nextPayload);
            writeState(nextPayload);
            return;
          }
          savePortalState(readState());
        })
        .catch(() => {
          if (cancelled) return;
          setApiConnected(false);
          retryTimer = window.setTimeout(loadPortal, 3000);
        });
    };

    loadPortal();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
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
      savePortalState(next);
      return next;
    });
  };

  if (!session) {
    return <LoginScreen onLogin={(nextSession) => { writeSession(nextSession); setSession(nextSession); setActivePage("home"); }} />;
  }

  return (
    <div className="portal-shell">
      <Sidebar session={session} activePage={activePage} onPageChange={setActivePage} onLogout={() => { writeSession(null); setSession(null); }} />
      <main className="portal-main">
        <Header session={session} store={store} activePage={activePage} apiConnected={apiConnected} />
        <RolePage session={session} activePage={activePage} store={store} commit={commit} />
      </main>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [selectedRole, setSelectedRole] = useState("admin");
  const [form, setForm] = useState({ email: roles.admin.email, password: roles.admin.password });
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const selectRole = (role) => {
    setSelectedRole(role);
    setForm({ email: roles[role].email, password: roles[role].password });
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    try {
      const login = await apiJson("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ email: form.email, password: form.password, selectedRole })
      });
      onLogin({ ...login.user, token: login.token });
    } catch {
      setError("This email is not allowed for the selected dashboard.");
    }
  };

  const googleSignIn = async () => {
    setError("");
    if (!GOOGLE_CLIENT_ID) {
      setError("Google login needs VITE_GOOGLE_CLIENT_ID in client/.env.local.");
      return;
    }
    try {
      const google = await loadGoogleIdentityScript();
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        auto_select: false,
        callback: async (credentialResponse) => {
          if (!credentialResponse.credential) {
            setError("Google sign-in was cancelled.");
            return;
          }
          try {
            const login = await apiJson("/api/auth/google", {
              method: "POST",
              body: JSON.stringify({ credential: credentialResponse.credential, selectedRole })
            });
            onLogin({ ...login.user, token: login.token });
          } catch {
            setError("This Google account is not registered for the selected dashboard.");
          }
        }
      });
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          setError("Google account chooser could not open. Check Google OAuth origin setup.");
        }
      });
    } catch {
      setError("Could not open Google account chooser.");
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
        <div className="google-login-box">
          <button type="button" className="google-login-button" onClick={googleSignIn}><span>G</span>Continue with Google</button>
          <small>Server verifies Google and allows only registered role emails.</small>
        </div>
        <div className="login-divider"><span>or use password</span></div>
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
          <span>Admin password: admin123</span>
          <span>HR / Accountant password: hr123</span>
          <span>Employee password: emp123</span>
        </div>
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

function Header({ session, store, activePage, apiConnected }) {
  const approvedExpenses = store.expenses.filter((item) => item.status === "Approved").reduce((sum, item) => sum + Number(item.amount), 0);
  const pendingApprovals = store.expenses.filter((item) => item.status === "Pending").length + store.leaves.filter((item) => item.status === "Pending").length;
  const pageTitle = getNavItemsForRole(session.role).find((item) => item.id === activePage)?.label || "Home";
  return (
    <header className="page-header">
      <div>
        <p>{session.email}</p>
        <h1>{session.name} - {pageTitle}</h1>
        <span className={`api-status ${apiConnected ? "online" : "offline"}`}>{apiConnected ? "Backend storage connected" : "Offline fallback storage"}</span>
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

function RolePage({ session, activePage, store, commit }) {
  if (session.role === "admin") return <AdminPage activePage={activePage} store={store} commit={commit} session={session} />;
  if (session.role === "hr") return <HrPage activePage={activePage} store={store} commit={commit} session={session} />;
  return <EmployeePage activePage={activePage} store={store} commit={commit} session={session} />;
}

function AdminPage({ activePage, store, commit, session }) {
  if (activePage === "logins") return <DashboardGrid><AddLoginPanel commit={commit} /><LoginAccessTable logins={store.logins || []} commit={commit} className="full-row-panel" /></DashboardGrid>;
  if (activePage === "employees") return <DashboardGrid><AddEmployeePanel commit={commit} /><EmployeeTable employees={store.employees} commit={commit} canDelete className="full-row-panel" /></DashboardGrid>;
  if (activePage === "finance") return <DashboardGrid><FinancePanel store={store} canExport className="full-row-panel" /><LedgerTable store={store} className="full-row-panel" /></DashboardGrid>;
  if (activePage === "leave") return <DashboardGrid><ApprovalPanel title="Leave Applications" items={store.leaves} kind="leaves" commit={commit} /><LeaveTable leaves={store.leaves} /></DashboardGrid>;
  if (activePage === "expenses") return <DashboardGrid><AdminExpenseFormPanel store={store} commit={commit} /><ApprovalPanel title="Expense Approvals" items={store.expenses} kind="expenses" commit={commit} className="full-row-panel" /><ExpenseTable expenses={store.expenses} className="full-row-panel" /></DashboardGrid>;
  if (activePage === "attendance") return <AttendancePage store={store} commit={commit} session={session} />;
  return <AdminHome store={store} commit={commit} />;
}

function HrPage({ activePage, store, commit, session }) {
  if (activePage === "employees") return <DashboardGrid><EmployeeTable employees={store.employees} /></DashboardGrid>;
  if (activePage === "leave") return <DashboardGrid><LeaveTable leaves={store.leaves} /></DashboardGrid>;
  if (activePage === "expenses") return <DashboardGrid><ApprovalPanel title="Expense Approval Queue" items={store.expenses} kind="expenses" commit={commit} /><ExpenseTable expenses={store.expenses} /></DashboardGrid>;
  if (activePage === "attendance") return <AttendancePage store={store} commit={commit} session={session} />;
  if (activePage === "finance") return <DashboardGrid><LedgerEntryPanel commit={commit} className="full-row-panel" /><FinancePanel store={store} canExport className="full-row-panel" /></DashboardGrid>;
  return <DashboardGrid><FinancePanel store={store} canExport className="full-row-panel" /><ApprovalPanel title="Expense Approval Queue" items={store.expenses} kind="expenses" commit={commit} className="full-row-panel" /></DashboardGrid>;
}

function EmployeePage({ activePage, store, commit, session }) {
  const currentEmployee = getEmployeeForSession(store, session);
  if (!currentEmployee) return <EmployeeProfileMissing session={session} />;
  if (activePage === "employees") return <DashboardGrid><Panel title="My Profile"><DataTable rows={[currentEmployee]} columns={employeeColumns} /></Panel></DashboardGrid>;
  if (activePage === "leave") return <DashboardGrid><LeaveFormPanel store={store} commit={commit} currentEmployee={currentEmployee} /><LeaveTable leaves={store.leaves.filter((item) => item.employeeId === currentEmployee.id)} /></DashboardGrid>;
  if (activePage === "expenses") return <DashboardGrid><ExpenseFormPanel store={store} commit={commit} currentEmployee={currentEmployee} /><ExpenseTable expenses={store.expenses.filter((item) => item.employeeId === currentEmployee.id)} /></DashboardGrid>;
  if (activePage === "attendance") return <DashboardGrid><EmployeeAttendancePanel store={store} commit={commit} currentEmployee={currentEmployee} /></DashboardGrid>;
  return <EmployeeHome store={store} commit={commit} currentEmployee={currentEmployee} />;
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
    pan: "",
    uan: "",
    experience: "",
    qualification: "",
    college: "",
    address: "",
    status: login.status || "Active"
  };
}

function AttendancePage({ store, commit, session }) {
  const currentEmployee = getEmployeeForSession(store, session);
  return (
    <DashboardGrid>
      {currentEmployee ? (
        <EmployeeAttendancePanel store={store} commit={commit} currentEmployee={currentEmployee} />
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
  const totals = getTotals(store);
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

function EmployeeHome({ store, commit, currentEmployee }) {
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
      <EmployeeAttendancePanel store={store} commit={commit} currentEmployee={currentEmployee} />
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
    if (!login.name.trim() || !login.email.trim()) return;
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
    joinedAt: today(),
    birthday: "",
    address: "",
    mobile: "",
    alternativeNumber: "",
    pan: "",
    uan: "",
    experience: "",
    qualification: "",
    college: ""
  };
  const [employee, setEmployee] = useState(blankEmployee);

  const addEmployee = (event) => {
    event.preventDefault();
    if (!employee.name.trim() || !employee.email.trim()) return;
    commit((current) => ({
      ...current,
      employees: [
        {
          id: uid("EMP"),
          name: employee.name.trim(),
          email: employee.email.trim(),
          accessRole: employee.accessRole,
          department: employee.department || "General",
          role: employee.role || "Employee",
          salary: Number(employee.salary || 0),
          joinedAt: employee.joinedAt,
          birthday: employee.birthday,
          address: employee.address.trim(),
          mobile: employee.mobile.trim(),
          alternativeNumber: employee.alternativeNumber.trim(),
          pan: employee.pan.trim(),
          uan: employee.uan.trim(),
          experience: employee.experience.trim(),
          qualification: employee.qualification.trim(),
          college: employee.college.trim(),
          status: "Active"
        },
        ...current.employees
      ]
    }));
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
        <label>Date of joining<input type="date" value={employee.joinedAt} onChange={(event) => setEmployee({ ...employee, joinedAt: event.target.value })} /></label>
        <label>Birthday<input type="date" value={employee.birthday} onChange={(event) => setEmployee({ ...employee, birthday: event.target.value })} /></label>
        <input placeholder="Mobile number" value={employee.mobile} onChange={(event) => setEmployee({ ...employee, mobile: event.target.value })} />
        <input placeholder="Alternative number" value={employee.alternativeNumber} onChange={(event) => setEmployee({ ...employee, alternativeNumber: event.target.value })} />
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
  const [entry, setEntry] = useState({ type: "Credit", amount: "", account: "", category: "", note: "", date: today() });

  const addLedger = (event) => {
    event.preventDefault();
    if (!entry.amount || !entry.account.trim()) return;
    commit((current) => ({
      ...current,
      ledger: [{ id: uid("TXN"), ...entry, amount: Number(entry.amount), createdBy: "HR" }, ...current.ledger]
    }));
    setEntry({ type: "Credit", amount: "", account: "", category: "", note: "", date: today() });
  };

  return (
    <Panel title="Credit / Debit Entry" className={className}>
      <form className="form-grid" onSubmit={addLedger}>
        <select value={entry.type} onChange={(event) => setEntry({ ...entry, type: event.target.value })}><option>Credit</option><option>Debit</option></select>
        <input type="number" placeholder="Amount" value={entry.amount} onChange={(event) => setEntry({ ...entry, amount: event.target.value })} />
        <input placeholder="Account" value={entry.account} onChange={(event) => setEntry({ ...entry, account: event.target.value })} />
        <input placeholder="Category" value={entry.category} onChange={(event) => setEntry({ ...entry, category: event.target.value })} />
        <input type="date" value={entry.date} onChange={(event) => setEntry({ ...entry, date: event.target.value })} />
        <input placeholder="Note" value={entry.note} onChange={(event) => setEntry({ ...entry, note: event.target.value })} />
        <button className="primary-button">Save to Ledger</button>
      </form>
    </Panel>
  );
}

function AdminExpenseFormPanel({ store, commit }) {
  const [expense, setExpense] = useState({ employeeId: "company", category: "Travel", amount: "", date: today(), notes: "" });

  const addExpense = (event) => {
    event.preventDefault();
    if (!expense.amount) return;
    const selectedEmployee = store.employees.find((employee) => employee.id === expense.employeeId);
    commit((current) => ({
      ...current,
      expenses: [{
        id: uid("EXP"),
        employeeId: selectedEmployee?.id || "ADMIN",
        employeeName: selectedEmployee?.name || "Admin / Company",
        category: expense.category,
        amount: Number(expense.amount),
        date: expense.date,
        notes: expense.notes.trim(),
        status: "Approved",
        submittedAt: today(),
        createdBy: "Admin"
      }, ...current.expenses]
    }));
    setExpense({ employeeId: "company", category: "Travel", amount: "", date: today(), notes: "" });
  };

  return (
    <Panel title="Add Expense" className="full-row-panel">
      <form className="form-grid" onSubmit={addExpense}>
        <select value={expense.employeeId} onChange={(event) => setExpense({ ...expense, employeeId: event.target.value })}>
          <option value="company">Admin / Company Expense</option>
          {store.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select>
        <select value={expense.category} onChange={(event) => setExpense({ ...expense, category: event.target.value })}>
          <option>Travel</option>
          <option>Food</option>
          <option>Uber</option>
          <option>Office Supplies</option>
          <option>Salary</option>
          <option>Other</option>
        </select>
        <input type="number" placeholder="Amount" value={expense.amount} onChange={(event) => setExpense({ ...expense, amount: event.target.value })} />
        <input type="date" value={expense.date} onChange={(event) => setExpense({ ...expense, date: event.target.value })} />
        <input className="wide-input" placeholder="Notes" value={expense.notes} onChange={(event) => setExpense({ ...expense, notes: event.target.value })} />
        <button className="primary-button">Add Expense</button>
      </form>
    </Panel>
  );
}

function EmployeeAttendancePanel({ store, commit, currentEmployee }) {
  const markAttendance = (status) => {
    const existingIndex = store.attendance.findIndex((item) => item.employeeId === currentEmployee.id && item.date === today());
    const record = {
      id: existingIndex >= 0 ? store.attendance[existingIndex].id : uid("ATT"),
      employeeId: currentEmployee.id,
      employeeName: currentEmployee.name,
      date: today(),
      status,
      checkIn: new Date().toTimeString().slice(0, 5),
      checkOut: ""
    };
    commit((current) => {
      const attendance = [...current.attendance];
      if (existingIndex >= 0) attendance[existingIndex] = record;
      else attendance.unshift(record);
      return { ...current, attendance };
    });
  };

  const checkoutAttendance = () => {
    const now = new Date().toTimeString().slice(0, 5);
    commit((current) => {
      const existingIndex = current.attendance.findIndex((item) => item.employeeId === currentEmployee.id && item.date === today());
      if (existingIndex < 0) {
        return {
          ...current,
          attendance: [{
            id: uid("ATT"),
            employeeId: currentEmployee.id,
            employeeName: currentEmployee.name,
            date: today(),
            status: "Checked Out",
            checkIn: "",
            checkOut: now
          }, ...current.attendance]
        };
      }
      const attendance = [...current.attendance];
      attendance[existingIndex] = {
        ...attendance[existingIndex],
        status: "Checked Out",
        checkOut: now
      };
      return { ...current, attendance };
    });
  };

  return (
    <Panel title="Today Attendance">
      <div className="attendance-actions">
        <button className="primary-button" onClick={() => markAttendance("Checked In")}>Check In</button>
        <button className="secondary-button" onClick={() => markAttendance("Work From Home")}>Work From Home</button>
        <button className="secondary-button checkout-button" onClick={checkoutAttendance}>Check Out</button>
      </div>
      <DataTable rows={store.attendance.filter((item) => item.employeeId === currentEmployee.id)} columns={["date", "status", "checkIn", "checkOut"]} />
    </Panel>
  );
}

function LeaveFormPanel({ commit, currentEmployee }) {
  const [leave, setLeave] = useState({ type: "Casual Leave", from: today(), to: today(), reason: "" });

  const applyLeave = (event) => {
    event.preventDefault();
    if (!leave.reason.trim()) return;
    commit((current) => ({
      ...current,
      leaves: [{ id: uid("LV"), employeeId: currentEmployee.id, employeeName: currentEmployee.name, ...leave, status: "Pending", appliedAt: today() }, ...current.leaves]
    }));
    setLeave({ type: "Casual Leave", from: today(), to: today(), reason: "" });
  };

  return (
    <Panel title="Apply Leave" className="full-row-panel">
      <form className="form-grid" onSubmit={applyLeave}>
        <select value={leave.type} onChange={(event) => setLeave({ ...leave, type: event.target.value })}><option>Casual Leave</option><option>Sick Leave</option><option>Earned Leave</option></select>
        <input type="date" value={leave.from} onChange={(event) => setLeave({ ...leave, from: event.target.value })} />
        <input type="date" value={leave.to} onChange={(event) => setLeave({ ...leave, to: event.target.value })} />
        <input placeholder="Reason" value={leave.reason} onChange={(event) => setLeave({ ...leave, reason: event.target.value })} />
        <button className="primary-button">Apply Leave</button>
      </form>
    </Panel>
  );
}

function ExpenseFormPanel({ commit, currentEmployee }) {
  const [expense, setExpense] = useState({ category: "Uber", amount: "", date: today(), notes: "" });
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
      event.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setReceiptError("Receipt must be 2 MB or smaller for web storage.");
      event.target.value = "";
      return;
    }
    try {
      setReceipt({ name: file.name, type: file.type, size: file.size, dataUrl: await fileToDataUrl(file) });
    } catch {
      setReceiptError("Could not read this receipt. Please try another file.");
    }
  };

  const submitExpense = (event) => {
    event.preventDefault();
    if (!expense.amount || !receipt) {
      if (!receipt) setReceiptError("Add the receipt before submitting the expense.");
      return;
    }
    commit((current) => ({
      ...current,
      expenses: [{ id: uid("EXP"), employeeId: currentEmployee.id, employeeName: currentEmployee.name, ...expense, amount: Number(expense.amount), receipt, status: "Pending", submittedAt: today() }, ...current.expenses]
    }));
    setExpense({ category: "Uber", amount: "", date: today(), notes: "" });
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
        <input type="date" value={expense.date} onChange={(event) => setExpense({ ...expense, date: event.target.value })} />
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

const employeeColumns = ["id", "name", "email", "accessRole", "department", "role", "salary", "joinedAt", "birthday", "mobile", "alternativeNumber", "pan", "uan", "experience", "qualification", "college", "address", "status"];

function EmployeeTable({ employees, commit, canDelete = false, className = "" }) {
  const deleteEmployee = (employeeId) => {
    if (!canDelete || !commit) return;
    commit((current) => ({
      ...current,
      employees: current.employees.filter((employee) => employee.id !== employeeId),
      leaves: current.leaves.filter((leave) => leave.employeeId !== employeeId),
      expenses: current.expenses.filter((expense) => expense.employeeId !== employeeId),
      attendance: current.attendance.filter((record) => record.employeeId !== employeeId)
    }));
  };

  if (!canDelete) {
    return (
      <Panel title="Employee Directory" className={className}>
        <DataTable rows={employees} columns={employeeColumns} />
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
              <span>{employee.pan || "--"}</span>
              <span>{employee.uan || "--"}</span>
              <span>{employee.experience || "--"}</span>
              <span>{employee.qualification || "--"}</span>
              <span>{employee.college || "--"}</span>
              <span>{employee.address || "--"}</span>
              <span>{employee.status}</span>
              <span>
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
    </Panel>
  );
}

function LedgerTable({ store, className = "" }) {
  return (
    <Panel title="Ledger Records" className={className}>
      <DataTable rows={store.ledger} columns={["id", "type", "date", "account", "category", "amount", "note"]} />
    </Panel>
  );
}

function LeaveTable({ leaves, title = "Leave Records" }) {
  return (
    <Panel title={title}>
      <DataTable rows={leaves} columns={["id", "employeeName", "type", "from", "to", "reason", "status"]} />
    </Panel>
  );
}

function ExpenseTable({ expenses, title = "Expense Records", className = "" }) {
  if (!expenses.length) {
    return (
      <Panel title={title} className={className}>
        <p className="empty-note">No records yet.</p>
      </Panel>
    );
  }

  return (
    <Panel title={title} className={className}>
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
        {expenses.map((expense) => (
          <div className="data-row" key={expense.id}>
            <span>{expense.id}</span>
            <span>{expense.employeeName}</span>
            <span>{expense.category}</span>
            <span>{expense.date}</span>
            <span>{money(expense.amount)}</span>
            <span>{expense.notes || "--"}</span>
            <span>{expense.receipt ? <button className="table-action" onClick={() => viewReceipt(expense.receipt)}>View Receipt</button> : "--"}</span>
            <span><Status status={expense.status} /></span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AttendanceTable({ attendance, title = "Attendance Records", className = "" }) {
  return (
    <Panel title={title} className={className}>
      <DataTable rows={attendance} columns={["id", "employeeName", "date", "status", "checkIn", "checkOut"]} />
    </Panel>
  );
}

function getTotals(store) {
  return store.ledger.reduce((summary, item) => {
    summary[item.type.toLowerCase()] += Number(item.amount);
    return summary;
  }, { credit: 0, debit: 0 });
}

function FinancePanel({ store, canExport = false, className = "" }) {
  const totals = getTotals(store);

  return (
    <Panel title="Credit / Debit Ledger" className={className}>
      <div className="finance-summary">
        <Metric label="Credit" value={money(totals.credit)} />
        <Metric label="Debit" value={money(totals.debit)} />
        <Metric label="Total" value={money(totals.credit - totals.debit)} />
        <button className="secondary-button" onClick={() => downloadCsv("credit-debit-ledger.csv", store.ledger, ledgerCsvColumns)}>Export Excel CSV</button>
        {canExport && <button className="secondary-button" onClick={() => downloadCsv("employee-expenses.csv", store.expenses, expenseCsvColumns)}>Export Expenses CSV</button>}
      </div>
      <DataTable rows={store.ledger} columns={["id", "type", "date", "account", "category", "amount", "note"]} />
    </Panel>
  );
}

function ApprovalPanel({ title, items, kind, commit, className = "" }) {
  const updateStatus = (id, status) => {
    commit((current) => ({
      ...current,
      [kind]: current[kind].map((item) => item.id === id ? { ...item, status } : item)
    }));
  };

  return (
    <Panel title={title} className={className}>
      <div className="approval-list">
        {items.length ? items.map((item) => (
          <article className="approval-row" key={item.id}>
            <div>
              <strong>{item.employeeName}</strong>
              <span>{item.type || item.category} {item.amount ? `- ${money(item.amount)}` : ""}</span>
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

function DataTable({ rows, columns }) {
  if (!rows.length) return <p className="empty-note">No records yet.</p>;
  return (
    <div className="data-table">
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
