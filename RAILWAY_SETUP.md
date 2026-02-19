# Railway setup for EaMax backend

Set these in your Railway project so the backend and Admin app work.

## 1. Open variables

1. Go to [railway.app](https://railway.app) → your project → **EaMax backend** service.
2. Open the **Variables** tab.

---

## 2. ADMIN_API_KEY (required for Admin app)

The EaAdmin app sends this key in the `X-Admin-Key` header. It **must** match exactly.

- **Name:** `ADMIN_API_KEY`
- **Value:** `super-secret-admin-key`

(That is the default in `EaAdmin/src/config/api.js`. If you changed it there, use the same value here.)

If this is missing or wrong you get **401 Unauthorized** or **500** when sending notifications or using Admin.

---

## 3. FIREBASE_SERVICE_ACCOUNT_KEY (required for push notifications)

Needed so the backend can send push notifications when you create a notification in Admin.

- **Name:** `FIREBASE_SERVICE_ACCOUNT_KEY`
- **Value:** The **entire** JSON of your Firebase service account key (the downloaded file that starts with `"type": "service_account"`). You can paste it with or without line breaks; the backend accepts both.

### How to get the value

1. [Firebase Console](https://console.firebase.google.com) → your project → **Project settings** (gear) → **Service accounts**.
2. Click **Generate new private key** and download the JSON file.
3. In Railway, open the Variables tab and paste the **whole file content** into the value for `FIREBASE_SERVICE_ACCOUNT_KEY`.

If this is missing or invalid JSON, notifications are **saved** in the database but **push is not sent**; you may still see "Failed to save notification" if the problem is actually **ADMIN_API_KEY** or the database.

---

## 4. Other variables (you should already have)

- **DATABASE_URL** – PostgreSQL connection string (Railway often adds this).
- **PORT** – Optional; Railway sets it automatically.

---

## 5. After changing variables

Railway redeploys when you change variables. Wait for the new deployment to finish, then try sending a notification again from the Admin app.

---

## 6. If you see "fcm_token does not exist" or "user_unlocked_channels does not exist"

Your database was created before those columns/table were added. Run the migration once from your terminal.

### Option A – Railway CLI (easiest)

From the project root, with [Railway CLI](https://docs.railway.app/develop/cli) installed and logged in:

```bash
cd /home/ayoub/MySecretes/EaMax
npx railway run node backend/scripts/run-migration.js
```

(If your backend is in a different service, run `railway link` first and select the backend service.)

### Option B – Paste DATABASE_URL and run

1. Get the **public** database URL. The one in Variables often uses `postgres.railway.internal`, which only works inside Railway. In Railway → **PostgreSQL** service → **Connect** tab, copy the **Public** connection URL (host like `xxx.railway.app` or `roundhouse.proxy.rlwy.net`). Use that full URL including the password.
2. From the project root:

```bash
cd /home/ayoub/MySecretes/EaMax
DATABASE_URL='postgresql://postgres:xxxxx@xxxx.railway.app:5432/railway' node backend/scripts/run-migration.js
```

Replace the string with your actual `DATABASE_URL` (keep the single quotes).

After that, push notifications and admin “special access” (unlock channels) will work.

---

## Quick checklist

| Variable                      | Example / format                    | Used for              |
|------------------------------|-------------------------------------|------------------------|
| `ADMIN_API_KEY`              | `super-secret-admin-key`            | Admin app auth         |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | One-line JSON (see above)          | Push notifications     |
| `DATABASE_URL`               | `postgresql://...`                  | Database               |
