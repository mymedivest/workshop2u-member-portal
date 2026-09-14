/* =========================================================================
   WORKSHOP2U — FRONT-END LOGIC (full feature set)
   Talks to a Google Apps Script Web App (Code.gs). Set CONFIG.API_URL below.
   ========================================================================= */

const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbzQO0bFEfT3dNEhX2ijR9hytr78pfTEC5k64Z4m0Kpnj_TufQzCohKLb0lkH3GQSECu/exec",
  //WHATSAPP_NUMBER: "60137137100" // digits only, country code first — used by the WhatsApp button
  WHATSAPP_NUMBER: "60123456495" // digits only, country code first — used by the WhatsApp button
};

const SESSION_KEY = "w2u_session";
let pendingOtpUsername = null;
let currentAnalyticsChart = null;

/* -------------------------------------------------------------------------
   Low-level API helper. POSTs as text/plain to avoid a CORS preflight,
   which is the standard workaround for calling Apps Script cross-origin.
------------------------------------------------------------------------- */
async function apiCall(action, payload = {}) {
  if (CONFIG.API_URL.includes("REPLACE_WITH_YOUR_DEPLOYMENT_ID")) {
    return { success: false, message: "Backend not configured yet. Set CONFIG.API_URL in script.js." };
  }
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload })
    });
    return await res.json();
  } catch (err) {
    console.error("API error:", err);
    return { success: false, message: "Network error contacting server. Please try again." };
  }
}

function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } }
function setSession(data) { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function showMsg(el, text, ok) { el.textContent = text; el.className = "form-msg show " + (ok ? "ok" : "err"); }
function money(n) { return "RM " + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function siteUrl() { return window.location.origin + window.location.pathname; }

/* -------------------------------------------------------------------------
   Nav (mobile toggle)
------------------------------------------------------------------------- */
document.getElementById("navToggle").addEventListener("click", () => document.getElementById("navLinks").classList.toggle("open"));
document.querySelectorAll(".nav-links a").forEach(a => a.addEventListener("click", () => document.getElementById("navLinks").classList.remove("open")));

/* -------------------------------------------------------------------------
   FEATURE 13 — booking form CAPTCHA (math challenge) + honeypot
------------------------------------------------------------------------- */
let captchaAnswer = 0;
function newCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  captchaAnswer = a + b;
  document.getElementById("captchaQuestion").textContent = `What is ${a} + ${b}?`;
  document.getElementById("captchaInput").value = "";
}
newCaptcha();

/* -------------------------------------------------------------------------
   FEATURE 10 — WhatsApp float button
------------------------------------------------------------------------- */
document.getElementById("whatsappFloat").href =
  `https://wa.me/${CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent("Hi Workshop2U, I'd like to ask about your services.")}`;

/* -------------------------------------------------------------------------
   Public booking form
------------------------------------------------------------------------- */
const bookingForm = document.getElementById("bookingForm");
bookingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("bkSubmit");
  const msg = document.getElementById("bkMsg");

  if (Number(document.getElementById("captchaInput").value) !== captchaAnswer) {
    showMsg(msg, "That answer doesn't look right — please try the sum again.", false);
    newCaptcha();
    return;
  }

  btn.disabled = true; btn.textContent = "Submitting...";
  const booking = {
    name: document.getElementById("bkName").value.trim(),
    phone: document.getElementById("bkPhone").value.trim(),
    email: document.getElementById("bkEmail").value.trim(),
    workshop: document.getElementById("bkWorkshop").value,
    vehicleType: document.getElementById("bkVehicleType").value.trim(),
    plate: document.getElementById("bkPlate").value.trim(),
    serviceType: document.getElementById("bkService").value,
    date: document.getElementById("bkDate").value,
    time: document.getElementById("bkTime").value,
    notes: document.getElementById("bkNotes").value.trim(),
    website: document.getElementById("bkWebsite").value // honeypot — must stay empty
  };

  const result = await apiCall("bookAppointment", { booking });
  btn.disabled = false; btn.textContent = "Request Appointment";

  if (result.success) {
    showMsg(msg, "Thanks! Your appointment request has been received — we'll confirm by email shortly.", true);
    bookingForm.reset();
    newCaptcha();
  } else {
    showMsg(msg, result.message || "Something went wrong. Please try again.", false);
  }
});

/* -------------------------------------------------------------------------
   Login  (+ FEATURE 4 OTP step, + FEATURE 5 lockout messaging, + FEATURE 6 forgot password)
------------------------------------------------------------------------- */
const loginForm = document.getElementById("loginForm");
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("loginSubmit");
  const msg = document.getElementById("loginMsg");
  btn.disabled = true; btn.textContent = "Logging in...";

  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value;
  const result = await apiCall("login", { username, password });

  btn.disabled = false; btn.textContent = "Log In";

  if (result.success && result.otpRequired) {
    pendingOtpUsername = result.username;
    document.getElementById("loginPanel").classList.add("hidden");
    document.getElementById("otpPanel").classList.remove("hidden");
    document.getElementById("otpHint").textContent = "We emailed a 6-digit code to the account " + result.username + ".";
    msg.className = "form-msg";
  } else if (result.success) {
    setSession(result.user);
    loginForm.reset();
    msg.className = "form-msg";
    enterDashboard(result.user);
  } else {
    showMsg(msg, result.message || "Invalid username or password.", false);
  }
});

const otpForm = document.getElementById("otpForm");
otpForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("otpMsg");
  const code = document.getElementById("otpCode").value.trim();
  const result = await apiCall("verifyOtp", { username: pendingOtpUsername, code });
  if (result.success) {
    setSession(result.user);
    otpForm.reset();
    document.getElementById("otpPanel").classList.add("hidden");
    enterDashboard(result.user);
  } else {
    showMsg(msg, result.message || "Incorrect code.", false);
  }
});
document.getElementById("otpBack").addEventListener("click", () => {
  document.getElementById("otpPanel").classList.add("hidden");
  document.getElementById("loginPanel").classList.remove("hidden");
  otpForm.reset();
});

document.getElementById("showForgotPassword").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("loginPanel").classList.add("hidden");
  document.getElementById("forgotPanel").classList.remove("hidden");
});
document.getElementById("forgotBack").addEventListener("click", () => {
  document.getElementById("forgotPanel").classList.add("hidden");
  document.getElementById("loginPanel").classList.remove("hidden");
});
document.getElementById("forgotRequestForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("forgotRequestMsg");
  const usernameOrEmail = document.getElementById("forgotIdentifier").value.trim();
  const result = await apiCall("requestPasswordReset", { usernameOrEmail });
  showMsg(msg, result.message || "If that account exists, a reset code has been emailed to it.", true);
  document.getElementById("resetUsername").value = usernameOrEmail;
  document.getElementById("forgotResetForm").classList.remove("hidden");
});
document.getElementById("forgotResetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("forgotResetMsg");
  const username = document.getElementById("resetUsername").value.trim();
  const code = document.getElementById("resetCode").value.trim();
  const newPassword = document.getElementById("resetNewPassword").value;
  const result = await apiCall("resetPassword", { username, code, newPassword });
  if (result.success) {
    showMsg(msg, "Password updated! You can now log in.", true);
    setTimeout(() => {
      document.getElementById("forgotPanel").classList.add("hidden");
      document.getElementById("loginPanel").classList.remove("hidden");
      document.getElementById("forgotResetForm").classList.add("hidden");
      document.getElementById("forgotRequestForm").reset();
      document.getElementById("forgotResetForm").reset();
    }, 1500);
  } else {
    showMsg(msg, result.message || "Could not reset password.", false);
  }
});

/* -------------------------------------------------------------------------
   Entering dashboards
------------------------------------------------------------------------- */
function enterDashboard(user) {
  document.getElementById("loginPanel").classList.add("hidden");
  document.getElementById("otpPanel").classList.add("hidden");
  document.getElementById("forgotPanel").classList.add("hidden");

  if (user.role === "member") {
    document.getElementById("memberDashboard").classList.remove("hidden");
    document.getElementById("staffDashboard").classList.add("hidden");
    document.getElementById("memName").textContent = user.fullName;
    loadMemberProfile(user);
    loadMemberVehicles();
    loadMemberHistory();
  } else {
    document.getElementById("staffDashboard").classList.remove("hidden");
    document.getElementById("memberDashboard").classList.add("hidden");
    document.getElementById("staffName").textContent = user.fullName;
    document.getElementById("staffRoleBadge").textContent = user.role.toUpperCase();
    setupStaffScope(user);
    loadStaffHistory();
    loadStaffMembers();
    loadBookings();
    loadAnalytics();
    if (user.role === "webmaster") {
      document.getElementById("tabAccounts").classList.remove("hidden");
      document.getElementById("tabAuditLog").classList.remove("hidden");
      loadAccounts();
      loadAuditLog();
    }
  }
}

function setupStaffScope(user) {
  const wsFilter = document.getElementById("staffWorkshopFilter");
  const memFilter = document.getElementById("staffMemberWorkshopFilter");
  const bkFilter = document.getElementById("staffBookingWorkshopFilter");
  const ahWorkshop = document.getElementById("ahWorkshop");
  const amWorkshop = document.getElementById("amWorkshop");

  if (user.role === "admin") {
    [wsFilter, memFilter, bkFilter].forEach(sel => { sel.innerHTML = `<option value="${user.workshop}">${user.workshop}</option>`; sel.disabled = true; });
    ahWorkshop.value = user.workshop; ahWorkshop.disabled = true;
    amWorkshop.value = user.workshop; amWorkshop.disabled = true;
    document.getElementById("staffScope").textContent = user.workshop;
  } else {
    document.getElementById("staffScope").textContent = "All Locations";
  }
}

function logoutAll() {
  const session = getSession();
  if (session) apiCall("logout", { token: session.token });
  clearSession();
  document.getElementById("memberDashboard").classList.add("hidden");
  document.getElementById("staffDashboard").classList.add("hidden");
  document.getElementById("loginPanel").classList.remove("hidden");
}
document.getElementById("memLogout").addEventListener("click", logoutAll);
document.getElementById("staffLogout").addEventListener("click", logoutAll);

/* -------------------------------------------------------------------------
   Dashboard tab switching
------------------------------------------------------------------------- */
document.querySelectorAll(".dash-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const group = tab.closest("#memberDashboard, #staffDashboard");
    group.querySelectorAll(".dash-tab").forEach(t => t.classList.remove("active"));
    group.querySelectorAll(".dash-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "staffAnalyticsPanel") loadAnalytics();
  });
});

/* -------------------------------------------------------------------------
   FEATURE 12 — export helpers (CSV + print/PDF)
------------------------------------------------------------------------- */
function tableToCSV(table) {
  const rows = [...table.querySelectorAll("tr")].filter(tr => !tr.classList.contains("empty-row"));
  return rows.map(tr => [...tr.children].map(td => {
    const text = td.textContent.replace(/"/g, '""');
    return `"${text}"`;
  }).join(",")).join("\n");
}
function downloadCSV(tableId, filename) {
  const table = document.getElementById(tableId);
  const csv = tableToCSV(table);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
document.getElementById("memExportCsv").addEventListener("click", () => downloadCSV("memHistoryTable", "my-service-history.csv"));
document.getElementById("memPrint").addEventListener("click", () => window.print());
document.getElementById("staffExportCsv").addEventListener("click", () => downloadCSV("staffHistoryTable", "service-history.csv"));
document.getElementById("staffPrint").addEventListener("click", () => window.print());

/* -------------------------------------------------------------------------
   Member dashboard data  (+ FEATURE 9 vehicles, + FEATURE 1 next-due display)
------------------------------------------------------------------------- */
function loadMemberProfile(user) {
  document.getElementById("memProfName").value = user.fullName || "";
  document.getElementById("memProfAddress").value = user.address || "";
  document.getElementById("memProfPhone").value = user.phone || "";
  document.getElementById("memProfEmail").value = user.email || "";
}

async function loadMemberVehicles() {
  const session = getSession();
  const result = await apiCall("getVehicles", { token: session.token });
  const select = document.getElementById("memVehicleFilter");
  const listEl = document.getElementById("memVehicleList");
  select.innerHTML = `<option value="All">All my vehicles</option>`;
  if (!result.success || !result.vehicles.length) {
    listEl.innerHTML = `<p>No vehicles on file yet — they'll appear automatically after your first service.</p>`;
    return;
  }
  result.vehicles.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.plate;
    opt.textContent = `${v.plate} — ${v.vehicleType}`;
    select.appendChild(opt);
  });
  listEl.innerHTML = result.vehicles.map(v => `
    <div class="feature-card" style="margin-bottom:14px">
      <h3>${v.plate}</h3><p>${v.vehicleType}</p>
    </div>`).join("");
}
document.getElementById("memVehicleFilter").addEventListener("change", loadMemberHistory);

async function loadMemberHistory() {
  const session = getSession();
  const tbody = document.getElementById("memHistoryBody");
  tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Loading...</td></tr>`;
  const plate = document.getElementById("memVehicleFilter").value;
  const result = await apiCall("getHistory", { token: session.token, plate });

  if (!result.success) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${result.message || "Could not load history."}</td></tr>`; return; }
  const rows = result.history || [];
  tbody.innerHTML = rows.length ? rows.map(r => `
      <tr><td>${r.date}</td><td>${r.vehicleType}</td><td>${r.plate}</td><td>${r.workshop}</td><td>${r.serviceType}</td><td>${money(r.price)}</td><td>${r.notes || ""}</td></tr>`).join("")
    : `<tr class="empty-row"><td colspan="7">No service history yet.</td></tr>`;

  document.getElementById("memTotalServices").textContent = rows.length;
  document.getElementById("memTotalSpent").textContent = money(rows.reduce((s, r) => s + Number(r.price || 0), 0));
  document.getElementById("memLastDate").textContent = rows.length ? rows[0].date : "—";
  document.getElementById("memNextDue").textContent = result.nextServiceDue || "—";
}

document.getElementById("memPasswordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const session = getSession();
  const msg = document.getElementById("memPasswordMsg");
  const oldPassword = document.getElementById("memOldPass").value;
  const newPassword = document.getElementById("memNewPass").value;
  const result = await apiCall("changePassword", { token: session.token, oldPassword, newPassword });
  if (result.success) { showMsg(msg, "Password updated successfully.", true); e.target.reset(); }
  else showMsg(msg, result.message || "Could not update password.", false);
});

/* -------------------------------------------------------------------------
   Staff dashboard — Service History
------------------------------------------------------------------------- */
async function loadStaffHistory() {
  const session = getSession();
  const tbody = document.getElementById("staffHistoryBody");
  tbody.innerHTML = `<tr class="empty-row"><td colspan="9">Loading...</td></tr>`;
  const workshop = document.getElementById("staffWorkshopFilter").value;
  const search = document.getElementById("staffSearch").value.trim().toLowerCase();

  const result = await apiCall("getHistory", { token: session.token, workshop });
  if (!result.success) { tbody.innerHTML = `<tr class="empty-row"><td colspan="9">${result.message || "Could not load history."}</td></tr>`; return; }
  let rows = result.history || [];
  if (search) rows = rows.filter(r => (r.plate || "").toLowerCase().includes(search) || (r.name || "").toLowerCase().includes(search));

  tbody.innerHTML = rows.length ? rows.map(r => `
      <tr><td>${r.date}</td><td>${r.name}</td><td>${r.address || ""}</td><td>${r.vehicleType}</td><td>${r.plate}</td><td>${r.workshop}</td><td>${r.serviceType}</td><td>${money(r.price)}</td><td>${r.notes || ""}</td></tr>`).join("")
    : `<tr class="empty-row"><td colspan="9">No service records found.</td></tr>`;

  document.getElementById("staffTotalServices").textContent = rows.length;
  document.getElementById("staffTotalRevenue").textContent = money(rows.reduce((s, r) => s + Number(r.price || 0), 0));
}
document.getElementById("staffRefresh").addEventListener("click", loadStaffHistory);
document.getElementById("staffWorkshopFilter").addEventListener("change", loadStaffHistory);
document.getElementById("staffSearch").addEventListener("input", () => { clearTimeout(window._searchDebounce); window._searchDebounce = setTimeout(loadStaffHistory, 300); });

document.getElementById("addHistoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const session = getSession();
  const msg = document.getElementById("addHistoryMsg");
  const record = {
    date: document.getElementById("ahDate").value,
    username: document.getElementById("ahUsername").value.trim(),
    name: document.getElementById("ahName").value.trim(),
    address: document.getElementById("ahAddress").value.trim(),
    vehicleType: document.getElementById("ahVehicleType").value.trim(),
    plate: document.getElementById("ahPlate").value.trim(),
    workshop: document.getElementById("ahWorkshop").value,
    serviceType: document.getElementById("ahServiceType").value,
    price: document.getElementById("ahPrice").value,
    notes: document.getElementById("ahNotes").value.trim()
  };
  const result = await apiCall("addHistory", { token: session.token, record, siteUrl: siteUrl() });
  if (result.success) {
    showMsg(msg, "Service record saved — invoice emailed to the customer if we have their email on file.", true);
    e.target.reset();
    if (getSession().role === "admin") document.getElementById("ahWorkshop").value = getSession().workshop;
    loadStaffHistory();
    loadAnalytics();
  } else {
    showMsg(msg, result.message || "Could not save record.", false);
  }
});

/* -------------------------------------------------------------------------
   Staff dashboard — Members
------------------------------------------------------------------------- */
async function loadStaffMembers() {
  const session = getSession();
  const tbody = document.getElementById("staffMembersBody");
  tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Loading...</td></tr>`;
  const workshop = document.getElementById("staffMemberWorkshopFilter").value;
  const result = await apiCall("getMembers", { token: session.token, workshop });
  if (!result.success) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${result.message || "Could not load members."}</td></tr>`; return; }
  const rows = result.members || [];
  tbody.innerHTML = rows.length ? rows.map(m => `
      <tr><td>${m.username}</td><td>${m.fullName}</td><td>${m.address || ""}</td><td>${m.phone || ""}</td><td>${m.email || ""}</td><td>${m.workshop}</td>
      <td><span class="tag ${m.status === 'Active' ? 'active' : 'inactive'}">${m.status}</span></td></tr>`).join("")
    : `<tr class="empty-row"><td colspan="7">No members found.</td></tr>`;
  document.getElementById("staffTotalMembers").textContent = rows.length;
}
document.getElementById("staffMembersRefresh").addEventListener("click", loadStaffMembers);
document.getElementById("staffMemberWorkshopFilter").addEventListener("change", loadStaffMembers);

document.getElementById("addMemberForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const session = getSession();
  const msg = document.getElementById("addMemberMsg");
  const member = {
    username: document.getElementById("amUsername").value.trim(),
    password: document.getElementById("amPassword").value,
    fullName: document.getElementById("amName").value.trim(),
    phone: document.getElementById("amPhone").value.trim(),
    address: document.getElementById("amAddress").value.trim(),
    email: document.getElementById("amEmail").value.trim(),
    workshop: document.getElementById("amWorkshop").value,
    role: "member"
  };
  const result = await apiCall("addMember", { token: session.token, member });
  if (result.success) {
    showMsg(msg, "Member account created.", true);
    e.target.reset();
    if (getSession().role === "admin") document.getElementById("amWorkshop").value = getSession().workshop;
    loadStaffMembers();
  } else {
    showMsg(msg, result.message || "Could not create member.", false);
  }
});

/* -------------------------------------------------------------------------
   FEATURE 2 — Booking approval workflow
------------------------------------------------------------------------- */
async function loadBookings() {
  const session = getSession();
  const tbody = document.getElementById("bookingsBody");
  tbody.innerHTML = `<tr class="empty-row"><td colspan="9">Loading...</td></tr>`;
  const workshop = document.getElementById("staffBookingWorkshopFilter").value;
  const result = await apiCall("getBookings", { token: session.token, workshop });
  if (!result.success) { tbody.innerHTML = `<tr class="empty-row"><td colspan="9">${result.message || "Could not load bookings."}</td></tr>`; return; }
  const rows = result.bookings || [];
  tbody.innerHTML = rows.length ? rows.map(b => `
      <tr>
        <td>${b.date} ${b.time}</td><td>${b.name}</td><td>${b.phone}</td><td>${b.vehicleType} (${b.plate})</td>
        <td>${b.workshop}</td><td>${b.serviceType}</td>
        <td><span class="tag ${b.status === 'Confirmed' ? 'active' : (b.status === 'Rejected' ? 'inactive' : '')}">${b.status}</span></td>
        <td>${b.notes || ""}</td>
        <td>
          <button class="btn btn-ghost btn-small" data-act="Confirmed" data-id="${b.id}">Confirm</button>
          <button class="btn btn-ghost btn-small" data-act="Rejected" data-id="${b.id}">Reject</button>
          <button class="btn btn-ghost btn-small" data-act="reschedule" data-id="${b.id}">Reschedule</button>
        </td>
      </tr>`).join("")
    : `<tr class="empty-row"><td colspan="9">No booking requests found.</td></tr>`;

  tbody.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (btn.dataset.act === "reschedule") {
        const newDate = prompt("New date (YYYY-MM-DD):");
        if (!newDate) return;
        const newTime = prompt("New time (HH:MM):");
        await apiCall("updateBookingStatus", { token: session.token, bookingId: id, status: "Rescheduled", newDate, newTime });
      } else {
        await apiCall("updateBookingStatus", { token: session.token, bookingId: id, status: btn.dataset.act });
      }
      loadBookings();
    });
  });
}
document.getElementById("staffBookingWorkshopFilter").addEventListener("change", loadBookings);
document.getElementById("bookingsRefresh").addEventListener("click", loadBookings);

/* -------------------------------------------------------------------------
   FEATURE 7 — Analytics dashboard (Chart.js)
------------------------------------------------------------------------- */
async function loadAnalytics() {
  const session = getSession();
  const canvas = document.getElementById("analyticsChart");
  const result = await apiCall("getAnalytics", { token: session.token });
  if (!result.success) return;

  document.getElementById("anaTotalRevenue").textContent = money(result.totalRevenue);
  document.getElementById("anaTotalJobs").textContent = result.totalJobs;

  const palette = { "Melaka": "#f2a71b", "Negeri Sembilan": "#5b6472", "Johor": "#2f8f5b" };
  const datasets = result.workshops.map(w => ({
    label: w,
    data: result.revenueSeries[w],
    backgroundColor: palette[w] || "#98a1ad"
  }));

  if (currentAnalyticsChart) currentAnalyticsChart.destroy();
  currentAnalyticsChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: { labels: result.months, datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#eef0f2" } }, title: { display: true, text: "Monthly revenue by workshop (RM)", color: "#eef0f2" } },
      scales: {
        x: { ticks: { color: "#98a1ad" }, grid: { color: "#2a323c" } },
        y: { ticks: { color: "#98a1ad" }, grid: { color: "#2a323c" } }
      }
    }
  });
}

/* -------------------------------------------------------------------------
   FEATURE 11 — Webmaster: accounts + audit log
------------------------------------------------------------------------- */
async function loadAccounts() {
  const session = getSession();
  const tbody = document.getElementById("accountsBody");
  tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Loading...</td></tr>`;
  const result = await apiCall("getAccounts", { token: session.token });
  if (!result.success) { tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${result.message || "Could not load accounts."}</td></tr>`; return; }
  const rows = result.accounts || [];
  tbody.innerHTML = rows.map(a => `
    <tr><td>${a.username}</td><td>${a.role}</td><td>${a.workshop}</td><td>${a.fullName}</td>
      <td><span class="tag ${a.status === 'Active' ? 'active' : 'inactive'}">${a.status}</span></td>
      <td>
        <button class="btn btn-ghost btn-small" data-act="toggle" data-user="${a.username}">${a.status === 'Active' ? 'Deactivate' : 'Activate'}</button>
        <button class="btn btn-ghost btn-small" data-act="reset" data-user="${a.username}">Reset Password</button>
      </td></tr>`).join("");

  tbody.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const username = btn.dataset.user;
      if (btn.dataset.act === "toggle") {
        const row = rows.find(r => r.username === username);
        const newStatus = row.status === "Active" ? "Inactive" : "Active";
        await apiCall("updateAccount", { token: session.token, username, updates: { status: newStatus } });
        loadAccounts();
      } else {
        const newPass = prompt("Enter a new temporary password for " + username + ":");
        if (newPass) { await apiCall("updateAccount", { token: session.token, username, updates: { password: newPass } }); alert("Password reset."); }
      }
    });
  });
}

document.getElementById("addStaffForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const session = getSession();
  const msg = document.getElementById("addStaffMsg");
  const member = {
    username: document.getElementById("asUsername").value.trim(),
    password: document.getElementById("asPassword").value,
    fullName: document.getElementById("asName").value.trim(),
    role: document.getElementById("asRole").value,
    workshop: document.getElementById("asWorkshop").value
  };
  const result = await apiCall("addMember", { token: session.token, member });
  if (result.success) { showMsg(msg, "Staff account created.", true); e.target.reset(); loadAccounts(); }
  else showMsg(msg, result.message || "Could not create account.", false);
});

async function loadAuditLog() {
  const session = getSession();
  const tbody = document.getElementById("auditLogBody");
  tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Loading...</td></tr>`;
  const result = await apiCall("getAuditLog", { token: session.token });
  if (!result.success) { tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${result.message || "Could not load audit log."}</td></tr>`; return; }
  const rows = result.log || [];
  tbody.innerHTML = rows.length ? rows.map(r => `<tr><td>${r.timestamp}</td><td>${r.username}</td><td>${r.role}</td><td>${r.action}</td><td>${r.details}</td></tr>`).join("")
    : `<tr class="empty-row"><td colspan="5">No activity recorded yet.</td></tr>`;
}
document.getElementById("auditLogRefresh").addEventListener("click", loadAuditLog);

/* -------------------------------------------------------------------------
   FEATURE 8 — Review submission (triggered via ?review=TOKEN in the URL)
------------------------------------------------------------------------- */
let selectedRating = 0;
function initReviewFlow() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("review");
  if (!token) return;

  apiCall("getReviewContext", { reviewToken: token }).then(result => {
    const modal = document.getElementById("reviewModal");
    modal.classList.remove("hidden");
    if (!result.success) {
      document.getElementById("reviewBody").innerHTML = `<p>${result.message}</p>`;
      return;
    }
    document.getElementById("reviewWorkshopName").textContent = result.workshop;
    document.getElementById("reviewForm").dataset.token = token;
  });
}

document.querySelectorAll(".star-btn").forEach(star => {
  star.addEventListener("click", () => {
    selectedRating = Number(star.dataset.value);
    document.querySelectorAll(".star-btn").forEach(s => s.classList.toggle("selected", Number(s.dataset.value) <= selectedRating));
  });
});
document.getElementById("reviewForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("reviewMsg");
  const token = e.target.dataset.token;
  const comment = document.getElementById("reviewComment").value.trim();
  const result = await apiCall("submitReview", { reviewToken: token, rating: selectedRating, comment });
  if (result.success) {
    document.getElementById("reviewBody").innerHTML = `<p>Thank you for your feedback!</p>`;
    showMsg(msg, "", true); msg.className = "form-msg";
  } else {
    showMsg(msg, result.message || "Could not submit review.", false);
  }
});
document.getElementById("reviewClose").addEventListener("click", () => {
  document.getElementById("reviewModal").classList.add("hidden");
  const url = new URL(window.location);
  url.searchParams.delete("review");
  window.history.replaceState({}, "", url);
});

/* -------------------------------------------------------------------------
   Restore session on page load
------------------------------------------------------------------------- */
(async function init() {
  initReviewFlow();
  const session = getSession();
  if (!session) return;
  const result = await apiCall("validateSession", { token: session.token });
  if (result.success) enterDashboard(session); else clearSession();
})();
