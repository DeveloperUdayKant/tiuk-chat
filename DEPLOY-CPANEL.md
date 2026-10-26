# Installing TIUK Chat on cPanel at thisisudaykant.com/chat

This package is pre-configured for **https://thisisudaykant.com/chat**:
- The web app in `dist/` is built for the `/chat` path.
- `.env` already contains your database settings (`tiuk-chat` / `tiuk-user-chat`) and a generated secret key.

Your main website on `thisisudaykant.com` keeps working as it is. Only `/chat` is handed to the Node.js app.

> The zip contains your database password. Don't share it or upload it anywhere public.

---

## 0. Before you start

- In cPanel's **Software** section, look for **Setup Node.js App**. If it's missing, ask your host to enable
  Node.js (CloudLinux Node.js Selector). Without it the app can't run on this hosting.
- `https://thisisudaykant.com` must have SSL working (padlock in the browser). Browsers only allow the
  encryption TIUK Chat uses on `https://` pages. If needed: cPanel → **SSL/TLS Status** → **Run AutoSSL**.
- In File Manager, make sure there is **no existing folder `public_html/chat`** with other content in it.

---

## 1. Check the database

You've already created the database and user. Confirm they're linked:

cPanel → **MySQL® Databases** → **Current Databases** table: `tiuk-chat` should list the user `tiuk-user-chat`.
If it doesn't: **Add User To Database** → user `tiuk-user-chat`, database `tiuk-chat` → **ALL PRIVILEGES** → **Make Changes**.

> **Check the exact names.** Many cPanel servers add your account name as a prefix, e.g. `abc_tiuk-chat`.
> If the table shows a prefix, use the full names in `.env` (step 3).

You don't need to import any SQL. The tables are created automatically on first start.

---

## 2. Upload the files

1. cPanel → **File Manager** → go to your **home folder** (`/home/USER`), **not** `public_html`.
2. **+ Folder** → name it `tiuk-chat`.
3. Open `tiuk-chat` → **Upload** → select `tiuk-chat-cpanel.zip`.
4. Back in File Manager, right-click the zip → **Extract** → into `/home/USER/tiuk-chat`. Then delete the zip.
5. Top-right **Settings** → tick **Show Hidden Files (dotfiles)** so you can see `.env`.

You should now have:

```
/home/USER/tiuk-chat/
  app.cjs     ← startup file
  .env        ← settings (already filled in)
  package.json
  dist/       ← web app, built for /chat
  server/     ← API
  storage/    ← encrypted uploads will be stored here
```

---

## 3. Check `.env`

Right-click `.env` → **Edit**. It already contains:

```ini
NODE_ENV=production
APP_ORIGIN=https://thisisudaykant.com
BASE_PATH=/chat
APP_SECRET=…generated…

DB_HOST=localhost
DB_PORT=3306
DB_USER=tiuk-user-chat
DB_PASSWORD='your-database-password'
DB_NAME=tiuk-chat
```

- If your names have a prefix (step 1), update `DB_USER` and `DB_NAME`.
- Keep the password inside **single quotes**. Passwords with characters like `;` `%` `#` are then read exactly.
- Don't add `PORT`. cPanel assigns it.
- Don't change `APP_SECRET` once people are using the app. Changing it signs everyone out.

---

## 4. Create the Node.js application

cPanel → **Setup Node.js App** → **+ Create Application**:

| Field | Value |
|---|---|
| Node.js version | **18 or newer** (20 or 22 recommended) |
| Application mode | **Production** |
| Application root | `tiuk-chat` |
| Application URL | domain **`thisisudaykant.com`**, path **`chat`** |
| Application startup file | `app.cjs` |

Under **Environment variables**, add `NODE_ENV` = `production`, then click **Create**.

cPanel then creates `public_html/chat/.htaccess`, which routes `/chat` to the app. Leave that file as it is.

---

## 5. Install and start

1. On the app page, under *Detected configuration files*, click **Run NPM Install**.
   Wait until it reports that it finished (1–3 minutes).
2. Click **Restart** at the top.
3. Open **https://thisisudaykant.com/chat/api/config**. You should see JSON like
   `{"maxFileBytes":52428800,"maxFilesPerMessage":10,...}`.
4. Open **https://thisisudaykant.com/chat** → **Create account**. 🎉

---

## 6. Test real-time chat

Open the site in two different browsers (or one normal and one private window) and create two accounts.
Start a chat between them and send a few messages each way.

Messages should appear **instantly** on both sides. If some only appear after a page refresh, your host is
running several copies of the app, and this version needs exactly one. Fix it with one of these:
- Add this line inside the Passenger block of `public_html/chat/.htaccess` (some hosts don't allow it):
  ```
  PassengerMaxInstancesPerApp 1
  ```
- Or ask your host's support: *"Please limit my Node.js app at thisisudaykant.com/chat to 1 instance."*

---

## If your main site is WordPress / Laravel / has its own `.htaccess`

The main site's rewrite rules in `public_html/.htaccess` can sometimes capture `/chat` before the app sees it.
The usual symptom is your main site's 404 page appearing at `/chat`. If that happens, add this line near the
top of `public_html/.htaccess`, just after `RewriteEngine On`:

```
RewriteRule ^chat(/.*)?$ - [L]
```

---

## Updating to a new version

On your computer (PowerShell, in the project folder):

```powershell
$env:BASE_PATH = "/chat"; npm run build; Remove-Item Env:BASE_PATH
```

Then upload the new `dist/` and `server/` folders (or a new zip) over `/home/USER/tiuk-chat`.
**Keep your `.env` and `storage/` folder.** Run NPM Install if `package.json` changed, then click **Restart**.

## Backups

Back up these two things regularly:
- The database `tiuk-chat`: cPanel → **Backup**, or **phpMyAdmin → Export**
- The folder `/home/USER/tiuk-chat/storage/uploads` (encrypted file attachments)

---

## Troubleshooting

Errors are logged in `/home/USER/tiuk-chat/stderr.log`, or at the log path shown on the Node.js App page.
After editing `.env`, always click **Restart**.

| Symptom | Fix |
|---|---|
| 503 / "Something went wrong" | Read `stderr.log` and match the error below. |
| `Access denied for user` | Wrong `DB_USER`/`DB_PASSWORD`, or the user isn't added to the database with ALL PRIVILEGES. Check for a cPanel prefix. |
| `Unknown database` | `DB_NAME` must match exactly what **MySQL® Databases** shows, including any prefix. |
| `APP_SECRET must be set…` | `.env` is missing from `/home/USER/tiuk-chat`. Turn on hidden files and check. |
| `Cannot use import statement` / `require() of ES Module` | The startup file must be **`app.cjs`**. |
| `SyntaxError` mentioning `?.` or `??` | The Node.js version is too old. Pick 18+, then Run NPM Install again. |
| Page loads but is blank or unstyled | The Application URL path must be exactly `chat`, and `BASE_PATH=/chat` must be in `.env`. |
| Main site's 404 page at `/chat` | See *If your main site is WordPress / Laravel* above. |
| "crypto.subtle is undefined" when signing up | You're on `http://`. Use `https://thisisudaykant.com/chat`. |
| Large files fail to upload | The host limits upload size. Set `MAX_FILE_MB=20` (for example) in `.env` and Restart. |
| Slow first load after a quiet period | Normal on shared hosting: the app sleeps when idle. |
