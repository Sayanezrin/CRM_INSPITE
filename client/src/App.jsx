import React, { useEffect, useMemo, useRef, useState } from "react";
import inspiteLogoImage from "./assets/inspite-logo.png";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5018";
const LOCAL_CANDIDATES_KEY = "inspite.people.candidates";
const LOCAL_TIME_SUMMARY_KEY = "inspite.people.timeSummary";
const LOCAL_SESSION_KEY = "inspite.people.session";
const LOCAL_ATTENDANCE_SESSION_KEY = "inspite.people.attendanceSession";
const LOCAL_ATTENDANCE_HISTORY_KEY = "inspite.people.attendanceHistory";
const LOCAL_EXPENSES_KEY = "inspite.people.expenses";
const EXPENSE_ATTACHMENT_STORE = "expenseInvoices";
const MAX_INVOICE_BYTES = 5 * 1024 * 1024;

function readLocalJson(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked in some private browser modes.
  }
}

async function apiJson(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function openExpenseDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("inspitePeopleExpenseFiles", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(EXPENSE_ATTACHMENT_STORE)) {
        request.result.createObjectStore(EXPENSE_ATTACHMENT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveExpenseAttachment(file, id) {
  const db = await openExpenseDb();
  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EXPENSE_ATTACHMENT_STORE, "readwrite");
    transaction.objectStore(EXPENSE_ATTACHMENT_STORE).put({ id, name: file.name, type: file.type, size: file.size, dataUrl });
    transaction.oncomplete = () => {
      db.close();
      resolve({ id, name: file.name, type: file.type, size: file.size });
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function getExpenseAttachment(id) {
  const db = await openExpenseDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EXPENSE_ATTACHMENT_STORE, "readonly");
    const request = transaction.objectStore(EXPENSE_ATTACHMENT_STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

const fallbackData = {
  employee: {
    id: 1,
    name: "SAYA NEZRIN",
    employeeCode: "1",
    status: "Yet to check-in",
    shift: "General",
    shiftHours: "9:00 AM-6:00 PM",
    weekRange: "21-Jun-2026 - 27-Jun-2026"
  },
  modules: [
    { id: "home", label: "Home", icon: "home", group: "main" },
    { id: "onboarding", label: "Onboarding", icon: "handshake", group: "main" },
    { id: "leave", label: "Leave Tracker", icon: "umbrella", group: "main" },
    { id: "attendance", label: "Attendance", icon: "calendarCheck", group: "main" },
    { id: "time", label: "Time Tracker", icon: "stopwatch", group: "main" },
    { id: "performance", label: "Performance", icon: "trophy", group: "main" },
    { id: "expenses", label: "Expenses", icon: "receipt", group: "main" },
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
  ],
  lists: {
    onboarding: ["First name", "Last name", "Email ID", "Official Email", "Onboarding Status", "Department", "Source of Hire", "PAN card number", "UAN number"],
    hrletters: ["EmployeeID", "Date of request", "Is there any chan...", "Reason for request", "Enter the Reason for request (If others is cho...", "New Present Address"],
    travel: ["Employee ID", "Travel ID", "Employee Dep...", "Place of visit", "Expected date of departure", "Expected date of arrival", "Purpose of visit", "Expected duration in days"],
    general: ["Employee ID", "Interviewer", "Separation date", "Reason for leaving", "Working for this organization again", "Think the organization do to improve staff w...", "What did you"]
  },
  candidates: [],
  timeSummary: { totalHours: 0, submittedHours: 0, notSubmittedHours: 0, logs: [] },
  tasks: []
};

function Icon({ name }) {
  const common = { width: 25, height: 25, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10.5V20h14v-9.5" /><path d="M9 20v-6h6v6" /></>,
    handshake: <><path d="m8 12 2.3 2.3c.9.9 2.3.9 3.2 0l3.7-3.7" /><path d="m14 7 1.7-1.7a3 3 0 0 1 4.2 0l1.1 1.1-5.4 5.4" /><path d="m10 7-1.7-1.7a3 3 0 0 0-4.2 0L3 6.4l6.8 6.8" /></>,
    umbrella: <><path d="M4 12a8 8 0 0 1 16 0" /><path d="M12 4v16a2 2 0 0 0 4 0" /><path d="M4 12h16" /></>,
    calendarCheck: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 15l2 2 5-5" /></>,
    stopwatch: <><circle cx="12" cy="13" r="7" /><path d="M12 13V9M9 2h6M15 4l2 2" /></>,
    trophy: <><path d="M8 21h8M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0Z" /><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" /></>,
    receipt: <><path d="M6 3h12v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L6 21Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    folder: <><path d="M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>,
    star: <><path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4l-5.6 2.9 1.1-6.2L3 9.7l6.2-.9Z" /></>,
    spark: <><path d="M12 2v7M12 15v7M4.9 4.9l5 5M14.1 14.1l5 5M2 12h7M15 12h7M4.9 19.1l5-5M14.1 9.9l5-5" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5h6v2M3 12h18" /></>,
    building: <><path d="M4 21V5h10v16" /><path d="M14 9h6v12" /><path d="M8 9h2M8 13h2M8 17h2M17 13h1M17 17h1" /></>,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a8 8 0 0 0 .1-6l2-1.2-2-3.5-2.2 1.3a8 8 0 0 0-5.2-3v2.6a8 8 0 0 0-5.2 3L4.7 6.9l-2 3.5 2 1.2a8 8 0 0 0 .1 6l-2.1 1.2 2 3.5 2.2-1.3a8 8 0 0 0 10.4 0l2.2 1.3 2-3.5Z" /></>,
    chart: <><path d="M4 19V5M4 19h16" /><path d="M8 16v-5M12 16V8M16 16v-9" /></>,
    more: <><circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" /></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
    list: <><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
    expand: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /></>,
    userGear: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 9.5-4.9" /><circle cx="17" cy="17" r="2" /><path d="M17 13v1M17 20v1M13 17h1M20 17h1" /></>,
    rocket: <><path d="M5 14c-1.5 1-2 3.5-2 3.5S5.5 17 6.5 15.5" /><path d="M14 5c3.5-1 6-1 6-1s0 2.5-1 6L9 20l-5-5Z" /><path d="M15 9h.01" /></>
  };
  return <svg {...common}>{paths[name] || paths.more}</svg>;
}

function App() {
  const [data, setData] = useState(fallbackData);
  const [apiConnected, setApiConnected] = useState(false);
  const [session, setSession] = useState(() => readLocalJson(LOCAL_SESSION_KEY, null));
  const [attendanceStartedAt, setAttendanceStartedAt] = useState(() => readLocalJson(LOCAL_ATTENDANCE_SESSION_KEY, null)?.startedAt || null);
  const [attendanceHistory, setAttendanceHistory] = useState(() => readLocalJson(LOCAL_ATTENDANCE_HISTORY_KEY, {}));
  const [attendanceElapsedSeconds, setAttendanceElapsedSeconds] = useState(0);
  const [active, setActive] = useState("home");
  const [moduleTab, setModuleTab] = useState("");
  const [showTour, setShowTour] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    apiJson("/api/bootstrap")
      .then((payload) => {
        setApiConnected(true);
        setData({ ...fallbackData, ...payload });
      })
      .catch(() => {
        setApiConnected(false);
        setData(fallbackData);
      });
  }, []);

  const activeModule = useMemo(() => data.modules.find((item) => item.id === active), [active, data.modules]);
  const primaryItems = data.modules.filter((item) => item.group === "main");
  const moreItems = data.modules.filter((item) => item.group === "more");
  const footerItems = data.modules.filter((item) => item.group === "footer");
  const attendanceUserEmail = session?.email || "unknown@inspite.local";
  const currentAttendanceDay = attendanceHistory[todayKey()] || {};
  const attendanceWorkedSeconds = (currentAttendanceDay.workedSeconds || 0) + (attendanceStartedAt ? attendanceElapsedSeconds : 0);
  const attendanceState = {
    startedAt: attendanceStartedAt,
    isCheckedIn: Boolean(attendanceStartedAt),
    elapsedSeconds: attendanceElapsedSeconds,
    workedSeconds: attendanceWorkedSeconds,
    todayRecord: currentAttendanceDay
  };

  useEffect(() => {
    if (!attendanceStartedAt) {
      setAttendanceElapsedSeconds(0);
      return undefined;
    }
    const updateElapsed = () => setAttendanceElapsedSeconds(Math.max(0, Math.floor((Date.now() - attendanceStartedAt) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [attendanceStartedAt]);

  useEffect(() => {
    if (!session?.email || !apiConnected) return;
    apiJson(`/api/attendance/today?userEmail=${encodeURIComponent(session.email)}`)
      .then((record) => {
        const attendance = normalizeAttendanceRecord(record);
        if (!attendance) return;
        setAttendanceHistory((current) => {
          const next = {
            ...current,
            [attendance.date || todayKey()]: {
              checkIn: attendance.checkIn,
              checkOut: attendance.checkOut,
              workedSeconds: attendance.workedSeconds
            }
          };
          writeLocalJson(LOCAL_ATTENDANCE_HISTORY_KEY, next);
          return next;
        });
        if (!attendance.checkOut) {
          setAttendanceStartedAt(attendance.checkIn);
          writeLocalJson(LOCAL_ATTENDANCE_SESSION_KEY, { startedAt: attendance.checkIn });
        } else {
          setAttendanceStartedAt(null);
          writeLocalJson(LOCAL_ATTENDANCE_SESSION_KEY, null);
        }
      })
      .catch(() => {
        // Local attendance remains available when the API is offline.
      });
  }, [session?.email, apiConnected]);

  const selectModule = (id) => {
    setActive(id);
    setModuleTab("");
    if (id !== "more") setMoreOpen(false);
  };

  const handleLogin = (nextSession) => {
    setSession(nextSession);
    writeLocalJson(LOCAL_SESSION_KEY, nextSession);
    setShowTour(false);
  };

  const handleLogout = () => {
    setSession(null);
    writeLocalJson(LOCAL_SESSION_KEY, null);
    setActive("home");
    setModuleTab("");
  };

  const toggleAttendance = async () => {
    if (attendanceStartedAt) {
      const finishedAt = Date.now();
      const workedSeconds = Math.max(0, Math.floor((finishedAt - attendanceStartedAt) / 1000));
      const key = todayKey();
      if (apiConnected) {
        try {
          const saved = normalizeAttendanceRecord(await apiJson("/api/attendance/check-out", {
            method: "POST",
            body: JSON.stringify({ userEmail: attendanceUserEmail })
          }));
          if (saved) {
            setAttendanceHistory((current) => {
              const next = {
                ...current,
                [saved.date || key]: {
                  checkIn: saved.checkIn,
                  checkOut: saved.checkOut,
                  workedSeconds: saved.workedSeconds
                }
              };
              writeLocalJson(LOCAL_ATTENDANCE_HISTORY_KEY, next);
              return next;
            });
            setAttendanceStartedAt(null);
            setAttendanceElapsedSeconds(0);
            writeLocalJson(LOCAL_ATTENDANCE_SESSION_KEY, null);
            return;
          }
        } catch {
          // Fall back to local persistence below if the API cannot save.
        }
      }
      setAttendanceHistory((current) => {
        const currentDay = current[key] || {};
        const nextDay = {
          ...currentDay,
          checkIn: currentDay.checkIn || attendanceStartedAt,
          checkOut: finishedAt,
          workedSeconds: (currentDay.workedSeconds || 0) + workedSeconds
        };
        const next = { ...current, [key]: nextDay };
        writeLocalJson(LOCAL_ATTENDANCE_HISTORY_KEY, next);
        return next;
      });
      setAttendanceStartedAt(null);
      setAttendanceElapsedSeconds(0);
      writeLocalJson(LOCAL_ATTENDANCE_SESSION_KEY, null);
      return;
    }
    const startedAt = Date.now();
    if (apiConnected) {
      try {
        const saved = normalizeAttendanceRecord(await apiJson("/api/attendance/check-in", {
          method: "POST",
          body: JSON.stringify({
            employeeId: data.employee.id,
            userEmail: attendanceUserEmail,
            userName: session?.name || data.employee.name
          })
        }));
        if (saved) {
          setAttendanceStartedAt(saved.checkIn);
          setAttendanceElapsedSeconds(0);
          setAttendanceHistory((current) => {
            const key = saved.date || todayKey();
            const next = {
              ...current,
              [key]: {
                checkIn: saved.checkIn,
                checkOut: saved.checkOut,
                workedSeconds: saved.workedSeconds
              }
            };
            writeLocalJson(LOCAL_ATTENDANCE_HISTORY_KEY, next);
            return next;
          });
          writeLocalJson(LOCAL_ATTENDANCE_SESSION_KEY, { startedAt: saved.checkIn });
          return;
        }
      } catch {
        // Fall back to local persistence below if the API cannot save.
      }
    }
    setAttendanceStartedAt(startedAt);
    setAttendanceElapsedSeconds(0);
    setAttendanceHistory((current) => {
      const key = todayKey();
      const next = {
        ...current,
        [key]: {
          ...(current[key] || {}),
          checkIn: (current[key] || {}).checkIn || startedAt
        }
      };
      writeLocalJson(LOCAL_ATTENDANCE_HISTORY_KEY, next);
      return next;
    });
    writeLocalJson(LOCAL_ATTENDANCE_SESSION_KEY, { startedAt });
  };

  if (!session) return <LoginPage onLogin={handleLogin} />;

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <nav className="nav-stack" aria-label="Primary navigation">
          {primaryItems.map((item) => <NavButton key={item.id} item={item} active={active === item.id} onClick={() => selectModule(item.id)} />)}
          <button className={`nav-button ${moreOpen ? "selected" : ""}`} onClick={() => setMoreOpen(!moreOpen)} title="More modules">
            <span className="nav-icon"><Icon name="more" /></span>
            <span className="nav-label">More</span>
          </button>
          {moreOpen && (
            <div className="more-menu">
              {moreItems.map((item) => (
                <button key={item.id} className="more-item" onClick={() => selectModule(item.id)}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </nav>
        <nav className="nav-stack bottom-stack" aria-label="Secondary navigation">
          {footerItems.map((item) => <NavButton key={item.id} item={item} active={active === item.id} onClick={() => selectModule(item.id)} />)}
        </nav>
      </aside>

      <main className={`main-shell ${active === "home" ? "home-shell" : ""}`}>
        <ModuleTabs active={active} selectedTab={moduleTab} onSelectTab={setModuleTab} />
        <section className="work-area">
          <ModuleContent active={active} data={data} activeModule={activeModule} moduleTab={moduleTab} apiConnected={apiConnected} attendanceState={attendanceState} onToggleAttendance={toggleAttendance} />
        </section>
      </main>

      <RightRail onLogout={handleLogout} session={session} />
      <ChatBar />
      {showTour && <TourOverlay onClose={() => setShowTour(false)} />}
    </div>
  );
}

function NavButton({ item, active, onClick }) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} title={item.label}>
      <span className="nav-icon"><Icon name={item.icon} /></span>
      <span className="nav-label">{item.label}</span>
    </button>
  );
}

function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");

  const submit = (event) => {
    event.preventDefault();
    if (!form.email.trim() || !form.password.trim()) {
      setError("Enter email and password");
      return;
    }
    onLogin({
      provider: "password",
      email: form.email.trim(),
      name: form.email.split("@")[0] || "Inspite User",
      signedInAt: new Date().toISOString()
    });
  };

  const googleSignIn = () => {
    onLogin({
      provider: "google",
      email: "sayaneszrin01@gmail.com",
      name: "SAYA NEZRIN",
      signedInAt: new Date().toISOString()
    });
  };

  return (
    <div className="login-shell">
      <div className="login-brand">
        <img src={inspiteLogoImage} alt="Inspite Technologies" />
        <h1>Inspite People</h1>
        <p>Sign in to manage onboarding, attendance, leave, time tracking, and employee services.</p>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>Sign in</h2>
        <button type="button" className="google-login-button" onClick={googleSignIn}>
          <span>G</span>
          Sign in with Google
        </button>
        <div className="login-divider"><span>or</span></div>
        <label>
          Email address
          <input
            type="email"
            value={form.email}
            onChange={(event) => {
              setError("");
              setForm((current) => ({ ...current, email: event.target.value }));
            }}
            placeholder="Enter email"
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={(event) => {
              setError("");
              setForm((current) => ({ ...current, password: event.target.value }));
            }}
            placeholder="Enter password"
            autoComplete="current-password"
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button className="login-submit" type="submit">Sign in</button>
      </form>
    </div>
  );
}

function VerificationBar() {
  return (
    <div className="verify-bar">
      <span>Your account must be verified to trigger any communication from Inspite People, including emails and other sensitive operations like user and domain addition.</span>
      <a href="#">Click here</a>
      <span>to verify your account.</span>
      <span className="chevron" aria-hidden="true" />
    </div>
  );
}

function ModuleTabs({ active, selectedTab, onSelectTab }) {
  const tabs = {
    home: ["Overview", "Dashboard", "Calendar", "Delegation"],
    leave: ["Leave Summary", "Leave Requests", "Shift"],
    attendance: ["Attendance Summary", "Shift"],
    time: ["Time Logs", "Timesheets", "Jobs", "Projects", "Job Schedule"],
    files: ["Shared with Me", "Shared with My Role"],
    tasks: ["My Tasks", "Track Tasks", "All Tasks", "Form View"],
    engagement: ["Surveys"]
  }[active];

  if (!tabs) return <div className="top-tabs blank-tabs" />;
  const currentTab = selectedTab || tabs[0];

  return (
    <div className="top-tabs">
      {tabs.map((tab) => <button key={tab} onClick={() => onSelectTab(tab)} className={currentTab === tab ? "tab active-tab" : "tab"}>{tab}</button>)}
    </div>
  );
}

function ModuleContent({ active, data, activeModule, moduleTab, apiConnected, attendanceState, onToggleAttendance }) {
  if (active === "home") return <HomePage employee={data.employee} attendanceState={attendanceState} onToggleAttendance={onToggleAttendance} />;
  if (active === "onboarding") return <OnboardingPage columns={data.lists.onboarding} initialCandidates={data.candidates || []} apiConnected={apiConnected} />;
  if (active === "leave") return <LeavePage activeTab={moduleTab || "Leave Summary"} />;
  if (active === "attendance") return <AttendancePage employee={data.employee} activeTab={moduleTab || "Attendance Summary"} attendanceState={attendanceState} onToggleAttendance={onToggleAttendance} />;
  if (active === "time") return <TimeTrackerPage employee={data.employee} activeTab={moduleTab || "Time Logs"} initialSummary={data.timeSummary} apiConnected={apiConnected} />;
  if (active === "performance") return <PerformancePage />;
  if (active === "expenses") return <ExpensesPage />;
  if (active === "files") return <FilesPage />;
  if (active === "hrletters") return <ListPage title="Address Proof View" button="Add Record" columns={data.lists.hrletters} empty="No records found" />;
  if (active === "engagement") return <SimpleEmptyPage empty="No surveys are available at the moment" />;
  if (active === "travel") return <ListPage title="Travel Request View" button="Add Record" columns={data.lists.travel} empty="No records found" wide />;
  if (active === "tasks") return <TasksPage />;
  if (active === "compensation") return <CompensationPage />;
  if (active === "general") return <ListPage title="Exit Details View" button="Add Record" columns={data.lists.general} empty="No records found" wide />;
  if (active === "okr") return <OkrPage />;
  return <ServicePlaceholder module={activeModule} />;
}

function formatClock(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return [hours, minutes, seconds];
}

function formatHoursMinutes(totalSeconds) {
  const [hours, minutes] = formatClock(totalSeconds);
  return `${hours}:${minutes}`;
}

function formatTimeOfDay(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeek(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateShort(date) {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");
}

function getCurrentWeekDays() {
  const today = new Date();
  const todayDate = today.getDate();
  const weekStart = startOfWeek(today);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      date: String(date.getDate()),
      key: formatDateKey(date),
      isToday: date.toDateString() === today.toDateString(),
      isWeekend: date.getDay() === 0 || date.getDay() === 6
    };
  });
}

function currentWeekRange() {
  const days = getCurrentWeekDays();
  const start = new Date(days[0].key);
  const end = new Date(days[6].key);
  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

function normalizeAttendanceRecord(record) {
  if (!record) return null;
  return {
    id: record.id ?? record.Id,
    employeeId: record.employeeId ?? record.EmployeeId,
    userEmail: record.userEmail ?? record.UserEmail,
    userName: record.userName ?? record.UserName,
    date: record.date ?? record.Date,
    checkIn: Date.parse(record.checkInAt ?? record.CheckInAt ?? ""),
    checkOut: record.checkOutAt || record.CheckOutAt ? Date.parse(record.checkOutAt ?? record.CheckOutAt) : null,
    workedSeconds: record.workedSeconds ?? record.WorkedSeconds ?? 0,
    status: record.status ?? record.Status
  };
}

function HomePage({ employee, attendanceState, onToggleAttendance }) {
  const allActivityTabs = ["Activities", "Feeds", "Profile", "Approvals", "Leave", "Attendance", "Time Logs", "Timesheets", "Goals", "Feedback", "Related Data"];
  const [activeActivityTab, setActiveActivityTab] = useState("Activities");
  const [customizeTabsOpen, setCustomizeTabsOpen] = useState(false);
  const [enabledTabs, setEnabledTabs] = useState(() => ({
    Activities: true,
    Feeds: true,
    Profile: true,
    Approvals: true,
    Leave: true,
    Attendance: true,
    "Time Logs": true,
    Timesheets: true,
    Goals: true,
    Feedback: false,
    "Related Data": false
  }));
  const visibleActivityTabs = allActivityTabs.filter((tab) => enabledTabs[tab]);
  const [timerHours, timerMinutes, timerSeconds] = formatClock(attendanceState.workedSeconds);

  const toggleActivityTab = (tab) => {
    if (tab === "Activities") return;
    setEnabledTabs((current) => {
      const next = { ...current, [tab]: !current[tab] };
      if (!next[activeActivityTab]) setActiveActivityTab("Activities");
      return next;
    });
  };

  return (
    <div className="home-layout">
      <div className="profile-card">
        <div className="avatar" />
        <div className="profile-name">{employee.employeeCode} - <strong>{employee.name}</strong></div>
        <div className={attendanceState.isCheckedIn ? "success-text" : "danger-text"}>{attendanceState.isCheckedIn ? "In" : employee.status}</div>
        <div className="time-boxes"><span>{timerHours}</span><b>:</b><span>{timerMinutes}</span><b>:</b><span>{timerSeconds}</span></div>
        <button className={attendanceState.isCheckedIn ? "outline-red" : "outline-green"} onClick={onToggleAttendance}>{attendanceState.isCheckedIn ? "Check-out" : "Check-in"}</button>
      </div>
      <div className="activity-panel">
        <div className="activity-tabs">
          {visibleActivityTabs.map((tab) => (
            <button
              key={tab}
              data-home-tab={tab}
              className={activeActivityTab === tab ? "active-activity" : ""}
              onMouseDown={() => setActiveActivityTab(tab)}
              onClick={() => setActiveActivityTab(tab)}
            >
              {tab}
            </button>
          ))}
          <button className="activity-more-button" onClick={() => setCustomizeTabsOpen(true)} title="Customize Tabs">...</button>
          <button className="slider-icon"><Icon name="filter" /></button>
        </div>
        {customizeTabsOpen && (
          <CustomizeTabsPopup
            tabs={allActivityTabs}
            enabledTabs={enabledTabs}
            onToggle={toggleActivityTab}
            onClose={() => setCustomizeTabsOpen(false)}
          />
        )}
        {activeActivityTab === "Feeds" && <FeedsPanel />}
        {activeActivityTab === "Profile" && <ProfilePanel employee={employee} />}
        {activeActivityTab === "Attendance" && <HomeAttendancePanel attendanceState={attendanceState} />}
        {activeActivityTab === "Time Logs" && <HomeTimeLogsPanel />}
        {activeActivityTab === "Approvals" && <HomeEmptyPanel message="All set! No requests pending approval" variant="approval" />}
        {activeActivityTab === "Leave" && <HomeEmptyPanel message="You can't view leave information or perform leave related actions for this employee as Date of Joining is not yet updated." variant="leave" />}
        {activeActivityTab === "Timesheets" && <HomeEmptyPanel message="No timesheets added for current month" />}
        {activeActivityTab === "Goals" && <HomeGoalsPanel />}
        {activeActivityTab !== "Feeds" && activeActivityTab !== "Profile" && activeActivityTab !== "Attendance" && activeActivityTab !== "Time Logs" && activeActivityTab !== "Approvals" && activeActivityTab !== "Leave" && activeActivityTab !== "Timesheets" && activeActivityTab !== "Goals" && <ActivitiesPanel employee={employee} attendanceState={attendanceState} />}
      </div>
    </div>
  );
}

function CustomizeTabsPopup({ tabs, enabledTabs, onToggle, onClose }) {
  return (
    <div className="customize-tabs-popover">
      <div className="customize-tabs-head">
        <h2>Customize Tabs</h2>
        <button onClick={onClose}>Ã—</button>
      </div>
      <div className="customize-tabs-list">
        {tabs.map((tab) => (
          <div className={`customize-tab-row ${tab === "Activities" ? "locked-tab" : ""}`} key={tab}>
            <span>{tab}</span>
            {tab === "Activities" ? (
              <span className="lock-icon">â™™</span>
            ) : (
              <button
                className={`toggle-switch ${enabledTabs[tab] ? "on" : ""}`}
                onClick={() => onToggle(tab)}
                aria-label={`Toggle ${tab}`}
              >
                <span />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivitiesPanel({ employee, attendanceState }) {
  return (
    <>
        <InfoCard logo title={`Good Afternoon  ${employee.name}`} text="Have a productive day!" accent="sun" />
        <InfoCard icon="calendarCheck" title="Check-in reminder" text="Your shift has already started" right={<><strong>{employee.shift}</strong><span>{employee.shiftHours}</span></>} />
        <InfoCard icon="userGear" title="Work Schedule" text={currentWeekRange()} className="schedule-card">
          <HomeScheduleTimeline attendanceState={attendanceState} />
        </InfoCard>
        <InfoCard icon="stopwatch" title="You are yet to submit your time logs today!" className="submit-card" />
    </>
  );
}

function FeedsPanel() {
  const filters = ["All", "Status", "Announcement", "Approvals", "Mail Alerts", "Holidays", "..."];
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const [editorHtml, setEditorHtml] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [attachments, setAttachments] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [posts, setPosts] = useState([]);

  const runCommand = (command, value = null) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setEditorHtml(editorRef.current?.innerHTML || "");
  };

  const insertHtml = (html) => {
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, html);
    setEditorHtml(editorRef.current?.innerHTML || "");
  };

  const addLink = () => {
    const url = window.prompt("Enter link URL");
    if (url) runCommand("createLink", url);
  };

  const addFiles = (event) => {
    const files = Array.from(event.target.files || []);
    setAttachments((current) => [...current, ...files.map((file) => file.name)]);
    event.target.value = "";
  };

  const postFeed = () => {
    const text = editorRef.current?.innerText.trim() || "";
    if (!text && attachments.length === 0) return;
    setPosts((current) => [
      {
        id: Date.now(),
        html: editorRef.current?.innerHTML || "",
        attachments,
        type: activeFilter === "All" ? "Status" : activeFilter
      },
      ...current
    ]);
    if (editorRef.current) editorRef.current.innerHTML = "";
    setEditorHtml("");
    setAttachments([]);
  };

  const tools = [
    ["B", "Bold", () => runCommand("bold")],
    ["I", "Italic", () => runCommand("italic")],
    ["U", "Underline", () => runCommand("underline")],
    ["T", "Strike", () => runCommand("strikeThrough")],
    ["12âŒ„", "Font size", () => runCommand("fontSize", "4")],
    ["A", "Text color", () => runCommand("foreColor", "#1f2937")],
    ["â–£", "Highlight", () => runCommand("backColor", "#fff3bf")],
    ["â˜°âŒ„", "Align left", () => runCommand("justifyLeft")],
    ["â˜·âŒ„", "Bullet list", () => runCommand("insertUnorderedList")],
    ["â‡¤", "Outdent", () => runCommand("outdent")],
    ["â†•âŒ„", "Indent", () => runCommand("indent")],
    ["â–§", "Insert table", () => insertHtml("<table><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table>")],
    ["ðŸ”—", "Insert link", addLink],
    ["99", "Quote", () => runCommand("formatBlock", "blockquote")],
    ["Tâ‚“", "Clear format", () => runCommand("removeFormat")],
    ["â–¤", "Numbered list", () => runCommand("insertOrderedList")],
    ["â˜»", "Emoji", () => insertHtml(" ðŸ™‚ ")]
  ];

  const visiblePosts = activeFilter === "All" ? posts : posts.filter((post) => post.type === activeFilter);

  return (
    <div className="feeds-panel">
      <section className={`feed-composer ${expanded ? "expanded-composer" : ""}`}>
        <div className="composer-body">
          <div className="composer-avatar" />
          <div
            ref={editorRef}
            className="composer-editor"
            contentEditable
            data-placeholder="Type @ to mention someone"
            suppressContentEditableWarning
            onInput={() => setEditorHtml(editorRef.current?.innerHTML || "")}
          />
          <button className="composer-expand" onClick={() => setExpanded((value) => !value)}>T<sup>+</sup></button>
        </div>
        <div className="composer-toolbar">
          {tools.map(([label, title, action]) => (
            <button key={title} title={title} onMouseDown={(event) => event.preventDefault()} onClick={action}>{label}</button>
          ))}
        </div>
        <div className="composer-actions">
          <button className="attach-button" title="Attach files" onClick={() => fileInputRef.current?.click()}>âˆ®</button>
          <input ref={fileInputRef} className="hidden-file-input" type="file" multiple onChange={addFiles} />
          {attachments.length > 0 && <div className="attachment-list">{attachments.join(", ")}</div>}
          <button className="post-button" disabled={!editorHtml.trim() && attachments.length === 0} onClick={postFeed}>Post</button>
        </div>
      </section>
      <section className="feed-filters">
        {filters.map((filter) => <button key={filter} className={activeFilter === filter ? "active-feed-filter" : ""} onClick={() => setActiveFilter(filter)}>{filter}</button>)}
      </section>
      {visiblePosts.length > 0 ? (
        <section className="feed-list">
          {visiblePosts.map((post) => (
            <article className="feed-post" key={post.id}>
              <div className="composer-avatar" />
              <div>
                <h3>SAYA NEZRIN <span>{post.type}</span></h3>
                <div className="feed-post-body" dangerouslySetInnerHTML={{ __html: post.html }} />
                {post.attachments.length > 0 && <p className="feed-attachments">Attachments: {post.attachments.join(", ")}</p>}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="feed-empty">
          <EmptyIllustration />
          <h2>No feeds to display</h2>
        </section>
      )}
    </div>
  );
}

function ProfilePanel({ employee }) {
  const [about, setAbout] = useState("");
  const [tags, setTags] = useState([]);
  const [modal, setModal] = useState(null);
  const [draft, setDraft] = useState("");

  const openModal = (type) => {
    setModal(type);
    setDraft(type === "about" ? about : tags.join(", "));
  };

  const closeModal = () => {
    setModal(null);
    setDraft("");
  };

  const submitModal = () => {
    if (modal === "about") setAbout(draft.trim());
    if (modal === "tags") setTags(draft.split(",").map((tag) => tag.trim()).filter(Boolean));
    closeModal();
  };

  return (
    <div className="profile-panel">
      <section className="profile-summary-row">
        <ProfileSummaryItem icon="stopwatch" label="Shift" value="General (09:00 AM - 06:00 PM)" />
        <ProfileSummaryItem icon="calendar" label="Time zone" value="India Standard Time (GMT+05:30)" />
        <ProfileSummaryItem icon="folder" label="Email address" value="sayanezrin01@gmail.com" />
      </section>

      <ProfileActionSection title="About Me" actionText="Write a short introduction about yourself" actionIcon="âœŽ" value={about} onAction={() => openModal("about")} />
      <ProfileActionSection title="Tags" actionText="Add Tags" actionIcon="+" value={tags.join(", ")} onAction={() => openModal("tags")} />

      <ProfileSection title="Basic information" columns={[
        [["Employee ID", employee.employeeCode], ["First Name", employee.name], ["Last Name", "-"]],
        [["Nick name", "-"], ["Email address", "sayanezrin01@gmail.com"]]
      ]} />

      <ProfileSection title="Work Information" columns={[
        [["Department", "-"], ["Location", "-"], ["Designation", "-"]],
        [["Inspite Role", "Admin"], ["Employment Type", "-"], ["Employee Status", "Active"], ["Source of Hire", "-"], ["Date of Joining", "-"], ["Current Experience", "-"], ["Total Experience", "-"]]
      ]} />

      <ProfileSection title="Hierarchy Information" columns={[
        [["Reporting Manager", "-"]]
      ]} />

      <ProfileSection title="Personal Details" columns={[
        [["Date of Birth", "-"], ["Age", "-"], ["Gender", "-"], ["Marital Status", "-"], ["About Me", about || "-"]],
        [["Ask me about/Expertise", tags.length ? tags.join(", ") : "-"]]
      ]} />

      <ProfileSection title="Identity Information" columns={[
        [["UAN", "**********"], ["PAN", "**********"]]
      ]} />

      <ProfileSection title="Contact Details" columns={[
        [["Work Phone Number", "-"], ["Extension", "-"], ["Seating Location", "-"], ["Tags", tags.length ? tags.join(", ") : "-"], ["Present Address", "-"], ["Permanent Address", "-"]],
        [["Personal Mobile Number", "-"], ["Personal Email Address", "-"]]
      ]} />

      <ProfileSection title="Separation Information" columns={[
        [["Date of Exit", "-"]]
      ]} />

      <ProfileSection title="System Fields" columns={[
        [["Added By", `1 - ${employee.name} -`], ["Added Time", "26-Jun-2026 04:19 PM"]],
        [["Modified By", `1 - ${employee.name} -`], ["Modified Time", "26-Jun-2026 04:19 PM"], ["Onboarding Status", "-"]]
      ]} />

      <ProfileTableSection title="Work experience" columns={["Company name", "Job Title", "From Date", "To Date", "Job Description", "Relevant"]} />
      <ProfileTableSection title="Education Details" columns={["Institute Name", "Degree/Diploma", "Specialization", "Date of Completion"]} />
      <ProfileTableSection title="Dependent Details" columns={["Name", "Relationship", "Date of Birth"]} />

      {modal && (
        <ProfileModal
          type={modal}
          value={draft}
          onChange={setDraft}
          onClose={closeModal}
          onSubmit={submitModal}
        />
      )}
    </div>
  );
}

function ProfileSummaryItem({ icon, label, value }) {
  return (
    <div className="profile-summary-item">
      <span><Icon name={icon} /></span>
      <div><p>{label}</p><strong>{value}</strong></div>
    </div>
  );
}

function ProfileActionSection({ title, actionText, actionIcon, value, onAction }) {
  return (
    <section className="profile-section profile-action-section">
      <ProfileSectionTitle title={title} />
      <button className="profile-empty-action" onClick={onAction}>
        <span>{actionIcon}</span>
        <strong>{value || actionText}</strong>
      </button>
    </section>
  );
}

function ProfileSection({ title, columns }) {
  return (
    <section className="profile-section">
      <ProfileSectionTitle title={title} />
      <div className={`profile-fields columns-${columns.length}`}>
        {columns.map((column, index) => (
          <div className="profile-field-column" key={`${title}-${index}`}>
            {column.map(([label, value]) => <ProfileField key={`${title}-${label}`} label={label} value={value} />)}
          </div>
        ))}
      </div>
    </section>
  );
}

function ProfileSectionTitle({ title }) {
  return <div className="profile-section-title"><h2>{title}</h2><span /></div>;
}

function ProfileField({ label, value }) {
  return (
    <div className="profile-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProfileTableSection({ title, columns }) {
  return (
    <section className="profile-section">
      <ProfileSectionTitle title={title} />
      <div className="profile-table">
        <div className="profile-table-head" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
          {columns.map((column) => <span key={column}>{column}</span>)}
        </div>
        <div className="profile-table-empty">No rows found.</div>
      </div>
    </section>
  );
}

function ProfileModal({ type, value, onChange, onClose, onSubmit }) {
  const isAbout = type === "about";
  return (
    <div className="profile-modal-backdrop">
      <div className={`profile-modal ${isAbout ? "about-modal" : "tags-modal"}`}>
        <button className="profile-modal-close" onClick={onClose}>Ã—</button>
        <div className="profile-modal-icon">{isAbout ? "â–§" : "âŒ‘"}</div>
        <h2>{isAbout ? "About Me" : "Add Tags"}</h2>
        {!isAbout && <p>Note: Add comma to separate tags</p>}
        {isAbout ? (
          <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder="Write a short introduction about yourself. You can mention your expertise, skills, and professional interests." autoFocus />
        ) : (
          <input value={value} onChange={(event) => onChange(event.target.value)} autoFocus />
        )}
        <div className="profile-modal-actions">
          <button className="primary-button" onClick={onSubmit}>Submit</button>
          <button className="modal-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function HomeAttendancePanel({ attendanceState }) {
  const attendanceRows = getCurrentWeekDays().map((item) => {
    if (item.isToday) {
      const present = attendanceState.workedSeconds > 0;
      return {
        day: item.day,
        date: item.date,
        status: present ? `Present - ${formatHoursMinutes(attendanceState.workedSeconds)} Hrs` : "Absent",
        tone: present ? "present" : "absent",
        request: !present && !item.isWeekend,
        summary: present ? `${formatTimeOfDay(attendanceState.todayRecord.checkIn || attendanceState.startedAt)} - ${attendanceState.todayRecord.checkOut ? formatTimeOfDay(attendanceState.todayRecord.checkOut) : "In"}` : "No check-in - No check-out"
      };
    }
    return {
      day: item.day,
      date: item.date,
      status: item.isWeekend ? "Weekend" : "Absent",
      tone: item.isWeekend ? "weekend" : "absent",
      request: !item.isWeekend,
      summary: "No check-in - No check-out"
    };
  });

  return (
    <div className="home-attendance-panel">
      <h2>This Week</h2>
      <div className="attendance-week-table">
        {attendanceRows.map((row) => (
          <div className={`attendance-day-row ${row.tone}`} key={`${row.day}-${row.date}`}>
            <div className="attendance-day-cell">
              <span>{row.day}</span>
              <strong>{row.date}</strong>
            </div>
            <div className="attendance-shift-cell">
              <div className="attendance-shift-pill">
                <strong>General</strong>
                <span>9:00 AM - 6:00 PM</span>
              </div>
            </div>
            <div className="attendance-status-cell">
              <strong>{row.summary}</strong>
              <span>{row.status}</span>
            </div>
            <div className="attendance-request-cell">
              {row.request && <button>Add Request</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HomeTimeLogsPanel() {
  const [billable, setBillable] = useState("Billable");

  return (
    <div className="home-time-logs-panel">
      <div className="home-log-entry">
        <select aria-label="Select Project" defaultValue="">
          <option value="" disabled>Select Proj...</option>
          <option>Inspite HR Portal</option>
          <option>Internal Operations</option>
        </select>
        <select aria-label="Select Job" defaultValue="">
          <option value="" disabled>Select Job</option>
          <option>Frontend Development</option>
          <option>Testing</option>
        </select>
        <input aria-label="Work description" placeholder="What are you working on?" />
        <select aria-label="Billable status" value={billable} onChange={(event) => setBillable(event.target.value)} className="billable-select">
          <option>Billable</option>
          <option>Non-billable</option>
        </select>
        <button className="home-log-calendar" title="Pick date"><Icon name="calendar" /></button>
        <button className="home-log-timer">00:00:00 <span>â±</span></button>
      </div>
      <div className="home-log-empty">
        <EmptyIllustration />
        <h2>No time logs added for today</h2>
      </div>
    </div>
  );
}

function HomeEmptyPanel({ message, variant = "box" }) {
  return (
    <div className={`home-empty-panel ${variant}`}>
      <EmptyIllustration variant={variant === "leave" ? "clipboard" : undefined} />
      <h2>{message}</h2>
    </div>
  );
}

function HomeGoalsPanel() {
  return (
    <div className="home-goals-panel">
      <div className="goals-toolbar">
        <button className="active-goals-filter">This week</button>
        <button>All</button>
        <button className="goals-add-button">+</button>
      </div>
      <div className="goals-empty-card">
        <EmptyIllustration />
        <h2>No active Goals available</h2>
      </div>
    </div>
  );
}

function InfoCard({ logo, icon, title, text, right, accent, nested, children, className = "" }) {
  return (
    <div className={`info-card ${accent ? "blue-tint" : ""} ${className}`}>
      {logo ? <img className="info-logo-image" src={inspiteLogoImage} alt="Inspite Technologies" /> : <div className="info-icon"><Icon name={icon} /></div>}
      <div className="info-main">
        <h3>{title}</h3>
        {text && <p>{text}</p>}
        {nested && <div className="nested-schedule">{nested}</div>}
        {children}
      </div>
      {right && <div className="info-right">{right}</div>}
      {accent === "sun" && <div className="sun" />}
    </div>
  );
}

function HomeScheduleTimeline({ attendanceState }) {
  const todayStatus = attendanceState.workedSeconds ? `Present - ${formatHoursMinutes(attendanceState.workedSeconds)} Hrs` : "Absent";
  const todayType = attendanceState.workedSeconds ? "today present" : "today absent";
  const days = getCurrentWeekDays().map((item) => {
    if (item.isToday) return [item.day, item.date, todayStatus, todayType];
    if (item.isWeekend) return [item.day, item.date, "Weekend", "weekend"];
    return [item.day, item.date, "Absent", "absent"];
  });

  return (
    <div className="home-schedule">
      <div className="home-shift"><strong>General</strong><span>9:00 AM - 6:00 PM</span></div>
      <div className="home-timeline">
        {days.map(([day, date, status, type]) => (
          <div className={`home-day ${type}`} key={`${day}-${date}`}>
            <i />
            <strong>{day} <span>{date}</span></strong>
            {status && <em>{status}</em>}
          </div>
        ))}
      </div>
    </div>
  );
}

function toCandidateRow(candidate) {
  return {
    id: candidate.id || candidate.Id || Date.now(),
    "First name": candidate.firstName || candidate.FirstName || "-",
    "Last name": candidate.lastName || candidate.LastName || "-",
    "Email ID": candidate.email || candidate.Email || "-",
    "Official Email": candidate.officialEmail || candidate.OfficialEmail || "-",
    "Onboarding Status": candidate.status || candidate.Status || "Added",
    Department: candidate.department || candidate.Department || "-",
    "Source of Hire": candidate.sourceOfHire || candidate.SourceOfHire || "-",
    "PAN card number": candidate.pan || candidate.Pan || "-",
    "UAN number": candidate.uan || candidate.Uan || "-"
  };
}

function candidateRequestFromForm(form, status = "Added") {
  return {
    firstName: form.firstName || "-",
    lastName: form.lastName || "-",
    email: form.email || "-",
    officialEmail: form.officialEmail || "-",
    status,
    department: form.department || "-",
    sourceOfHire: form.sourceOfHire || "-",
    pan: form.pan || "-",
    uan: form.uan || "-",
    phone: form.phone || "-",
    joiningDate: form.joiningDate || "-"
  };
}

function OnboardingPage({ columns, initialCandidates = [], apiConnected = false }) {
  const [view, setView] = useState("list");
  const [candidates, setCandidates] = useState(() => {
    const source = initialCandidates.length ? initialCandidates : readLocalJson(LOCAL_CANDIDATES_KEY, []);
    return source.map(toCandidateRow);
  });

  useEffect(() => {
    if (!apiConnected) return;
    const rows = initialCandidates.map(toCandidateRow);
    setCandidates(rows);
    writeLocalJson(LOCAL_CANDIDATES_KEY, initialCandidates);
  }, [apiConnected, initialCandidates]);

  const addCandidate = async (form, status = "Added") => {
    const request = candidateRequestFromForm(form, status);
    let saved = { ...request, id: Date.now() };
    try {
      saved = await apiJson("/api/candidates", {
        method: "POST",
        body: JSON.stringify(request)
      });
    } catch {
      // Keep the UI usable if the API is offline; persistence resumes when the backend is running.
    }
    setCandidates((current) => {
      const next = [...current, toCandidateRow(saved)];
      writeLocalJson(LOCAL_CANDIDATES_KEY, next);
      return next;
    });
  };

  const deleteCandidates = async (ids) => {
    const idSet = new Set(ids);
    if (apiConnected) {
      await Promise.all(ids.map(async (id) => {
        try {
          await apiJson(`/api/candidates/${id}`, { method: "DELETE" });
        } catch {
          // If a stale local row is already gone from MongoDB, still remove it from the UI.
        }
      }));
    }
    setCandidates((current) => {
      const next = current.filter((candidate) => !idSet.has(candidate.id));
      writeLocalJson(LOCAL_CANDIDATES_KEY, next);
      return next;
    });
  };

  if (view === "form") {
    return (
      <CandidateFormPage
        onSubmit={(form) => {
          addCandidate(form);
          setView("list");
        }}
        onSubmitNew={(form) => addCandidate(form)}
        onSaveDraft={(form) => {
          addCandidate(form, "Draft");
          setView("list");
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  return (
    <ListPage
      title="Candidate View"
      button="Add Candidate"
      columns={columns}
      empty="No records found"
      rows={candidates}
      onAdd={() => setView("form")}
      onDeleteRows={deleteCandidates}
    />
  );
}

function CandidateFormPage({ onSubmit, onSubmitNew, onSaveDraft, onCancel }) {
  const emptyForm = {
    email: "", firstName: "", phoneCode: "+91", phone: "", lastName: "", uan: "", officialEmail: "", pan: "",
    presentLine1: "", presentLine2: "", presentCity: "", presentCountry: "", presentState: "", presentPostal: "",
    sameAddress: false, permanentLine1: "", permanentLine2: "", permanentCity: "", permanentCountry: "", permanentState: "", permanentPostal: "",
    experience: "", sourceOfHire: "", skillSet: "", highestQualification: "", additionalInfo: "",
    location: "", title: "", currentSalary: "", department: "", joiningDate: "", photoName: "", offerName: ""
  };
  const [form, setForm] = useState(emptyForm);
  const [educationRows, setEducationRows] = useState([{ id: 1, school: "", degree: "", field: "", completed: "", notes: "" }]);
  const [experienceRows, setExperienceRows] = useState([{ id: 1, occupation: "", company: "", summary: "", duration: "", current: "" }]);

  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  useEffect(() => {
    if (!form.sameAddress) return;
    setForm((current) => ({
      ...current,
      permanentLine1: current.presentLine1,
      permanentLine2: current.presentLine2,
      permanentCity: current.presentCity,
      permanentCountry: current.presentCountry,
      permanentState: current.presentState,
      permanentPostal: current.presentPostal
    }));
  }, [form.sameAddress, form.presentLine1, form.presentLine2, form.presentCity, form.presentCountry, form.presentState, form.presentPostal]);

  const resetForm = () => {
    setForm(emptyForm);
    setEducationRows([{ id: Date.now(), school: "", degree: "", field: "", completed: "", notes: "" }]);
    setExperienceRows([{ id: Date.now() + 1, occupation: "", company: "", summary: "", duration: "", current: "" }]);
  };
  const addEducationRow = () => setEducationRows((rows) => [...rows, { id: Date.now(), school: "", degree: "", field: "", completed: "", notes: "" }]);
  const addExperienceRow = () => setExperienceRows((rows) => [...rows, { id: Date.now(), occupation: "", company: "", summary: "", duration: "", current: "" }]);
  const updateEducation = (id, name, value) => setEducationRows((rows) => rows.map((row) => row.id === id ? { ...row, [name]: value } : row));
  const updateExperience = (id, name, value) => setExperienceRows((rows) => rows.map((row) => row.id === id ? { ...row, [name]: value } : row));
  const removeExperience = (id) => setExperienceRows((rows) => rows.length > 1 ? rows.filter((row) => row.id !== id) : rows);

  return (
    <div className="candidate-form-page">
      <FormSection title="Candidate Details">
        <div className="candidate-grid two-cols">
          <Field label="Email ID" required><input value={form.email} onChange={(event) => update("email", event.target.value)} /></Field>
          <Field label="First name" required><input value={form.firstName} onChange={(event) => update("firstName", event.target.value)} /></Field>
          <Field label="Phone" required>
            <div className="phone-row">
              <select value={form.phoneCode} onChange={(event) => update("phoneCode", event.target.value)}>
                <option value="+91">IN +91</option>
                <option value="+1">US +1</option>
                <option value="+44">UK +44</option>
              </select>
              <input value={form.phone} onChange={(event) => update("phone", event.target.value)} />
            </div>
          </Field>
          <Field label="Last name" required><input value={form.lastName} onChange={(event) => update("lastName", event.target.value)} /></Field>
          <Field label="UAN number"><input value={form.uan} onChange={(event) => update("uan", event.target.value)} /></Field>
          <Field label="Official Email"><input value={form.officialEmail} onChange={(event) => update("officialEmail", event.target.value)} /></Field>
          <Field label="PAN card number"><input value={form.pan} onChange={(event) => update("pan", event.target.value)} /></Field>
          <Field label="Photo">
            <UploadBox fileName={form.photoName} onChange={(name) => update("photoName", name)} />
            <small className="upload-note">Files supported: JPG, PNG, GIF, JPEG <span>-</span> Max. size is 5 MB</small>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Address Details">
        <AddressGroup title="Present address" prefix="present" form={form} update={update} />
        <AddressGroup title="Permanent address" prefix="permanent" form={form} update={update}>
          <label className="same-address"><input type="checkbox" checked={form.sameAddress} onChange={(event) => update("sameAddress", event.target.checked)} /> Same as Present address</label>
        </AddressGroup>
      </FormSection>

      <FormSection title="Professional Details">
        <div className="candidate-grid two-cols professional-grid">
          <Field label="Experience"><input value={form.experience} onChange={(event) => update("experience", event.target.value)} /></Field>
          <Field label="Location"><select value={form.location} onChange={(event) => update("location", event.target.value)}><option>Select</option><option>India</option><option>Remote</option></select></Field>
          <Field label="Source of Hire"><select value={form.sourceOfHire} onChange={(event) => update("sourceOfHire", event.target.value)}><option>Select</option><option>Referral</option><option>Job Board</option><option>Campus</option></select></Field>
          <Field label="Title"><input value={form.title} onChange={(event) => update("title", event.target.value)} /></Field>
          <Field label="Skill Set"><textarea value={form.skillSet} onChange={(event) => update("skillSet", event.target.value)} /></Field>
          <Field label="Current Salary"><input value={form.currentSalary} onChange={(event) => update("currentSalary", event.target.value)} /></Field>
          <Field label="Highest Qualification"><input value={form.highestQualification} onChange={(event) => update("highestQualification", event.target.value)} /></Field>
          <Field label="Department"><select value={form.department} onChange={(event) => update("department", event.target.value)}><option>Select</option><option>HR</option><option>Engineering</option><option>Operations</option></select></Field>
          <Field label="Additional information"><textarea value={form.additionalInfo} onChange={(event) => update("additionalInfo", event.target.value)} /></Field>
          <Field label="Offer Letter">
            <UploadBox fileName={form.offerName} onChange={(name) => update("offerName", name)} compact />
            <small className="upload-note">Max. size is 5 MB</small>
          </Field>
          <span />
          <Field label="Tentative Joining Date"><div className="date-input"><input placeholder="dd-MMM-yyyy" value={form.joiningDate} onChange={(event) => update("joiningDate", event.target.value)} /><Icon name="calendar" /></div></Field>
        </div>
      </FormSection>

      <EditableEducation rows={educationRows} onAdd={addEducationRow} onUpdate={updateEducation} />
      <EditableExperience rows={experienceRows} onAdd={addExperienceRow} onUpdate={updateExperience} onRemove={removeExperience} />

      <div className="candidate-form-footer">
        <button className="primary-button" onClick={() => onSubmit(form)}>Submit</button>
        <button className="primary-button" onClick={() => { onSubmitNew(form); resetForm(); }}>Submit and New</button>
        <button className="secondary-button" onClick={() => onSaveDraft(form)}>Save Draft</button>
        <button className="secondary-button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function FormSection({ title, children }) {
  return <section className="candidate-section"><h2>{title}</h2><div className="candidate-section-body">{children}</div></section>;
}

function Field({ label, required, children }) {
  return <label className="candidate-field"><span>{label}{required && <b> *</b>}</span><div>{children}</div></label>;
}

function UploadBox({ fileName, onChange, compact }) {
  const inputId = useMemo(() => `upload-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div className={`upload-box ${compact ? "compact" : ""}`}>
      <input id={inputId} type="file" onChange={(event) => onChange(event.target.files?.[0]?.name || "")} />
      <span>Upload from</span><label htmlFor={inputId}>Desktop</label><i>/</i><button type="button">Inspite WorkDrive</button><i>/</i><label htmlFor={inputId}>Others</label>
      {fileName && <em>{fileName}</em>}
    </div>
  );
}

function AddressGroup({ title, prefix, form, update, children }) {
  const value = (field) => form[`${prefix}${field}`] || "";
  const setValue = (field, fieldValue) => update(`${prefix}${field}`, fieldValue);
  return (
    <div className="address-group">
      <span className="address-title">{title}</span>
      <div className="address-fields">
        {children}
        <input placeholder="Address line 1" value={value("Line1")} onChange={(event) => setValue("Line1", event.target.value)} />
        <input placeholder="Address line 2" value={value("Line2")} onChange={(event) => setValue("Line2", event.target.value)} />
        <input placeholder="City" value={value("City")} onChange={(event) => setValue("City", event.target.value)} />
        <div className="address-pair">
          <select value={value("Country")} onChange={(event) => setValue("Country", event.target.value)}><option>Select Country</option><option>India</option><option>United States</option></select>
          <select value={value("State")} onChange={(event) => setValue("State", event.target.value)}><option>Select State</option><option>Tamil Nadu</option><option>Kerala</option><option>Karnataka</option></select>
        </div>
        <input placeholder="Postal Code" value={value("Postal")} onChange={(event) => setValue("Postal", event.target.value)} />
      </div>
    </div>
  );
}

function EditableEducation({ rows, onAdd, onUpdate }) {
  return (
    <FormSection title={<span>Education <button className="row-add-button" onClick={onAdd}>Add Row</button></span>}>
      <div className="editable-table education-table">
        <div className="editable-head"><span>School Name</span><span>Degree/Diploma</span><span>Field(s) of Study</span><span>Date of Completion</span><span>Additional Notes</span><span /></div>
        {rows.map((row) => <div className="editable-row" key={row.id}><input value={row.school} onChange={(event) => onUpdate(row.id, "school", event.target.value)} /><input value={row.degree} onChange={(event) => onUpdate(row.id, "degree", event.target.value)} /><input value={row.field} onChange={(event) => onUpdate(row.id, "field", event.target.value)} /><input value={row.completed} onChange={(event) => onUpdate(row.id, "completed", event.target.value)} /><textarea value={row.notes} onChange={(event) => onUpdate(row.id, "notes", event.target.value)} /><span /></div>)}
      </div>
    </FormSection>
  );
}

function EditableExperience({ rows, onAdd, onUpdate, onRemove }) {
  return (
    <FormSection title={<span>Experience <button className="row-add-button" onClick={onAdd}>Add Row</button></span>}>
      <div className="editable-table experience-table">
        <div className="editable-head"><span>Occupation</span><span>Company</span><span>Summary</span><span>Duration</span><span>Currently Work Here</span><span /></div>
        {rows.map((row) => <div className="editable-row" key={row.id}><input value={row.occupation} onChange={(event) => onUpdate(row.id, "occupation", event.target.value)} /><input value={row.company} onChange={(event) => onUpdate(row.id, "company", event.target.value)} /><textarea value={row.summary} onChange={(event) => onUpdate(row.id, "summary", event.target.value)} /><input value={row.duration} onChange={(event) => onUpdate(row.id, "duration", event.target.value)} /><select value={row.current} onChange={(event) => onUpdate(row.id, "current", event.target.value)}><option>Select</option><option>Yes</option><option>No</option></select><button className="delete-row-button" onClick={() => onRemove(row.id)}>Delete</button></div>)}
      </div>
    </FormSection>
  );
}

function ListPage({ title, button, columns, empty, wide, rows = [], onAdd, onDeleteRows }) {
  const [openSortColumn, setOpenSortColumn] = useState("");
  const [sortConfig, setSortConfig] = useState({ column: "", direction: "" });
  const [searchConfig, setSearchConfig] = useState({ column: "", value: "" });
  const [sortMenuLeft, setSortMenuLeft] = useState(420);
  const [selectedIds, setSelectedIds] = useState([]);

  const visibleRows = useMemo(() => {
    const searchedRows = searchConfig.value
      ? rows.filter((row) => String(row[searchConfig.column] || "").toLowerCase().includes(searchConfig.value.toLowerCase()))
      : rows;
    if (!sortConfig.column || !sortConfig.direction) return searchedRows;
    return [...searchedRows].sort((first, second) => {
      const firstValue = String(first[sortConfig.column] || "").toLowerCase();
      const secondValue = String(second[sortConfig.column] || "").toLowerCase();
      return sortConfig.direction === "asc" ? firstValue.localeCompare(secondValue) : secondValue.localeCompare(firstValue);
    });
  }, [rows, searchConfig, sortConfig]);

  const applySort = (column, direction) => {
    setSortConfig({ column, direction });
    setOpenSortColumn("");
  };

  const openColumnMenu = (event) => {
    const columnNode = event.target.closest(".grid-col");
    if (!columnNode) return;
    const column = columnNode.querySelector("span")?.textContent || "";
    const bounds = event.currentTarget.getBoundingClientRect();
    setSortMenuLeft(Math.max(120, Math.min(event.clientX - bounds.left - 112, bounds.width - 245)));
    setOpenSortColumn((current) => current === column ? "" : column);
  };

  const toggleSelection = (id) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const deleteSelected = async () => {
    if (!selectedIds.length || !onDeleteRows) return;
    await onDeleteRows(selectedIds);
    setSelectedIds([]);
  };

  return (
    <div className="list-page">
      <Toolbar title={title} button={button} onAdd={onAdd} selectedCount={selectedIds.length} onDelete={deleteSelected} />
      <div className={`data-grid ${wide ? "wide-grid" : ""}`}>
        <div className="grid-head" onClick={openColumnMenu}>
          <div className="grid-tool"><Icon name="list" /></div>
          <div className="check-cell"><span /></div>
          {columns.map((column) => <div key={column} className="grid-col"><span>{column}</span><b aria-hidden="true" /></div>)}
        </div>
        {openSortColumn && (
          <SortMenu
            column={openSortColumn}
            left={sortMenuLeft}
            searchValue={searchConfig.column === openSortColumn ? searchConfig.value : ""}
            onSort={(direction) => applySort(openSortColumn, direction)}
            onGroup={(direction) => applySort(openSortColumn, direction)}
            onSearch={(value) => setSearchConfig({ column: openSortColumn, value })}
          />
        )}
        {visibleRows.length ? (
          <div className="grid-body">
            {visibleRows.map((row, index) => (
              <div className="grid-row" key={row.id || `${row["Email ID"]}-${index}`}>
                <div className="grid-tool">{index + 1}</div>
                <button className={`check-cell row-check ${selectedIds.includes(row.id) ? "selected" : ""}`} onClick={() => toggleSelection(row.id)}><span /></button>
                {columns.map((column) => <div key={column} className="grid-cell">{row[column] || "-"}</div>)}
              </div>
            ))}
          </div>
        ) : <EmptyState text={empty} variant="box" />}
      </div>
    </div>
  );
}

function SortMenu({ column, left, searchValue, onSort, onGroup, onSearch }) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="grid-sort-menu" style={{ left }} onClick={(event) => event.stopPropagation()}>
      <div className="sort-menu-title"><span>Sort</span><i /></div>
      <button onClick={() => onSort("asc")}>Asc</button>
      <button onClick={() => onSort("desc")}>Desc</button>
      <div className="sort-menu-title"><span>Group</span><i /></div>
      <button onClick={() => onGroup("asc")}>Asc</button>
      <button onClick={() => onGroup("desc")}>Desc</button>
      <button className="sort-search-button" onClick={() => setSearchOpen((current) => !current)}>Search</button>
      {searchOpen && <input autoFocus placeholder={`Search ${column}`} value={searchValue} onChange={(event) => onSearch(event.target.value)} />}
    </div>
  );
}

function Toolbar({ title, button, onAdd, selectedCount = 0, onDelete }) {
  return (
    <div className="toolbar">
      <div className="select-title">{title}<span className="select-arrow" aria-hidden="true" /></div>
      <button className="link-button">Edit</button>
      <div className="toolbar-spacer" />
      <button className="link-button">View All Data</button>
      {selectedCount > 0 && <button className="danger-button" onClick={onDelete}>Delete ({selectedCount})</button>}
      <div className="select-small">Reportees + My Data <span className="select-arrow" aria-hidden="true" /></div>
      <button className="primary-button" onClick={onAdd}>{button}</button>
      <IconButton icon="expand" />
      <IconButton icon="filter" />
      <IconButton icon="more" />
    </div>
  );
}

function IconButton({ icon }) {
  return <button className="icon-button" title={icon}><Icon name={icon} /></button>;
}

function LeavePage({ activeTab }) {
  const [showRequestForm, setShowRequestForm] = useState(false);

  if (activeTab === "Leave Requests" && showRequestForm) {
    return <LeaveRequestForm onCancel={() => setShowRequestForm(false)} onSubmit={() => setShowRequestForm(false)} />;
  }

  if (activeTab === "Leave Requests") {
    return <LeaveRequestsPage onAddRequest={() => setShowRequestForm(true)} />;
  }

  if (activeTab === "Shift") {
    return <LeaveShiftPage />;
  }

  return (
    <div className="center-page">
      <EmptyIllustration variant="clipboard" />
      <p>Update the <a href="#">Date of Joining</a> for this employee to display their leave information<br />and enable them to perform leave related actions.</p>
    </div>
  );
}

function LeaveShiftPage() {
  const [viewMode, setViewMode] = useState("weekly");
  const [assignOpen, setAssignOpen] = useState(false);
  const days = [
    ["Sun", "21", "weekend"],
    ["Mon", "22", ""],
    ["Tue", "23", ""],
    ["Wed", "24", ""],
    ["Thu", "25", ""],
    ["Fri", "26", "today"],
    ["Sat", "27", "weekend"]
  ];
  const hours = ["08 AM", "09 AM", "10 AM", "11 AM", "12 PM", "01 PM", "02 PM", "03 PM", "04 PM", "05 PM", "06 PM"];
  const monthCells = [
    ["", "Sun"], ["", "Mon"], ["", "Tue"], ["", "Wed"], ["", "Thu"], ["", "Fri"], ["", "Sat"],
    ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""],
    ["7", "weekend"], ["8", ""], ["9", ""], ["10", ""], ["11", ""], ["12", ""], ["13", "weekend"],
    ["14", "weekend"], ["15", ""], ["16", ""], ["17", ""], ["18", ""], ["19", ""], ["20", "weekend"],
    ["21", "weekend"], ["22", ""], ["23", ""], ["24", ""], ["25", ""], ["26", ""], ["27", "weekend today"],
    ["28", "weekend"], ["29", ""], ["30", ""], ["", ""], ["", ""], ["", ""], ["", ""]
  ];

  return (
    <div className="leave-shift-page">
      <div className="shift-topbar">
        <span />
        <DateStepper />
        <strong>{viewMode === "monthly" ? "Jun 2026" : "21-Jun-2026 - 27-Jun-2026"}</strong>
        <div className="shift-actions">
          <button className={`shift-period ${viewMode === "weekly" ? "active" : ""}`} onClick={() => setViewMode("weekly")}>Weekly</button>
          <button className={`shift-period ${viewMode === "monthly" ? "active" : ""}`} onClick={() => setViewMode("monthly")}>Monthly</button>
          <button className="primary-button" onClick={() => setAssignOpen(true)}>Assign shift</button>
          <IconButton icon="more" />
        </div>
      </div>
      {viewMode === "monthly" ? (
        <div className="shift-month-grid">
          {monthCells.map(([label, type], index) => (
            <div className={`shift-month-cell ${type}`} key={`${index}-${label || type}`}>
              {index < 7 ? <span className="shift-month-day-name">{type}</span> : label && (
                <>
                  <strong className={type.includes("today") ? "today-date" : ""}>{label}</strong>
                  <div className="month-shift-card"><b>General</b><span>9:00 AM - 6:00 PM</span></div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="shift-schedule-grid">
          <div className="shift-hours">
            <span />
            {hours.map((hour) => <span key={hour}>{hour}</span>)}
          </div>
          {days.map(([day, date, type], index) => (
            <div className={`shift-day-row ${type}`} key={`${day}-${date}`}>
              <div className="shift-day-cell"><span>{day}</span><strong>{date}</strong></div>
              {hours.map((hour) => <div className="shift-hour-cell" key={`${day}-${hour}`} />)}
              <div className="shift-bar" style={{ left: "17.3%", width: "74.1%" }}>
                <strong>General</strong>
                <span>9:00 AM - 6:00 PM</span>
              </div>
              {index === 2 && <button className="shift-edit-dot" title="Edit shift">âœŽ</button>}
            </div>
          ))}
        </div>
      )}
      {assignOpen && <AssignShiftDrawer onClose={() => setAssignOpen(false)} />}
    </div>
  );
}

function AssignShiftDrawer({ onClose }) {
  return (
    <div className="assign-shift-shell">
      <div className="assign-shift-drawer">
        <div className="assign-shift-head">
          <h2>Assign shift</h2>
          <button onClick={onClose}>Ã—</button>
        </div>
        <section className="assign-shift-card">
          <label><span>Shift name</span><select><option>Select</option><option>General</option><option>Night Shift</option></select></label>
          <label><span>Dates</span><div className="assign-date-row"><div className="date-input"><input placeholder="dd-MMM-yyyy" /><Icon name="calendar" /></div><div className="date-input"><input placeholder="dd-MMM-yyyy" /><Icon name="calendar" /></div></div></label>
          <label><span>Reason</span><textarea placeholder="Reason" /></label>
        </section>
        <div className="assign-shift-footer">
          <button className="primary-button" onClick={onClose}>Submit</button>
          <button className="secondary-button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function LeaveRequestsPage({ onAddRequest }) {
  return (
    <div className="leave-requests-page">
      <div className="leave-request-toolbar">
        <div className="select-title">Leave <span className="select-arrow" aria-hidden="true" /></div>
        <span />
        <IconButton icon="filter" />
        <IconButton icon="more" />
      </div>
      <div className="leave-request-empty">
        <EmptyIllustration />
        <h2>No Data Found</h2>
        <button className="primary-button" onClick={onAddRequest}>Add Request</button>
      </div>
      <div className="leave-request-footer">
        <span>Total Record Count : <b>#</b></span>
        <div>
          <select><option>20</option><option>50</option><option>100</option></select>
          <span>Records per page</span>
          <button aria-label="Previous page">&lt;</button>
          <span>1 - 0</span>
          <button aria-label="Next page">&gt;</button>
        </div>
      </div>
    </div>
  );
}

function LeaveRequestForm({ onSubmit, onCancel }) {
  const [form, setForm] = useState({ type: "", from: "", to: "", teamEmail: "", reason: "" });
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  return (
    <div className="leave-request-form-page">
      <section className="leave-form-card">
        <h2>Leave</h2>
        <div className="leave-form-body">
          <label><span>Leave type <b>*</b></span><select value={form.type} onChange={(event) => update("type", event.target.value)}><option>Select</option><option>Casual Leave</option><option>Sick Leave</option><option>Earned Leave</option></select></label>
          <label><span>Date <b>*</b></span><div className="leave-date-row"><div className="date-input"><input placeholder="dd-MMM-yyyy" value={form.from} onChange={(event) => update("from", event.target.value)} /><Icon name="calendar" /></div><div className="date-input"><input placeholder="dd-MMM-yyyy" value={form.to} onChange={(event) => update("to", event.target.value)} /><Icon name="calendar" /></div></div></label>
          <label><span>Team Email ID</span><input value={form.teamEmail} onChange={(event) => update("teamEmail", event.target.value)} /></label>
          <label><span>Reason for leave</span><textarea value={form.reason} onChange={(event) => update("reason", event.target.value)} /></label>
        </div>
      </section>
      <div className="leave-form-footer">
        <button className="primary-button" onClick={onSubmit}>Submit</button>
        <button className="secondary-button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function AttendancePage({ employee, activeTab, attendanceState, onToggleAttendance }) {
  if (activeTab === "Shift") return <LeaveShiftPage />;

  const rows = getCurrentWeekDays().map((item) => {
    if (item.isToday) {
      return {
        day: "Today",
        date: item.date,
        status: attendanceState.workedSeconds ? "Present" : item.isWeekend ? "Weekend" : "Absent",
        tone: attendanceState.workedSeconds ? "present" : item.isWeekend ? "weekend" : "absent",
        workedSeconds: attendanceState.workedSeconds,
        checkIn: attendanceState.todayRecord.checkIn || attendanceState.startedAt,
        checkOut: attendanceState.todayRecord.checkOut
      };
    }
    return {
      day: item.day,
      date: item.date,
      status: item.isWeekend ? "Weekend" : "Absent",
      tone: item.isWeekend ? "weekend" : "absent",
      workedSeconds: 0
    };
  });
  const [panelHours, panelMinutes, panelSeconds] = formatClock(attendanceState.workedSeconds);
  return (
    <div className="attendance-page">
      <div className="date-row"><DateStepper /><strong>{currentWeekRange()}</strong><span className="right-tools"><IconButton icon="list" /><IconButton icon="calendar" /><IconButton icon="filter" /><IconButton icon="more" /></span></div>
      <div className="checkin-panel">
        <strong>General [ 9:00 AM - 6:00 PM ]</strong>
        <input placeholder={attendanceState.isCheckedIn ? "Add notes for check-out" : "Add notes for check-in"} />
        <button className={attendanceState.isCheckedIn ? "checkout-button" : ""} onClick={onToggleAttendance}>
          {attendanceState.isCheckedIn ? "Check-out" : "Check-in"}<br /><b>{panelHours}:{panelMinutes}:{panelSeconds} Hrs</b>
        </button>
      </div>
      <div className="timeline-list">
        {rows.map((row) => <TimelineRow key={row.date} row={row} />)}
      </div>
      <div className="hours-scale">{["09AM", "10AM", "11AM", "12PM", "01PM", "02PM", "03PM", "04PM", "05PM", "06PM"].map((t) => <span key={t}>{t}</span>)}</div>
      <SummaryBar />
    </div>
  );
}

function DateStepper() {
  return <div className="date-stepper"><button aria-label="Previous date">&lt;</button><Icon name="calendar" /><button aria-label="Next date">&gt;</button></div>;
}

function TimelineRow({ row }) {
  const workedText = row.workedSeconds ? formatHoursMinutes(row.workedSeconds) : "00:00";
  const checkInText = formatTimeOfDay(row.checkIn);
  const checkOutText = formatTimeOfDay(row.checkOut);
  return (
    <div className="timeline-row">
      <div className="day-cell"><strong>{row.day}</strong><span>{row.date}</span></div>
      <div className="attendance-check-time">{checkInText && <strong>{checkInText}</strong>}</div>
      <div className={`line ${row.tone}`}><i /><em>{row.status}</em><i /></div>
      <div className="attendance-check-time out-time">{checkOutText && <strong>{checkOutText}</strong>}</div>
      <div className="worked"><strong>{workedText}</strong><span>Hrs worked</span></div>
    </div>
  );
}

function SummaryBar() {
  return (
    <div className="summary-bar">
      <div className="summary-tabs"><b>Days</b><span>Hours</span></div>
      {["Payable Days|2 Days", "Present|0 Day", "On Duty|0 Day", "Paid leave|0 Day", "Holidays|0 Day", "Weekend|2 Days", "...|"].map((item, i) => {
        const [label, value] = item.split("|");
        return <div className="summary-item" key={label} style={{ "--bar-color": ["#d7bc00", "#8cc63e", "#b849ff", "#c0b000", "#45c3f0", "#ff9b00", "transparent"][i] }}><span>{label}</span><b>{value}</b></div>;
      })}
      <strong className="shift-label">General [ 9:00 AM - 6:00 PM ]</strong>
    </div>
  );
}

function formatHours(value = 0) {
  const hours = Number(value) || 0;
  return `${hours.toFixed(2).padStart(5, "0")} Hrs`;
}

function getInitialTimeSummary(initialSummary) {
  const hasServerLogs = (initialSummary?.logs || []).length > 0;
  return hasServerLogs ? initialSummary : readLocalJson(LOCAL_TIME_SUMMARY_KEY, initialSummary || fallbackData.timeSummary);
}

function TimeTrackerPage({ employee, activeTab, initialSummary, apiConnected = false }) {
  const [summary, setSummary] = useState(() => getInitialTimeSummary(initialSummary));
  const [form, setForm] = useState({ project: "", job: "", notes: "", billable: "Billable" });

  useEffect(() => {
    if (!apiConnected) return;
    setSummary(initialSummary);
    writeLocalJson(LOCAL_TIME_SUMMARY_KEY, initialSummary);
  }, [apiConnected, initialSummary]);

  useEffect(() => {
    apiJson("/api/time/summary").then((freshSummary) => {
      setSummary(freshSummary);
      writeLocalJson(LOCAL_TIME_SUMMARY_KEY, freshSummary);
    }).catch(() => {});
  }, []);

  if (activeTab === "Timesheets") return <TimesheetsPage />;
  if (activeTab === "Jobs") return <TimeEntityPage type="Jobs" />;
  if (activeTab === "Projects") return <TimeEntityPage type="Projects" />;
  if (activeTab === "Job Schedule") return <JobSchedulePage />;

  const logs = summary?.logs || [];
  const saveTimeLog = async () => {
    const request = {
      project: form.project || "Inspite HR Portal",
      job: form.job || "General",
      notes: form.notes || "Work update",
      billable: form.billable === "Billable",
      hours: 1
    };
    const localLog = { ...request, id: Date.now(), submitted: false, createdAt: new Date().toISOString() };
    try {
      await apiJson("/api/time/logs", {
        method: "POST",
        body: JSON.stringify(request)
      });
      const freshSummary = await apiJson("/api/time/summary");
      setSummary(freshSummary);
      writeLocalJson(LOCAL_TIME_SUMMARY_KEY, freshSummary);
    } catch {
      setSummary((current) => {
        const currentLogs = current?.logs || [];
        const next = {
          totalHours: Number(current?.totalHours || 0) + request.hours,
          submittedHours: Number(current?.submittedHours || 0),
          notSubmittedHours: Number(current?.notSubmittedHours || 0) + request.hours,
          logs: [...currentLogs, localLog]
        };
        writeLocalJson(LOCAL_TIME_SUMMARY_KEY, next);
        return next;
      });
    }
    setForm({ project: "", job: "", notes: "", billable: "Billable" });
  };

  return (
    <div className="time-page">
      <div className="date-row"><DateStepper /><strong>{employee.weekRange}</strong><button className="primary-button" onClick={saveTimeLog}>Log Time <span>?</span></button><IconButton icon="list" /><IconButton icon="calendar" /><IconButton icon="filter" /><IconButton icon="more" /></div>
      <div className="log-panel">
        <select className="select-small" value={form.project} onChange={(event) => setForm((current) => ({ ...current, project: event.target.value }))}>
          <option value="">Select Project</option>
          <option>Inspite HR Portal</option>
          <option>Internal Operations</option>
        </select>
        <select className="select-small" value={form.job} onChange={(event) => setForm((current) => ({ ...current, job: event.target.value }))}>
          <option value="">Select Job</option>
          <option>General</option>
          <option>Frontend Development</option>
          <option>Testing</option>
        </select>
        <input placeholder="What are you working on?" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        <select className="select-small" value={form.billable} onChange={(event) => setForm((current) => ({ ...current, billable: event.target.value }))}>
          <option>Billable</option>
          <option>Non-billable</option>
        </select>
        <IconButton icon="calendar" />
        <button className="timer-button" onClick={saveTimeLog}>00:00:00</button>
      </div>
      {logs.length === 0 ? (
        <EmptyState text="No time logs added currently.To add new time logs, click Log Time" variant="large" />
      ) : (
        <div className="time-log-list">
          {logs.map((log) => (
            <div className="time-log-row" key={log.id || log.Id}>
              <strong>{log.project || log.Project}</strong>
              <span>{log.job || log.Job}</span>
              <span>{log.notes || log.Notes}</span>
              <b>{formatHours(log.hours || log.Hours)}</b>
              <em>{(log.billable ?? log.Billable) ? "Billable" : "Non-billable"}</em>
            </div>
          ))}
        </div>
      )}
      <div className="time-footer">
        <div><b>{formatHours(summary?.totalHours)}</b><span>Total</span></div>
        <div><b className="green">{formatHours(summary?.submittedHours)}</b><span>Submitted</span></div>
        <div className="not-submitted"><b>{formatHours(summary?.notSubmittedHours)}</b><span>Not Submitted</span><strong>›</strong></div>
      </div>
    </div>
  );
}
function TimesheetsPage() {
  return (
    <div className="timesheets-page">
      <div className="time-control-row">
        <span />
        <DateStepper />
        <strong>Jun 2026</strong>
        <span className="time-control-spacer" />
        <div className="select-small wide">All <span className="select-arrow" aria-hidden="true" /></div>
        <button className="primary-button">Create Timesheet</button>
        <IconButton icon="filter" />
      </div>
      <div className="time-empty-card">
        <EmptyIllustration />
        <h2>No timesheets found for the applied filters.To add new timesheets,<br />click Create Timesheet</h2>
      </div>
    </div>
  );
}

function TimeEntityPage({ type }) {
  const singular = type === "Jobs" ? "Job" : "Project";
  return (
    <div className="time-entity-page">
      <div className="time-entity-toolbar">
        <div className="select-title">{type}<span className="select-arrow" aria-hidden="true" /></div>
        <span />
        <div className="time-segment">
          <button className="active">Employee</button>
          <button>Department</button>
        </div>
        <button className="primary-button">Add {singular}</button>
        <IconButton icon="expand" />
        <IconButton icon="filter" />
        <IconButton icon="more" />
      </div>
      <div className="time-empty-card">
        <EmptyIllustration />
        <h2>No {type} added currently.To add new {type}, click Add {singular}</h2>
      </div>
    </div>
  );
}

function JobSchedulePage() {
  const [view, setView] = useState("day");
  const [cloneConfirmOpen, setCloneConfirmOpen] = useState(false);
  const hours = ["12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM", "6 AM", "7 AM", "8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM"];
  const days = view === "day"
    ? [["Sat", "27", true]]
    : [["Sun", "21", true], ["Mon", "22", false], ["Tue", "23", false], ["Wed", "24", false], ["Thu", "25", false], ["Fri", "26", false], ["Sat", "27", true]];

  return (
    <div className="job-schedule-page">
      <div className="job-schedule-topbar">
        <span />
        <DateStepper />
        <strong>{view === "day" ? "Today" : "21-Jun-2026 - 27-Jun-2026"}</strong>
        <span className="time-control-spacer" />
        <div className="schedule-mode">
          <button className={view === "day" ? "active" : ""} onClick={() => setView("day")}>Day</button>
          <button className={view === "week" ? "active" : ""} onClick={() => setView("week")}>Week</button>
        </div>
        <button className="outline-blue" onClick={() => setCloneConfirmOpen(true)}>Clone</button>
        <span className="pending-status">0 pending changes</span>
        <button className="published-button">Published</button>
        <IconButton icon="filter" />
        <IconButton icon="more" />
      </div>
      <div className={`job-schedule-scroll ${view}`}>
        <div className="job-grid">
          <div className="job-grid-head">
            <span />
            {hours.map((hour) => <span key={hour}>{hour}</span>)}
          </div>
          {days.map(([day, date, weekend]) => (
            <div className={`job-grid-row ${weekend ? "weekend" : ""}`} key={`${day}-${date}`}>
              <div className="job-left-cell">
                <span>{day}</span>
                <strong className={date === "27" ? "today-badge" : ""}>{date}</strong>
                <em>â—· 00:00 hrs</em>
              </div>
              {hours.map((hour) => <span className="job-hour-cell" key={`${day}-${date}-${hour}`} />)}
            </div>
          ))}
        </div>
      </div>
      {cloneConfirmOpen && <CloneConfirmModal onClose={() => setCloneConfirmOpen(false)} />}
    </div>
  );
}

function CloneConfirmModal({ onClose }) {
  return (
    <div className="clone-confirm-backdrop">
      <div className="clone-confirm-modal">
        <button className="clone-confirm-close" onClick={onClose}>Ã—</button>
        <div className="clone-confirm-icon">âœ“</div>
        <h2>Confirm</h2>
        <p>Are you sure, you want to clone all the filtered job schedules of previous week?</p>
        <div className="clone-confirm-actions">
          <button className="clone-confirm-submit" onClick={onClose}>Confirm</button>
          <button className="secondary-button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function PerformancePage() {
  return <LearningPage title="Performance Service" copy="The Performance Management service helps you assess and enhance employee performance accurately with intuitive metrics and employee-centric practices. From setting goals to running appraisals, manage performance with ease and step up your organization's productivity." panelTitle="Review Methods" panelCopy="A range of performance evaluation methods tailored to enhance employee performance, suitable for organizations of any size and type." items={[["Key Result Areas (KRA)", "KRAs represent areas of responsibility or focus. KRAs can help employees understand their role in the organization.", "userGear"], ["Goals", "Specific, measurable objectives that employees are expected to handle. Goals serve as performance targets.", "target"], ["Skill Set", "Skillsets are abilities required to perform certain tasks or functions within a role.", "spark"], ["Competency", "A combination of abilities or skills that enable employees to perform effectively in a specific role or job.", "handshake"]]} footer="STEP 1 OF 3" />;
}

function CompensationPage() {
  return <LearningPage title="Compensation" copy="Record and manage compensation policies, processes and data in a central space" panelTitle="Overview of Module" panelCopy="Get to know the essential functions of the Inspite People Compensation service" items={[["Salary Packages", "Define salary packages based on various parameters for different groups of employees.", "briefcase"], ["Salary Revisions", "Manage the complete salary revision process, from setup to sending revision letters to employees.", "star"], ["Reports", "Access detailed compensation data, including historical insights, to guide future rewards and compensation decisions", "chart"], ["Secure Permissions", "Set fine-grained permissions to ensure data is accessible only to the appropriate people.", "settings"]]} button="Get Started" />;
}

function OkrPage() {
  return (
    <LearningPage
      title="Objectives and Key Results"
      copy="The OKR service is an effective goal-setting framework within Inspite People, designed to define clear, measurable objectives for your organization and track progress through specific key results. This approach enables HR administrators, managers, and employees to align individual and team goals with broader organizational priorities, ensuring that everyone works toward achieving the organization's mission and vision."
      panelTitle="Key Elements of the OKR Framework"
      items={[["Objectives", "Objectives are clear, broad goals that your team or organization strives to achieve. They provide direction and focus toward achieving a desired outcome.", "target"], ["Key Results", "Key results are measurable outcomes that track progress toward achieving an objective. They break the objective down into specific, actionable steps, making it easier to achieve.", "userGear"]]}
      customBlock={<div className="okr-block"><Icon name="calendar" /><div><h3>OKR cycle</h3><p>OKR period is the timeframe in which Objectives and Key Results (OKRs) are created, implemented, tracked, and reviewed at regular intervals.</p><label>OKR cycle Start Month <select><option>Jan</option></select></label></div></div>}
      button="Getting Started"
    />
  );
}

function ExpensesPage() {
  const blankExpense = { employee: "", category: "Travel", date: new Date().toISOString().slice(0, 10), amount: "", notes: "" };
  const [requests, setRequests] = useState(() => readLocalJson(LOCAL_EXPENSES_KEY, []));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankExpense);
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [invoiceError, setInvoiceError] = useState("");

  useEffect(() => {
    writeLocalJson(LOCAL_EXPENSES_KEY, requests);
  }, [requests]);

  const updateStatus = (id, status) => {
    setRequests((current) => current.map((request) => request.id === id ? { ...request, status } : request));
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleInvoice = (event) => {
    const file = event.target.files?.[0];
    setInvoiceError("");
    setInvoiceFile(null);
    if (!file) return;
    const allowed = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!allowed) {
      setInvoiceError("Only image or PDF invoices are allowed.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_INVOICE_BYTES) {
      setInvoiceError("Invoice file must not exceed 5 MB.");
      event.target.value = "";
      return;
    }
    setInvoiceFile(file);
  };

  const addExpense = async (event) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!form.employee.trim() || !form.category.trim() || !form.date || !amount || !invoiceFile) {
      setInvoiceError(invoiceFile ? "" : "Upload an invoice image or PDF.");
      return;
    }
    const id = `EXP-${Date.now()}`;
    let invoice;
    try {
      invoice = await saveExpenseAttachment(invoiceFile, id);
    } catch {
      setInvoiceError("Could not store the invoice. Try a smaller file.");
      return;
    }
    setRequests((current) => [
      {
        id,
        employee: form.employee.trim(),
        category: form.category,
        date: formatExpenseDate(form.date),
        amount,
        notes: form.notes.trim(),
        invoice,
        status: "Pending"
      },
      ...current
    ]);
    setForm(blankExpense);
    setInvoiceFile(null);
    setInvoiceError("");
    setShowForm(false);
  };

  const downloadInvoice = async (invoice) => {
    if (!invoice?.id) return;
    const saved = await getExpenseAttachment(invoice.id);
    if (!saved?.dataUrl) return;
    const link = document.createElement("a");
    link.href = saved.dataUrl;
    link.download = saved.name || "invoice";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const totals = requests.reduce((summary, request) => {
    summary.total += request.amount;
    if (request.status === "Approved") summary.approved += request.amount;
    if (request.status === "Pending") summary.pending += request.amount;
    if (request.status === "Rejected") summary.rejected += request.amount;
    return summary;
  }, { total: 0, approved: 0, pending: 0, rejected: 0 });

  const formatAmount = (amount) => `Rs. ${amount.toLocaleString("en-IN")}`;

  return (
    <div className="expenses-page">
      <div className="expenses-header">
        <div>
          <h1>Expenses</h1>
          <p>Approve employee expense claims and review company spending for the month.</p>
        </div>
        <div className="expenses-header-actions">
          <select aria-label="Expense month">
            <option>Jun 2026</option>
            <option>May 2026</option>
            <option>Apr 2026</option>
          </select>
          <button className="primary-button" onClick={() => setShowForm((value) => !value)}>{showForm ? "Close" : "Add Expense"}</button>
        </div>
      </div>

      <div className="expense-metrics">
        <ExpenseMetric label="Monthly Expense" value={formatAmount(totals.total)} tone="blue" />
        <ExpenseMetric label="Approved" value={formatAmount(totals.approved)} tone="green" />
        <ExpenseMetric label="Pending Approval" value={formatAmount(totals.pending)} tone="orange" />
        <ExpenseMetric label="Rejected" value={formatAmount(totals.rejected)} tone="red" />
      </div>

      {showForm && (
        <form className="expense-form" onSubmit={addExpense}>
          <h2>Add Expense</h2>
          <div className="expense-form-grid">
            <label>Employee name <input value={form.employee} onChange={(event) => updateForm("employee", event.target.value)} placeholder="Employee name" /></label>
            <label>Category
              <select value={form.category} onChange={(event) => updateForm("category", event.target.value)}>
                <option>Travel</option>
                <option>Meals</option>
                <option>Office Supplies</option>
                <option>Internet</option>
                <option>Training</option>
                <option>Other</option>
              </select>
            </label>
            <label>Date <input type="date" value={form.date} onChange={(event) => updateForm("date", event.target.value)} /></label>
            <label>Amount <input type="number" min="1" value={form.amount} onChange={(event) => updateForm("amount", event.target.value)} placeholder="0" /></label>
            <label className="expense-notes">Notes <textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} placeholder="Reason or bill details" /></label>
            <label className="expense-invoice">Invoice
              <input type="file" accept="image/*,.pdf,application/pdf" onChange={handleInvoice} />
              <small>{invoiceFile ? invoiceFile.name : "Upload image or PDF. Max. size is 5 MB"}</small>
              {invoiceError && <em>{invoiceError}</em>}
            </label>
          </div>
          <div className="expense-form-actions">
            <button className="primary-button" type="submit">Submit</button>
            <button className="secondary-button" type="button" onClick={() => { setForm(blankExpense); setInvoiceFile(null); setInvoiceError(""); setShowForm(false); }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="expense-panel">
        <div className="expense-panel-head">
          <h2>Employee Expense Approvals</h2>
          <div className="right-tools"><IconButton icon="filter" /><IconButton icon="more" /></div>
        </div>
        <div className="expense-table">
          <div className="expense-row expense-head">
            <span>Request ID</span>
            <span>Employee</span>
            <span>Category</span>
            <span>Date</span>
            <span>Amount</span>
            <span>Invoice</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          {requests.length ? (
            requests.map((request) => (
              <div className="expense-row" key={request.id}>
                <span>{request.id}</span>
                <strong>{request.employee}</strong>
                <span>{request.category}</span>
                <span>{request.date}</span>
                <span>{formatAmount(request.amount)}</span>
                <span>{request.invoice ? <button className="invoice-download" onClick={() => downloadInvoice(request.invoice)}>Download</button> : "-"}</span>
                <span className={`status-pill ${request.status.toLowerCase()}`}>{request.status}</span>
                <span className="expense-actions">
                  <button disabled={request.status === "Approved"} onClick={() => updateStatus(request.id, "Approved")}>Approve</button>
                  <button disabled={request.status === "Rejected"} onClick={() => updateStatus(request.id, "Rejected")}>Reject</button>
                </span>
              </div>
            ))
          ) : (
            <div className="expense-empty">
              <EmptyState text="No expenses added currently" subtext="Add an employee expense to start the approval list." variant="large" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatExpenseDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");
}

function ExpenseMetric({ label, value, tone }) {
  return (
    <div className={`expense-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LearningPage({ title, copy, panelTitle, panelCopy, items, footer, button, customBlock }) {
  return (
    <div className="learning-page">
      <div className="learning-intro">
        <h1>{title}</h1>
        <p>{copy}</p>
        <PersonIllustration />
      </div>
      <div className="learning-panel">
        <h2>{panelTitle}</h2>
        {panelCopy && <p>{panelCopy}</p>}
        <div className="learning-list">
          {items.map(([name, description, icon]) => <FeatureRow key={name} title={name} text={description} icon={icon} />)}
          {customBlock}
        </div>
        <div className="panel-footer">
          {footer && <span>{footer}</span>}
          {button && <button className="primary-button">{button}</button>}
          {!button && <div className="pager"><button aria-label="Previous">&lt;</button><button aria-label="Next">&gt;</button></div>}
        </div>
      </div>
    </div>
  );
}

function FeatureRow({ title, text, icon }) {
  return <div className="feature-row"><span><Icon name={icon} /></span><div><h3>{title}</h3><p>{text}</p></div></div>;
}

function FilesPage() {
  return (
    <div className="files-page">
      <div className="action-row"><button className="outline-blue">Manage</button><IconButton icon="list" /><IconButton icon="folder" /><IconButton icon="filter" /></div>
      <EmptyState text="No shared files to display" subtext="Files shared to you by other employees will be listed here" variant="large" />
    </div>
  );
}

function TasksPage() {
  return (
    <div className="tasks-page">
      <div className="task-toolbar">
        <button>Total <b>0</b></button><button className="outline-blue">Open <b>0</b></button><button>Completed <b className="green">0</b></button>
        <span />
        <button className="primary-button">Add Task</button><IconButton icon="filter" />
      </div>
      <EmptyState text="No tasks to list here" variant="large" task />
    </div>
  );
}

function SimpleEmptyPage({ empty }) {
  return <div className="simple-page"><EmptyState text={empty} variant="large" /></div>;
}

function ServicePlaceholder({ module }) {
  return (
    <div className="simple-page">
      <EmptyState text={`${module?.label || "Module"} records will be listed here`} variant="large" />
    </div>
  );
}

function EmptyState({ text, subtext, variant, task }) {
  return (
    <div className={`empty-state ${variant || ""}`}>
      <EmptyIllustration task={task} />
      <h2>{text}</h2>
      {subtext && <p>{subtext}</p>}
    </div>
  );
}

function EmptyIllustration({ variant, task }) {
  return (
    <svg className="empty-illustration" viewBox="0 0 220 150" aria-hidden="true">
      <ellipse cx="110" cy="118" rx="78" ry="12" fill="#dce5fb" />
      <circle cx="112" cy="74" r="52" fill="#eef3fc" />
      {task || variant === "clipboard" ? <rect x="85" y="28" width="62" height="82" rx="6" fill="#4c73e5" /> : <path d="M72 88 132 58l30 25-61 31Z" fill="#5b7dea" />}
      {task || variant === "clipboard" ? <><rect x="96" y="43" width="39" height="8" rx="3" fill="#eef4ff" /><path d="M98 62h36M98 77h36M98 92h25" stroke="#eef4ff" strokeWidth="6" strokeLinecap="round" /></> : <path d="M96 76 132 58l30 25-39 15Z" fill="#86a1f2" />}
      <circle cx="105" cy="55" r="30" fill="#fff" stroke="#4770e4" strokeWidth="2" />
      <circle cx="123" cy="61" r="8" fill="#4770e4" />
      <path d="M93 90h44v21H93z" fill="#4b73e5" />
      <path d="M93 96h44M94 104h42" stroke="#fff" strokeWidth="5" />
      <circle cx="104" cy="119" r="7" fill="#fff" stroke="#4770e4" />
      <circle cx="126" cy="119" r="7" fill="#fff" stroke="#4770e4" />
      <circle cx="109" cy="14" r="4" fill="#ff6262" />
      <path d="M108 18v12" stroke="#4770e4" strokeWidth="2" />
      <circle cx="64" cy="44" r="2" fill="#4770e4" />
      <circle cx="154" cy="38" r="2" fill="#4770e4" />
    </svg>
  );
}

function PersonIllustration() {
  return (
    <svg className="person-illustration" viewBox="0 0 520 360" aria-hidden="true">
      <rect x="130" y="50" width="190" height="120" rx="12" fill="#eaf0ff" />
      <rect x="165" y="92" width="150" height="70" rx="8" fill="#fff" />
      <circle cx="210" cy="126" r="24" fill="#ef6c4f" />
      <path d="M198 146c8-15 24-15 33 0" stroke="#fff" strokeWidth="8" fill="none" />
      <path d="M260 98l8 17 18 2-13 12 3 18-16-9-16 9 3-18-13-12 18-2zM310 98l8 17 18 2-13 12 3 18-16-9-16 9 3-18-13-12 18-2zM360 98l8 17 18 2-13 12 3 18-16-9-16 9 3-18-13-12 18-2z" transform="scale(.45) translate(330 110)" fill="#ffb400" />
      <path d="M150 305h260M190 190l-40 115M375 190l42 115" stroke="#111" strokeWidth="4" />
      <rect x="176" y="182" width="230" height="82" rx="5" fill="#f7f9fd" stroke="#111" strokeWidth="3" />
      <path d="M317 180c30 6 50 35 42 86" stroke="#3267ec" strokeWidth="16" fill="none" />
      <path d="M285 260c40 55 80 55 103 31" stroke="#3267ec" strokeWidth="26" fill="none" />
      <path d="M340 230c-18-24-13-52 15-71 26 28 18 56-15 71Z" fill="#ff7047" />
      <circle cx="360" cy="145" r="18" fill="#ff8d69" />
      <path d="M337 146c5-33 35-42 60-18-2 38-31 50-60 18Z" fill="#365cf3" />
      <rect x="245" y="218" width="85" height="45" rx="4" fill="#eef2ff" stroke="#111" strokeWidth="3" />
      <path d="M286 240h8" stroke="#111" strokeWidth="3" />
    </svg>
  );
}

function InspiteLogo() {
  return (
    <div className="inspite-logo">
      <span className="cube blue" /><span className="cube green" /><span className="cube orange" />
      <strong>Inspite<br />People</strong>
    </div>
  );
}

function TourOverlay({ onClose }) {
  return (
    <div className="tour-shade">
      <div className="tour-card">
        <div className="tour-head"><h2>Home</h2><button onClick={onClose}>Skip</button></div>
        <p>Your new home in Inspite People! with My Space, Team, and Organization spaces.</p>
        <ul>
          <li>Start your day with important contextual updates from the Actions List feature</li>
          <li>Collaborate and engage with your team effortlessly in the new Team space</li>
          <li>Post announcements and stay informed with the new Organization Space</li>
        </ul>
      </div>
    </div>
  );
}

function RightRail({ session, onLogout }) {
  const initial = (session?.name || session?.email || "U").trim().charAt(0).toUpperCase();
  return (
    <aside className="right-rail">
      <button className="session-avatar" title={session?.email || "Signed in"}>{initial}</button>
      <button className="logout-button" onClick={onLogout}>Sign out</button>
      <IconButton icon="userGear" />
      <IconButton icon="rocket" />
      <span />
      <button className="plain-icon">♿</button>
      <button className="plain-icon">☾</button>
    </aside>
  );
}

function ChatBar() {
  return <div className="chat-bar"><span>Chats</span><span>Contacts</span><input placeholder="Here is your Smart Chat (Ctrl+Space)" /><button>◀</button><button className="chat-active">▣</button><button>⌕</button><button>▱</button></div>;
}

export default App;


