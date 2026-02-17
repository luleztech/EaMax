## EaMax Backend (Node.js / Express / PostgreSQL)

This folder contains the backend API for the **EaMax** streaming apps (`EaMax` and `EaAdmin`).

It is designed to run on Railway with a PostgreSQL database and expose REST APIs for:

- Mobile app (users, channels, ads, profile)
- Admin app (dashboard stats, users, channels, notifications)

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure environment

Create a `.env` file in `backend/`:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
ADMIN_API_KEY=super-secret-admin-key
PORT=4000
```

On Railway, set these as environment variables in the project settings.

### 3. Create database schema

Run the SQL script in `sql/schema.sql` against your PostgreSQL database (Railway or local).

Example using `psql`:

```bash
psql "$DATABASE_URL" -f sql/schema.sql
```

### 4. Run the backend locally

```bash
cd backend
npm run dev
```

The server will start on `http://localhost:4000` by default.

Test health check:

```bash
curl http://localhost:4000/health
```

### 5. API overview

#### Public (mobile apps)

- `POST /api/users/register`
  - Body: `{ "externalId": "User-A2F34" }`
  - Ensures a user exists and returns the user row.

- `GET /api/users/:externalId`
  - Returns user summary (points, premium status, etc.).

- `POST /api/users/:externalId/ads/watched`
  - Body: `{ "points": 10 }` (optional, defaults to 10)
  - Records an ad watch event and increments user points.

- `GET /api/channels?category=football|movies|habari`
  - Returns active channels for the given category (or all if omitted).

- `GET /api/notifications`
  - Returns recent sent notifications (for potential in-app inbox).

- `POST /api/notifications/:id/click`
  - Increments click count for a notification.

#### Admin (EaAdmin)

All admin routes require:

```http
X-Admin-Key: <ADMIN_API_KEY>
```

- `GET /api/admin/dashboard`
  - Returns:
    - `totalUsers`
    - `premiumUsers`
    - `newUsersThisMonth`
    - `uninstallUsersThisMonth`
    - `adsWatchedToday`
    - `totalPointsCollected`

- `GET /api/admin/users`
  - Returns latest users with basic info and status.

- `PATCH /api/admin/users/:id/block`
  - Body: `{ "blocked": true }`

- `GET /api/admin/channels`
  - Returns all channels.

- `POST /api/admin/channels`
  - Body:
    ```json
    {
      "name": "ESPN",
      "category": "football",
      "streamUrl": "https://example.com/stream.m3u8",
      "thumbnailUrl": "https://example.com/logo.png",
      "thumbnailEmoji": "⚽",
      "color": "#10b981",
      "isActive": true,
      "drmProtected": false,
      "ownerUserId": 1
    }
    ```

- `PUT /api/admin/channels/:id`
  - Same fields as `POST`, all optional.

- `DELETE /api/admin/channels/:id`

- `POST /api/admin/notifications`
  - Body:
    ```json
    {
      "title": "Kabumbu - Live Match Alert",
      "message": "Man Utd vs Liverpool starting now",
      "category": "kabumbu",
      "type": "normal" // or "scheduled"
    }
    ```

### 6. Connecting the React Native apps

In both `EaMax` and `EaAdmin`, configure a base URL for the backend:

```js
const API_BASE_URL = 'https://your-railway-app-url.up.railway.app';
```

Then call the endpoints above from your screens:

- Use `/api/channels` instead of hard-coded channels.
- Use `/api/users/register` and `/api/users/:externalId/ads/watched` to persist points.
- Use `/api/admin/dashboard`, `/api/admin/users`, `/api/admin/channels`, and `/api/admin/notifications` from `EaAdmin`.

### 7. Git & GitHub

From the project root (`/home/ayoub/MySecretes/EaMax`), you can add and commit the backend:

```bash
git add backend
git commit -m "Add Node.js backend for EaMax"
```

Then connect to your GitHub repository (`https://github.com/luleztech/EaMax`) if not already:

```bash
git remote add origin git@github.com:luleztech/EaMax.git   # or HTTPS URL
git push -u origin main
```

> Note: In this environment I can’t push to GitHub for you, so run the `git remote add` and `git push` commands on your machine.

