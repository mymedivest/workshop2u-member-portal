# Workshop2U Website — Setup Guide

A static website (for GitHub Pages) backed by a Google Sheet + Google Apps
Script "API". No paid hosting or database required. This version includes
all 14 of the previously-suggested features, wired directly into the code.

**Files**
- `index.html` — the full site (public pages + Members login/dashboard + review modal)
- `style.css` — styling
- `script.js` — front-end logic, calls the Apps Script backend
- `Code.gs` — Google Apps Script backend (paste into the Apps Script editor)

---

## 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet, e.g. **"Workshop2U Database"**.
2. Open **Extensions → Apps Script**, delete the placeholder code, and paste in the entire contents of `Code.gs`.
3. Select the function `initializeSheet` from the dropdown and click **Run**.
   - Creates all 11 tabs: `Credentials`, `History`, `Bookings`, `Sessions`, `Vehicles`, `LoginAttempts`, `OtpCodes`, `PasswordResets`, `Reviews`, `AuditLog`, `Reminders`.
   - Creates one starter login: **username `webmaster`, password `ChangeMe123!`**. Change this immediately, and give it a real email address (Column H in `Credentials`) so its login codes (2FA) can be delivered.
4. Grant permissions when prompted.

## 2. Set up the daily automation (Feature 1 reminders + cleanup)

In the Apps Script editor: **Triggers → Add Trigger**
- Function `sendServiceReminders`, Event source: Time-driven, Day timer, once a day (e.g. 8–9am). Emails customers whose vehicle is due for service soon.
- Function `cleanExpiredSessions`, Time-driven, once a day. Clears out expired login sessions, OTP codes and reset codes.

## 3. Deploy the Apps Script as a Web App

1. **Deploy → New deployment → Web app**.
2. Execute as: **Me**. Who has access: **Anyone**.
3. Click **Deploy**, authorize, copy the Web app URL (ends in `/exec`).
4. Paste it into `CONFIG.API_URL` near the top of `script.js`.
5. Every time you edit `Code.gs`, create a **new deployment version** (Deploy → Manage deployments → Edit → New version) so changes go live.

## 4. Publish the site on GitHub Pages

1. Create a GitHub repo, upload `index.html`, `style.css`, `script.js` to the root.
2. **Settings → Pages** → source branch `main`, folder `/root` → Save.
3. Live at `https://<your-username>.github.io/<repo-name>/`.

## 5. First-time staff setup

Log in as `webmaster` → **Manage Staff Accounts** tab → create:
- 1 **manager** (Workshop: `All`)
- 3 **admins**, one per location (Workshop: `Melaka` / `Negeri Sembilan` / `Johor`)

Give every staff account a real email — it's required for the OTP second factor on login. Admins/manager then create **member** accounts and log service history from their dashboards.

---

## How each of the 14 features works

| # | Feature | Where it lives |
|---|---|---|
| 1 | **Service reminders** | `sendServiceReminders()` in `Code.gs`, run on a daily trigger. Computes each vehicle's next-due date (last service + 180 days) and emails the customer once, with a 30-day cooldown tracked in the `Reminders` tab. The member dashboard also shows "Next service due" (`getHistory_` returns `nextServiceDue`). |
| 2 | **Booking approval workflow** | New **Bookings** tab in the staff dashboard. Admin/manager/webmaster can Confirm / Reject / Reschedule each request (`getBookings` / `updateBookingStatus` actions); the customer gets an email either way. |
| 3 | **Digital invoices/receipts** | `generateReceiptPdf_()` builds a PDF via Google Docs → Drive export and emails it automatically whenever `addHistory_` runs, if the customer has an email on file. |
| 4 | **Two-factor / OTP login** | Staff logins (admin/manager/webmaster) trigger a 6-digit emailed code (`OtpCodes` tab) that must be entered on the new OTP screen before a session is created. Members log in directly, no OTP. |
| 5 | **Rate limiting & lockout** | `LoginAttempts` tab. 5 failed attempts locks the account for 15 minutes; resets on success. |
| 6 | **Self-service password reset** | "Forgot your password?" on the login screen emails a 6-digit reset code (`PasswordResets` tab, 30-minute expiry) instead of requiring an admin. |
| 7 | **Analytics dashboard** | **Analytics** tab in the staff dashboard, rendered with Chart.js — monthly revenue by workshop, scoped the same way as history (admin = own workshop, manager/webmaster = all). |
| 8 | **Review/rating capture** | Every saved service record gets a `ReviewToken`; the invoice email includes a feedback link (`?review=TOKEN`). Visiting that link opens a star-rating modal on the site, stored in the `Reviews` tab. |
| 9 | **Multi-vehicle members** | `Vehicles` tab, auto-populated the first time a plate is used for a member. The member dashboard has a "My Vehicles" tab and a vehicle filter on their history. |
| 10 | **WhatsApp button + Maps** | Floating WhatsApp button (bottom-right, set your number in `CONFIG.WHATSAPP_NUMBER`). Each location card has an embedded Google Map (no API key needed). |
| 11 | **Audit log** | `AuditLog` tab records logins, failed logins, OTPs, password resets, account changes, history additions, booking updates and reviews. Visible to the webmaster under **Audit Log**. |
| 12 | **Export to Excel/PDF** | "Export CSV" buttons (opens directly in Excel) and "Print / Save PDF" buttons (uses the browser's print dialog with a clean print stylesheet) on both the member and staff history tables. |
| 13 | **CAPTCHA on booking form** | A simple arithmetic challenge (client-side) plus a hidden honeypot field (`website`) checked server-side in `bookAppointment_` — bots that auto-fill every field get silently ignored. |
| 14 | **SEO & performance** | Open Graph / Twitter meta tags, canonical URL, `robots` meta, `theme-color`, `loading="lazy"` on images. See the note below about replacing hot-linked images. |

---

## Notes & limitations

- This suits a small business well; Google Sheets comfortably handles years of history. If traffic grows a lot, consider migrating the backend to a proper database.
- Keep the Apps Script deployment's "Execute as: Me" account secure — it owns the sheet and sends all emails.
- Replace `WORKSHOP_NOTIFY_EMAILS` in `Code.gs` with your real workshop emails, and `CONFIG.WHATSAPP_NUMBER` in `script.js` with your real WhatsApp number.
- Replace the hot-linked images from `workshop2u.com.my` in `index.html` with your own hosted photos before launch, for performance and licensing reasons.
- The booking-form CAPTCHA is a lightweight, dependency-free deterrent. For stronger bot protection, swap in Google reCAPTCHA v3: add the site key script to `index.html`, get a token client-side, send it to `bookAppointment_`, and verify it server-side with `UrlFetchApp.fetch("https://www.google.com/recaptcha/api/siteverify", ...)` before saving.
- PDF invoice generation uses your Apps Script account's Google Drive briefly (the doc is created, exported to PDF, then trashed) — this is normal and doesn't use noticeable storage.
