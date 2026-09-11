/**
 * ==========================================================================
 * WORKSHOP2U — GOOGLE APPS SCRIPT BACKEND (full feature set)
 * ==========================================================================
 * Deploy as a Web App bound to the Google Sheet. Exposes one POST endpoint
 * routed by an "action" field. Run initializeSheet() once to create tabs.
 *
 * TABS (all created by initializeSheet):
 *   Credentials    Username | PasswordHash | Role | WorkshopLocation |
 *                  FullName | Address | Phone | Email | Status | CreatedDate
 *   History        Timestamp | Date | Username | Name | CustomerAddress |
 *                  VehicleType | VehiclePlateNumber | WorkshopLocation |
 *                  ServiceType | Price | Notes | ReviewToken
 *   Bookings       BookingID | Timestamp | Name | Phone | Email |
 *                  VehicleType | VehiclePlateNumber | PreferredDate |
 *                  PreferredTime | WorkshopLocation | ServiceType | Notes | Status
 *   Sessions       Token | Username | Role | WorkshopLocation | FullName |
 *                  CreatedAt | ExpiresAt
 *   Vehicles       Username | PlateNumber | VehicleType | Nickname
 *   LoginAttempts  Username | FailCount | LockUntil
 *   OtpCodes       Username | Code | CreatedAt | ExpiresAt
 *   PasswordResets Token | Username | CreatedAt | ExpiresAt
 *   Reviews        ReviewToken | Username | Workshop | Rating | Comment |
 *                  Status | CreatedAt | SubmittedAt
 *   AuditLog       Timestamp | Username | Role | Action | Details
 *   Reminders      PlateNumber | Username | LastReminderSent
 * ==========================================================================
 */

// ---- Configuration ----------------------------------------------------------
const SESSION_LENGTH_HOURS = 12;
const OTP_LENGTH_MINUTES = 5;
const RESET_CODE_LENGTH_MINUTES = 30;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const REMINDER_INTERVAL_DAYS = 180;   // remind customer ~6 months after last service
const REMINDER_LOOKAHEAD_DAYS = 7;    // send reminder when due date is within this window
const REMINDER_COOLDOWN_DAYS = 30;    // don't re-send a reminder more than once a month
const WORKSHOP_NOTIFY_EMAILS = {
  "Melaka": "melaka@workshop2u.com.my",
  "Negeri Sembilan": "ns@workshop2u.com.my",
  "Johor": "johor@workshop2u.com.my"
};

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) { return ss_().getSheetByName(name); }
function tz_() { return Session.getScriptTimeZone() || "Asia/Kuala_Lumpur"; }

// ---- Entry points -------------------------------------------------------------
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {
    return jsonOut_({ success: false, message: "Invalid request." });
  }
  const action = body.action;
  try {
    switch (action) {
      case "login": return jsonOut_(login_(body));
      case "verifyOtp": return jsonOut_(verifyOtp_(body));
      case "validateSession": return jsonOut_(validateSession_(body.token));
      case "logout": return jsonOut_(logout_(body.token));
      case "requestPasswordReset": return jsonOut_(requestPasswordReset_(body));
      case "resetPassword": return jsonOut_(resetPassword_(body));
      case "changePassword": return jsonOut_(changePassword_(body));

      case "getHistory": return jsonOut_(getHistory_(body));
      case "addHistory": return jsonOut_(addHistory_(body));

      case "getMembers": return jsonOut_(getMembers_(body));
      case "addMember": return jsonOut_(addMember_(body));
      case "getVehicles": return jsonOut_(getVehicles_(body));

      case "getAccounts": return jsonOut_(getAccounts_(body));
      case "updateAccount": return jsonOut_(updateAccount_(body));

      case "bookAppointment": return jsonOut_(bookAppointment_(body));
      case "getBookings": return jsonOut_(getBookings_(body));
      case "updateBookingStatus": return jsonOut_(updateBookingStatus_(body));

      case "getAnalytics": return jsonOut_(getAnalytics_(body));
      case "getAuditLog": return jsonOut_(getAuditLog_(body));

      case "getReviewContext": return jsonOut_(getReviewContext_(body));
      case "submitReview": return jsonOut_(submitReview_(body));

      default: return jsonOut_({ success: false, message: "Unknown action." });
    }
  } catch (err) {
    return jsonOut_({ success: false, message: "Server error: " + err.message });
  }
}

function doGet(e) {
  return jsonOut_({ success: true, message: "Workshop2U API is running." });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- Password hashing -----------------------------------------------------
function hashPassword_(plain) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plain, Utilities.Charset.UTF_8);
  return digest.map(b => ("0" + (b & 0xFF).toString(16)).slice(-2)).join("");
}
function randomCode_(digits) {
  let code = "";
  for (let i = 0; i < digits; i++) code += Math.floor(Math.random() * 10);
  return code;
}

// ---- Audit log --------------------------------------------------------------
function logAudit_(username, role, action, details) {
  try {
    sheet_("AuditLog").appendRow([new Date(), username || "(guest)", role || "-", action, details || ""]);
  } catch (e) { /* never block main flow because of logging */ }
}

// ---- Credentials sheet helpers ---------------------------------------------
function credentialColumns_() {
  return ["Username","PasswordHash","Role","WorkshopLocation","FullName","Address","Phone","Email","Status","CreatedDate"];
}
function findCredentialRow_(username) {
  const sh = sheet_("Credentials");
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(username).toLowerCase()) return { rowIndex: i + 1, values: data[i] };
  }
  return null;
}
function findCredentialByEmail_(email) {
  const sh = sheet_("Credentials");
  const data = sh.getDataRange().getValues();
  const cols = credentialColumns_();
  const emailIdx = cols.indexOf("Email");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]).toLowerCase() === String(email).toLowerCase()) return { rowIndex: i + 1, values: data[i] };
  }
  return null;
}
function rowToCredential_(values) {
  const cols = credentialColumns_();
  const obj = {};
  cols.forEach((c, i) => obj[c] = values[i]);
  return obj;
}

// =============================================================================
// FEATURE 5 — RATE LIMITING & LOCKOUT
// =============================================================================
function findAttemptRow_(username) {
  const sh = sheet_("LoginAttempts");
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(username).toLowerCase()) return { rowIndex: i + 1, values: data[i] };
  }
  return null;
}
function isLockedOut_(username) {
  const found = findAttemptRow_(username);
  if (!found) return { locked: false };
  const lockUntil = found.values[2];
  if (lockUntil && new Date(lockUntil).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(lockUntil).getTime() - Date.now()) / 60000);
    return { locked: true, minutesLeft: mins };
  }
  return { locked: false };
}
function registerFailedAttempt_(username) {
  const sh = sheet_("LoginAttempts");
  const found = findAttemptRow_(username);
  if (!found) {
    sh.appendRow([username, 1, ""]);
    return;
  }
  let failCount = Number(found.values[1] || 0) + 1;
  let lockUntil = "";
  if (failCount >= MAX_LOGIN_ATTEMPTS) {
    lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    failCount = 0;
  }
  sh.getRange(found.rowIndex, 2, 1, 2).setValues([[failCount, lockUntil]]);
}
function resetLoginAttempts_(username) {
  const found = findAttemptRow_(username);
  if (found) sheet_("LoginAttempts").getRange(found.rowIndex, 2, 1, 2).setValues([[0, ""]]);
}

// =============================================================================
// AUTH — login, OTP (feature 4), sessions
// =============================================================================
function login_(body) {
  const username = (body.username || "").trim();
  const password = body.password || "";
  if (!username || !password) return { success: false, message: "Username and password are required." };

  const lock = isLockedOut_(username);
  if (lock.locked) {
    return { success: false, message: "Too many failed attempts. Try again in " + lock.minutesLeft + " minute(s)." };
  }

  const found = findCredentialRow_(username);
  if (!found) { registerFailedAttempt_(username); return { success: false, message: "Invalid username or password." }; }
  const cred = rowToCredential_(found.values);

  if (String(cred.Status).toLowerCase() !== "active") {
    return { success: false, message: "This account is inactive. Please contact your workshop." };
  }
  if (hashPassword_(password) !== cred.PasswordHash) {
    registerFailedAttempt_(username);
    logAudit_(username, cred.Role, "LOGIN_FAILED", "Wrong password");
    return { success: false, message: "Invalid username or password." };
  }
  resetLoginAttempts_(username);

  // Members log straight in. Staff (admin/manager/webmaster) get a one-time
  // code emailed to them as a second factor.
  if (cred.Role === "member") {
    return { success: true, user: createSession_(cred) };
  }

  if (!cred.Email) {
    // No email on file — can't OTP, so log in directly rather than lock them out.
    logAudit_(username, cred.Role, "LOGIN_SUCCESS_NO_OTP", "No email on file, OTP skipped");
    return { success: true, user: createSession_(cred) };
  }

  const code = randomCode_(6);
  const sh = sheet_("OtpCodes");
  const data = sh.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) if (String(data[i][0]).toLowerCase() === username.toLowerCase()) { rowIndex = i + 1; break; }
  const now = new Date();
  const expires = new Date(now.getTime() + OTP_LENGTH_MINUTES * 60 * 1000);
  if (rowIndex > -1) sh.getRange(rowIndex, 1, 1, 4).setValues([[username, code, now, expires]]);
  else sh.appendRow([username, code, now, expires]);

  try {
    MailApp.sendEmail({
      to: cred.Email,
      subject: "Workshop2U — Your login verification code",
      body: "Your one-time login code is: " + code + "\n\nThis code expires in " + OTP_LENGTH_MINUTES + " minutes.\n\nIf you didn't try to log in, you can ignore this email."
    });
  } catch (e) { /* best effort */ }

  logAudit_(username, cred.Role, "LOGIN_OTP_SENT", "");
  return { success: true, otpRequired: true, username: cred.Username };
}

function verifyOtp_(body) {
  const username = (body.username || "").trim();
  const code = (body.code || "").trim();
  if (!username || !code) return { success: false, message: "Enter the code sent to your email." };

  const sh = sheet_("OtpCodes");
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === username.toLowerCase()) {
      const [ , storedCode, , expiresAt ] = data[i];
      if (new Date(expiresAt).getTime() < Date.now()) {
        sh.deleteRow(i + 1);
        return { success: false, message: "Code expired. Please log in again." };
      }
      if (String(storedCode) !== code) {
        logAudit_(username, "-", "OTP_FAILED", "");
        return { success: false, message: "Incorrect code." };
      }
      sh.deleteRow(i + 1);
      const found = findCredentialRow_(username);
      if (!found) return { success: false, message: "Account not found." };
      const cred = rowToCredential_(found.values);
      logAudit_(username, cred.Role, "LOGIN_SUCCESS", "OTP verified");
      return { success: true, user: createSession_(cred) };
    }
  }
  return { success: false, message: "No pending code for this account. Please log in again." };
}

function createSession_(cred) {
  const token = Utilities.getUuid();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_LENGTH_HOURS * 60 * 60 * 1000);
  sheet_("Sessions").appendRow([token, cred.Username, cred.Role, cred.WorkshopLocation, cred.FullName, now, expires]);
  return {
    token, username: cred.Username, role: cred.Role, workshop: cred.WorkshopLocation,
    fullName: cred.FullName, address: cred.Address, phone: cred.Phone, email: cred.Email
  };
}

function getSessionRow_(token) {
  const sh = sheet_("Sessions");
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) if (data[i][0] === token) return { rowIndex: i + 1, values: data[i] };
  return null;
}
function validateSession_(token) {
  if (!token) return { success: false, message: "No session." };
  const found = getSessionRow_(token);
  if (!found) return { success: false, message: "Session not found." };
  const [ , username, role, workshop, fullName, , expiresAt ] = found.values;
  if (new Date(expiresAt).getTime() < Date.now()) {
    sheet_("Sessions").deleteRow(found.rowIndex);
    return { success: false, message: "Session expired." };
  }
  return { success: true, user: { token, username, role, workshop, fullName } };
}
function logout_(token) {
  const found = getSessionRow_(token);
  if (found) { logAudit_(found.values[1], found.values[2], "LOGOUT", ""); sheet_("Sessions").deleteRow(found.rowIndex); }
  return { success: true };
}
function requireAuth_(token, allowedRoles) {
  const check = validateSession_(token);
  if (!check.success) return { ok: false, error: check.message };
  if (allowedRoles && allowedRoles.indexOf(check.user.role) === -1) return { ok: false, error: "You do not have permission to do this." };
  return { ok: true, user: check.user };
}

// =============================================================================
// FEATURE 6 — SELF-SERVICE PASSWORD RESET (code-based, no external link needed)
// =============================================================================
function requestPasswordReset_(body) {
  const identifier = (body.usernameOrEmail || "").trim();
  if (!identifier) return { success: false, message: "Enter your username or email." };

  let found = findCredentialRow_(identifier) || findCredentialByEmail_(identifier);
  // Always respond the same way whether or not the account exists, to avoid
  // leaking which usernames/emails are registered.
  const genericMsg = "If that account exists, a reset code has been emailed to it.";
  if (!found) return { success: true, message: genericMsg };

  const cred = rowToCredential_(found.values);
  if (!cred.Email) return { success: true, message: genericMsg };

  const code = randomCode_(6);
  const now = new Date();
  const expires = new Date(now.getTime() + RESET_CODE_LENGTH_MINUTES * 60 * 1000);
  sheet_("PasswordResets").appendRow([code, cred.Username, now, expires]);

  try {
    MailApp.sendEmail({
      to: cred.Email,
      subject: "Workshop2U — Password reset code",
      body: "Your password reset code is: " + code + "\n\nEnter this code on the Reset Password screen along with your username (" + cred.Username + ") and a new password. This code expires in " + RESET_CODE_LENGTH_MINUTES + " minutes."
    });
  } catch (e) { /* best effort */ }

  logAudit_(cred.Username, cred.Role, "PASSWORD_RESET_REQUESTED", "");
  return { success: true, message: genericMsg };
}

function resetPassword_(body) {
  const username = (body.username || "").trim();
  const code = (body.code || "").trim();
  const newPassword = body.newPassword || "";
  if (!username || !code || !newPassword) return { success: false, message: "All fields are required." };
  if (newPassword.length < 6) return { success: false, message: "New password must be at least 6 characters." };

  const sh = sheet_("PasswordResets");
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === code && String(data[i][1]).toLowerCase() === username.toLowerCase()) {
      if (new Date(data[i][3]).getTime() < Date.now()) { sh.deleteRow(i + 1); return { success: false, message: "Code expired. Please request a new one." }; }
      sh.deleteRow(i + 1);
      const found = findCredentialRow_(username);
      if (!found) return { success: false, message: "Account not found." };
      const cols = credentialColumns_();
      sheet_("Credentials").getRange(found.rowIndex, cols.indexOf("PasswordHash") + 1).setValue(hashPassword_(newPassword));
      resetLoginAttempts_(username);
      logAudit_(username, "-", "PASSWORD_RESET_COMPLETE", "");
      return { success: true };
    }
  }
  return { success: false, message: "Invalid or expired code." };
}

function changePassword_(body) {
  const auth = requireAuth_(body.token, null);
  if (!auth.ok) return { success: false, message: auth.error };
  const user = auth.user;

  const found = findCredentialRow_(user.username);
  if (!found) return { success: false, message: "Account not found." };
  const cred = rowToCredential_(found.values);
  if (hashPassword_(body.oldPassword || "") !== cred.PasswordHash) return { success: false, message: "Current password is incorrect." };
  if (!body.newPassword || body.newPassword.length < 6) return { success: false, message: "New password must be at least 6 characters." };

  const cols = credentialColumns_();
  sheet_("Credentials").getRange(found.rowIndex, cols.indexOf("PasswordHash") + 1).setValue(hashPassword_(body.newPassword));
  logAudit_(user.username, user.role, "PASSWORD_CHANGED", "");
  return { success: true };
}

// =============================================================================
// HISTORY  (+ FEATURE 9 vehicles, + FEATURE 1 reminders, + FEATURE 3 invoice email,
//            + review-request email)
// =============================================================================
function historyColumns_() {
  return ["Timestamp","Date","Username","Name","CustomerAddress","VehicleType","VehiclePlateNumber","WorkshopLocation","ServiceType","Price","Notes","ReviewToken"];
}
function formatDate_(value) {
  if (!value) return "";
  const d = (value instanceof Date) ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return Utilities.formatDate(d, tz_(), "yyyy-MM-dd");
}

function getHistory_(body) {
  const auth = requireAuth_(body.token, null);
  if (!auth.ok) return { success: false, message: auth.error };
  const user = auth.user;

  const sh = sheet_("History");
  const data = sh.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const record = {
      date: formatDate_(r[1]), username: r[2], name: r[3], address: r[4],
      vehicleType: r[5], plate: r[6], workshop: r[7], serviceType: r[8], price: r[9], notes: r[10]
    };
    if (user.role === "member" && record.username !== user.username) continue;
    if (user.role === "admin" && record.workshop !== user.workshop) continue;
    if ((user.role === "manager" || user.role === "webmaster") && body.workshop && body.workshop !== "All" && record.workshop !== body.workshop) continue;
    if (body.plate && body.plate !== "All" && record.plate !== body.plate) continue;
    rows.push(record);
  }
  rows.sort((a, b) => new Date(b.date) - new Date(a.date));

  const result = { success: true, history: rows };
  if (user.role === "member" && rows.length) {
    const lastDate = new Date(rows[0].date);
    const nextDue = new Date(lastDate.getTime() + REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    result.nextServiceDue = formatDate_(nextDue);
  }
  return result;
}

function addHistory_(body) {
  const auth = requireAuth_(body.token, ["admin", "manager", "webmaster"]);
  if (!auth.ok) return { success: false, message: auth.error };
  const user = auth.user;
  const rec = body.record || {};

  const workshop = user.role === "admin" ? user.workshop : rec.workshop;
  if (!rec.date || !rec.name || !rec.vehicleType || !rec.plate || !workshop || !rec.serviceType || rec.price === undefined) {
    return { success: false, message: "Missing required fields." };
  }

  const reviewToken = Utilities.getUuid();
  sheet_("History").appendRow([
    new Date(), rec.date, rec.username || "", rec.name, rec.address || "",
    rec.vehicleType, rec.plate, workshop, rec.serviceType, Number(rec.price) || 0, rec.notes || "", reviewToken
  ]);

  // Feature 9 — keep a distinct vehicle registry per member.
  if (rec.username) addVehicleIfNew_(rec.username, rec.plate, rec.vehicleType);

  // Feature 8 — create a pending review row so the link in the email works.
  sheet_("Reviews").appendRow([reviewToken, rec.username || "", workshop, "", "", "Pending", new Date(), ""]);

  logAudit_(user.username, user.role, "HISTORY_ADDED", rec.plate + " @ " + workshop);

  // Feature 3 — email a PDF invoice + review link to the customer, best effort.
  try {
    let customerEmail = rec.email || "";
    if (!customerEmail && rec.username) {
      const credRow = findCredentialRow_(rec.username);
      if (credRow) customerEmail = rowToCredential_(credRow.values).Email;
    }
    if (customerEmail) {
      const pdfBlob = generateReceiptPdf_(rec, workshop);
      const reviewLink = (body.siteUrl ? body.siteUrl : "") + "?review=" + reviewToken;
      MailApp.sendEmail({
        to: customerEmail,
        subject: "Workshop2U — Your service invoice",
        body: "Hi " + rec.name + ",\n\nThanks for servicing your vehicle (" + rec.plate + ") with us at " + workshop + ".\n" +
              "Service: " + rec.serviceType + "\nAmount: RM " + Number(rec.price).toFixed(2) + "\n\n" +
              "Your invoice is attached as a PDF.\n\n" +
              (body.siteUrl ? "We'd love your feedback — rate your visit here:\n" + reviewLink + "\n\n" : "") +
              "Thank you for choosing Workshop2U.",
        attachments: [pdfBlob]
      });
    }
  } catch (e) { /* best effort — don't fail the save if email/PDF generation fails */ }

  return { success: true };
}

function generateReceiptPdf_(rec, workshop) {
  const doc = DocumentApp.create("Workshop2U Invoice - " + rec.plate + " - " + rec.date);
  const body = doc.getBody();
  body.appendParagraph("WORKSHOP2U").setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph("Service Invoice").setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph("Workshop: " + workshop);
  body.appendParagraph("Date: " + rec.date);
  body.appendParagraph(" ");
  body.appendParagraph("Customer: " + rec.name);
  body.appendParagraph("Address: " + (rec.address || "-"));
  body.appendParagraph("Vehicle: " + rec.vehicleType + " (" + rec.plate + ")");
  body.appendParagraph(" ");
  body.appendParagraph("Service type: " + rec.serviceType);
  body.appendParagraph("Amount: RM " + Number(rec.price).toFixed(2)).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (rec.notes) { body.appendParagraph(" "); body.appendParagraph("Notes: " + rec.notes); }
  body.appendParagraph(" ");
  body.appendParagraph("Thank you for choosing Workshop2U — We pick up, fix & deliver.");
  doc.saveAndClose();

  const file = DriveApp.getFileById(doc.getId());
  const pdfBlob = file.getAs("application/pdf").setName("Invoice-" + rec.plate + "-" + rec.date + ".pdf");
  file.setTrashed(true); // keep Drive tidy — we only needed the PDF bytes
  return pdfBlob;
}

// Feature 1 helper — called by addHistory_
function addVehicleIfNew_(username, plate, vehicleType) {
  const sh = sheet_("Vehicles");
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === username.toLowerCase() && String(data[i][1]).toLowerCase() === plate.toLowerCase()) return;
  }
  sh.appendRow([username, plate, vehicleType, ""]);
}

function getVehicles_(body) {
  const auth = requireAuth_(body.token, null);
  if (!auth.ok) return { success: false, message: auth.error };
  const user = auth.user;
  const username = user.role === "member" ? user.username : (body.username || "");
  if (!username) return { success: false, message: "No username specified." };

  const sh = sheet_("Vehicles");
  const data = sh.getDataRange().getValues();
  const vehicles = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === username.toLowerCase()) {
      vehicles.push({ plate: data[i][1], vehicleType: data[i][2], nickname: data[i][3] });
    }
  }
  return { success: true, vehicles };
}

// =============================================================================
// FEATURE 1 (continued) — scheduled reminder job. Attach a daily time trigger
// to this function from Apps Script: Triggers > Add Trigger > sendServiceReminders.
// =============================================================================
function sendServiceReminders() {
  const history = sheet_("History").getDataRange().getValues();
  const latestByVehicle = {}; // key: username|plate -> {date, name, vehicleType, plate}
  for (let i = 1; i < history.length; i++) {
    const r = history[i];
    const username = r[2], name = r[3], vehicleType = r[5], plate = r[6];
    if (!username || !plate) continue;
    const key = username + "|" + plate;
    const d = new Date(r[1]);
    if (!latestByVehicle[key] || d > latestByVehicle[key].date) {
      latestByVehicle[key] = { date: d, name, vehicleType, plate, username };
    }
  }

  const reminderSheet = sheet_("Reminders");
  const reminderData = reminderSheet.getDataRange().getValues();
  const lastSent = {}; // key: plate|username -> Date
  for (let i = 1; i < reminderData.length; i++) {
    lastSent[reminderData[i][0] + "|" + reminderData[i][1]] = new Date(reminderData[i][2]);
  }

  const now = new Date();
  Object.keys(latestByVehicle).forEach(key => {
    const v = latestByVehicle[key];
    const nextDue = new Date(v.date.getTime() + REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    const daysUntilDue = (nextDue.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    if (daysUntilDue > REMINDER_LOOKAHEAD_DAYS || daysUntilDue < -30) return; // out of window

    const cooldownKey = v.plate + "|" + v.username;
    const prevSent = lastSent[cooldownKey];
    if (prevSent && (now.getTime() - prevSent.getTime()) < REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) return;

    const credRow = findCredentialRow_(v.username);
    if (!credRow) return;
    const cred = rowToCredential_(credRow.values);
    if (!cred.Email) return;

    try {
      MailApp.sendEmail({
        to: cred.Email,
        subject: "Workshop2U — Your vehicle's service is due soon",
        body: "Hi " + v.name + ",\n\nYour vehicle " + v.vehicleType + " (" + v.plate + ") is due for its next service around " +
              formatDate_(nextDue) + ".\n\nBook your pickup today: https://workshop2u.com.my\n\nThank you for choosing Workshop2U."
      });
      reminderSheet.appendRow([v.plate, v.username, now]);
      logAudit_(v.username, "member", "REMINDER_SENT", v.plate);
    } catch (e) { /* best effort */ }
  });
}

// =============================================================================
// MEMBERS
// =============================================================================
function getMembers_(body) {
  const auth = requireAuth_(body.token, ["admin", "manager", "webmaster"]);
  if (!auth.ok) return { success: false, message: auth.error };
  const user = auth.user;

  const data = sheet_("Credentials").getDataRange().getValues();
  const members = [];
  for (let i = 1; i < data.length; i++) {
    const cred = rowToCredential_(data[i]);
    if (cred.Role !== "member") continue;
    if (user.role === "admin" && cred.WorkshopLocation !== user.workshop) continue;
    if ((user.role === "manager" || user.role === "webmaster") && body.workshop && body.workshop !== "All" && cred.WorkshopLocation !== body.workshop) continue;
    members.push({ username: cred.Username, fullName: cred.FullName, address: cred.Address, phone: cred.Phone, email: cred.Email, workshop: cred.WorkshopLocation, status: cred.Status });
  }
  return { success: true, members };
}

function addMember_(body) {
  const auth = requireAuth_(body.token, ["admin", "manager", "webmaster"]);
  if (!auth.ok) return { success: false, message: auth.error };
  const user = auth.user;
  const m = body.member || {};

  if (!m.username || !m.password || !m.fullName) return { success: false, message: "Username, password and full name are required." };
  if (findCredentialRow_(m.username)) return { success: false, message: "That username already exists." };

  let role = m.role || "member";
  let workshop = m.workshop || user.workshop;
  if (user.role === "admin") { role = "member"; workshop = user.workshop; }

  sheet_("Credentials").appendRow([m.username, hashPassword_(m.password), role, workshop, m.fullName, m.address || "", m.phone || "", m.email || "", "Active", new Date()]);
  logAudit_(user.username, user.role, "ACCOUNT_CREATED", m.username + " (" + role + ")");
  return { success: true };
}

// =============================================================================
// WEBMASTER — account management  (+ FEATURE 11 audit log)
// =============================================================================
function getAccounts_(body) {
  const auth = requireAuth_(body.token, ["webmaster"]);
  if (!auth.ok) return { success: false, message: auth.error };
  const data = sheet_("Credentials").getDataRange().getValues();
  const accounts = [];
  for (let i = 1; i < data.length; i++) {
    const cred = rowToCredential_(data[i]);
    accounts.push({ username: cred.Username, role: cred.Role, workshop: cred.WorkshopLocation, fullName: cred.FullName, status: cred.Status });
  }
  return { success: true, accounts };
}

function updateAccount_(body) {
  const auth = requireAuth_(body.token, ["webmaster"]);
  if (!auth.ok) return { success: false, message: auth.error };
  const found = findCredentialRow_(body.username);
  if (!found) return { success: false, message: "Account not found." };
  const sh = sheet_("Credentials");
  const cols = credentialColumns_();
  const updates = body.updates || {};

  if (updates.status) sh.getRange(found.rowIndex, cols.indexOf("Status") + 1).setValue(updates.status);
  if (updates.password) sh.getRange(found.rowIndex, cols.indexOf("PasswordHash") + 1).setValue(hashPassword_(updates.password));
  if (updates.role) sh.getRange(found.rowIndex, cols.indexOf("Role") + 1).setValue(updates.role);
  if (updates.workshop) sh.getRange(found.rowIndex, cols.indexOf("WorkshopLocation") + 1).setValue(updates.workshop);

  logAudit_(auth.user.username, "webmaster", "ACCOUNT_UPDATED", body.username + " -> " + JSON.stringify(updates));
  return { success: true };
}

function getAuditLog_(body) {
  const auth = requireAuth_(body.token, ["webmaster"]);
  if (!auth.ok) return { success: false, message: auth.error };
  const data = sheet_("AuditLog").getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    rows.push({ timestamp: Utilities.formatDate(new Date(data[i][0]), tz_(), "yyyy-MM-dd HH:mm"), username: data[i][1], role: data[i][2], action: data[i][3], details: data[i][4] });
  }
  rows.reverse();
  return { success: true, log: rows.slice(0, 300) };
}

// =============================================================================
// BOOKINGS  (+ FEATURE 2 approval workflow, + FEATURE 13 spam guard)
// =============================================================================
function bookAppointment_(body) {
  const b = body.booking || {};

  // Feature 13 — honeypot field. Real users never fill this hidden input;
  // bots that auto-fill every field will, so we silently "succeed" without saving.
  if (b.website) return { success: true };

  if (!b.name || !b.phone || !b.email || !b.workshop || !b.date || !b.time) {
    return { success: false, message: "Please complete all required fields." };
  }

  const bookingId = Utilities.getUuid();
  sheet_("Bookings").appendRow([bookingId, new Date(), b.name, b.phone, b.email, b.vehicleType || "", b.plate || "", b.date, b.time, b.workshop, b.serviceType || "", b.notes || "", "New"]);
  logAudit_("(guest)", "-", "BOOKING_CREATED", b.name + " / " + b.plate + " @ " + b.workshop);

  try {
    MailApp.sendEmail({
      to: b.email,
      subject: "Workshop2U — Appointment Request Received",
      body: "Hi " + b.name + ",\n\nThanks for booking with Workshop2U (" + b.workshop + ").\n" +
            "Requested date/time: " + b.date + " " + b.time + "\nService: " + (b.serviceType || "-") + "\n\n" +
            "We will contact you shortly to confirm.\n\nWorkshop2U"
    });
  } catch (e) { /* ignore */ }
  try {
    const notifyTo = WORKSHOP_NOTIFY_EMAILS[b.workshop];
    if (notifyTo) MailApp.sendEmail({ to: notifyTo, subject: "New Booking Request — " + b.workshop, body: "New appointment request:\n\n" + JSON.stringify(b, null, 2) });
  } catch (e) { /* ignore */ }

  return { success: true };
}

function bookingColumns_() {
  return ["BookingID","Timestamp","Name","Phone","Email","VehicleType","VehiclePlateNumber","PreferredDate","PreferredTime","WorkshopLocation","ServiceType","Notes","Status"];
}

function getBookings_(body) {
  const auth = requireAuth_(body.token, ["admin", "manager", "webmaster"]);
  if (!auth.ok) return { success: false, message: auth.error };
  const user = auth.user;

  const data = sheet_("Bookings").getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const booking = { id: r[0], name: r[2], phone: r[3], email: r[4], vehicleType: r[5], plate: r[6], date: formatDate_(r[7]) || r[7], time: r[8], workshop: r[9], serviceType: r[10], notes: r[11], status: r[12] };
    if (user.role === "admin" && booking.workshop !== user.workshop) continue;
    if ((user.role === "manager" || user.role === "webmaster") && body.workshop && body.workshop !== "All" && booking.workshop !== body.workshop) continue;
    rows.push(booking);
  }
  rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { success: true, bookings: rows };
}

function updateBookingStatus_(body) {
  const auth = requireAuth_(body.token, ["admin", "manager", "webmaster"]);
  if (!auth.ok) return { success: false, message: auth.error };
  const user = auth.user;

  const sh = sheet_("Bookings");
  const data = sh.getDataRange().getValues();
  const cols = bookingColumns_();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.bookingId) {
      const workshop = data[i][cols.indexOf("WorkshopLocation")];
      if (user.role === "admin" && workshop !== user.workshop) return { success: false, message: "Not your workshop." };

      if (body.status) sh.getRange(i + 1, cols.indexOf("Status") + 1).setValue(body.status);
      if (body.newDate) sh.getRange(i + 1, cols.indexOf("PreferredDate") + 1).setValue(body.newDate);
      if (body.newTime) sh.getRange(i + 1, cols.indexOf("PreferredTime") + 1).setValue(body.newTime);

      const email = data[i][cols.indexOf("Email")];
      const name = data[i][cols.indexOf("Name")];
      try {
        if (email) {
          MailApp.sendEmail({
            to: email,
            subject: "Workshop2U — Booking update",
            body: "Hi " + name + ",\n\nYour booking status is now: " + (body.status || data[i][cols.indexOf("Status")]) +
                  (body.newDate ? "\nNew date: " + body.newDate : "") + (body.newTime ? "\nNew time: " + body.newTime : "") +
                  "\n\nWorkshop2U"
          });
        }
      } catch (e) { /* ignore */ }

      logAudit_(user.username, user.role, "BOOKING_UPDATED", body.bookingId + " -> " + body.status);
      return { success: true };
    }
  }
  return { success: false, message: "Booking not found." };
}

// =============================================================================
// FEATURE 7 — ANALYTICS DASHBOARD
// =============================================================================
function getAnalytics_(body) {
  const auth = requireAuth_(body.token, ["admin", "manager", "webmaster"]);
  if (!auth.ok) return { success: false, message: auth.error };
  const user = auth.user;

  const data = sheet_("History").getDataRange().getValues();
  const workshops = ["Melaka", "Negeri Sembilan", "Johor"];
  const scopedWorkshops = user.role === "admin" ? [user.workshop] : workshops;

  const monthsSet = {};
  const revenue = {}; scopedWorkshops.forEach(w => revenue[w] = {});
  const jobs = {}; scopedWorkshops.forEach(w => jobs[w] = {});

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const workshop = r[7];
    if (scopedWorkshops.indexOf(workshop) === -1) continue;
    const d = new Date(r[1]);
    if (isNaN(d.getTime())) continue;
    const monthKey = Utilities.formatDate(d, tz_(), "yyyy-MM");
    monthsSet[monthKey] = true;
    revenue[workshop][monthKey] = (revenue[workshop][monthKey] || 0) + Number(r[9] || 0);
    jobs[workshop][monthKey] = (jobs[workshop][monthKey] || 0) + 1;
  }

  const months = Object.keys(monthsSet).sort().slice(-12); // last 12 months with data
  const series = {}, jobSeries = {};
  scopedWorkshops.forEach(w => {
    series[w] = months.map(m => revenue[w][m] || 0);
    jobSeries[w] = months.map(m => jobs[w][m] || 0);
  });

  const totalRevenue = Object.values(series).flat().reduce((a, b) => a + b, 0);
  const totalJobs = Object.values(jobSeries).flat().reduce((a, b) => a + b, 0);

  return { success: true, months, revenueSeries: series, jobSeries, totalRevenue, totalJobs, workshops: scopedWorkshops };
}

// =============================================================================
// FEATURE 8 — REVIEWS
// =============================================================================
function getReviewContext_(body) {
  const token = body.reviewToken;
  const sh = sheet_("Reviews");
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      if (data[i][5] === "Submitted") return { success: false, message: "You've already submitted feedback for this visit. Thank you!" };
      return { success: true, workshop: data[i][2] };
    }
  }
  return { success: false, message: "This review link is invalid or has expired." };
}

function submitReview_(body) {
  const token = body.reviewToken;
  const rating = Number(body.rating);
  if (!rating || rating < 1 || rating > 5) return { success: false, message: "Please select a rating." };

  const sh = sheet_("Reviews");
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      if (data[i][5] === "Submitted") return { success: false, message: "You've already submitted feedback for this visit." };
      sh.getRange(i + 1, 4, 1, 5).setValues([[rating, body.comment || "", "Submitted", data[i][6], new Date()]]);
      logAudit_(data[i][1], "member", "REVIEW_SUBMITTED", "Rating " + rating);
      return { success: true };
    }
  }
  return { success: false, message: "This review link is invalid or has expired." };
}

// =============================================================================
// ONE-TIME SETUP
// =============================================================================
function initializeSheet() {
  const ss = ss_();
  const sheets = {
    "Credentials": credentialColumns_(),
    "History": historyColumns_(),
    "Bookings": bookingColumns_(),
    "Sessions": ["Token","Username","Role","WorkshopLocation","FullName","CreatedAt","ExpiresAt"],
    "Vehicles": ["Username","PlateNumber","VehicleType","Nickname"],
    "LoginAttempts": ["Username","FailCount","LockUntil"],
    "OtpCodes": ["Username","Code","CreatedAt","ExpiresAt"],
    "PasswordResets": ["Token","Username","CreatedAt","ExpiresAt"],
    "Reviews": ["ReviewToken","Username","Workshop","Rating","Comment","Status","CreatedAt","SubmittedAt"],
    "AuditLog": ["Timestamp","Username","Role","Action","Details"],
    "Reminders": ["PlateNumber","Username","LastReminderSent"]
  };
  Object.keys(sheets).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(sheets[name]); sh.setFrozenRows(1); }
  });

  const credSheet = ss.getSheetByName("Credentials");
  if (credSheet.getLastRow() === 1) {
    credSheet.appendRow(["webmaster", hashPassword_("ChangeMe123!"), "webmaster", "All", "Site Webmaster", "", "", "", "Active", new Date()]);
    Logger.log("Created default webmaster login -> username: webmaster / password: ChangeMe123! (change this immediately, and add a real email so OTP works)");
  }
}

/** Run daily (Triggers > Add Trigger) to purge expired sessions/codes. */
function cleanExpiredSessions() {
  purgeExpired_("Sessions", 6);
  purgeExpired_("OtpCodes", 3);
  purgeExpired_("PasswordResets", 3);
}
function purgeExpired_(sheetName, expiryColIndex) {
  const sh = sheet_(sheetName);
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (new Date(data[i][expiryColIndex]).getTime() < Date.now()) sh.deleteRow(i + 1);
  }
}
