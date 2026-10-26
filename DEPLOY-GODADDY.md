# Deploying TIUK Chat on GoDaddy Node.js Hosting

GoDaddy Node.js Hosting (dashboard: **Apps**) builds and runs the app straight from this GitHub repository.
It runs `npm install` (production dependencies) → `npm run build` → `npm start` on Node.js 22.
You don't upload a zip or edit any files: settings are entered as encrypted **environment variables / secrets**.

> On this product an app is attached to a whole **hostname** (a domain or subdomain), not a sub-path.
> So the address will be **https://chat.thisisudaykant.com**, not `thisisudaykant.com/chat`.
> Your main site stays where it is.

---

## 1. Import from GitHub ✅ (done)

You've already imported `DeveloperUdayKant/tiuk-chat`, branch `main`, into an app (yours is named `github-import`).
Each time new code is pushed to GitHub, redeploy or sync the app from its dashboard to pick it up.

## 2. Add the environment variables (secrets)

In the app's dashboard, open **Environment variables / Secrets** and add the following.
Preview and Publish have **separate** values, so set them for both.

| Name | Value |
|---|---|
| `APP_SECRET` | A long random string (see below). **Required**: the app won't start without it. |
| `NODE_ENV` | `production` |

Generate `APP_SECRET` in Windows PowerShell:

```powershell
$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

Copy the output, paste it as the value, and keep it the same from then on. Changing it signs everyone out.

## 3. Database (GoDaddy managed MySQL)

Each app comes with a managed MySQL database. Open the app's **Database** section.

- **If GoDaddy already provides the connection as environment variables:** you don't need to do anything.
  TIUK Chat recognises `DATABASE_URL`, `MYSQL_URL`, `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`, and
  `MYSQL_HOST`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE` (plus `*_PORT`).
- **If it only shows you host / user / password / database name:** add them yourself as secrets:

  | Name | Value |
  |---|---|
  | `DB_HOST` | host shown by GoDaddy |
  | `DB_PORT` | `3306` (unless shown otherwise) |
  | `DB_USER` | user shown by GoDaddy |
  | `DB_PASSWORD` | password shown by GoDaddy (paste as is, no quotes) |
  | `DB_NAME` | database name shown by GoDaddy |

The tables are created automatically on first start. Preview and production **share the same database**.

## 4. Storage for file attachments

Encrypted attachments are stored on disk and must survive redeploys. Open the **Private Storage** tab and
click the **ⓘ** icon to find its folder path, then add the secret:

| Name | Value |
|---|---|
| `UPLOAD_DIR` | the Private Storage path (absolute, e.g. `/…/private`) |

Without it, files are saved inside the app folder and **are lost on every redeploy**.

## 5. Deploy and test the preview

1. Redeploy or restart the preview so it picks up the new secrets.
2. Open the **preview URL**. It's private: it only opens while you're signed in to GoDaddy.
3. Create two accounts (one in a private window) and chat between them. Send a photo too.
4. If it doesn't load, open the app's **Logs**. The most common message is
   `APP_SECRET must be set…` (step 2) or a database `Access denied` (step 3).

## 6. Publish on chat.thisisudaykant.com

1. Publishing needs a GoDaddy **Web Hosting** plan with a free app slot (Economy = 1 app, Deluxe = 10, Ultimate = 25).
2. Click **Publish**, which promotes the tested preview build to production.
3. Under **Domains**, attach `chat.thisisudaykant.com`. DNS is set up automatically because the domain is at
   GoDaddy, and HTTPS is issued automatically.
4. Make sure the **Publish** environment has the same secrets as Preview (steps 2–4), then restart it.

## Updating later

Push changes to the `main` branch on GitHub → redeploy the preview from the dashboard → test → **Publish**.

## Notes

- Limits are applied per visitor IP using Cloudflare's `CF-Connecting-IP` header, since GoDaddy serves apps through Cloudflare.
- Real-time works over WebSockets, and falls back to long-polling automatically if needed.
- The cPanel instructions (`DEPLOY-CPANEL.md`, `app.cjs`) are for classic cPanel hosting and aren't used here.
