# Database Setup Guide

## Current Issue

The backend is trying to connect to a database but `DATABASE_URL` environment variable is not configured.

**Error:** `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`

## Quick Solutions

### Option 1: Use Railway Database (Recommended for Production)

Your code already has Railway setup files. To use Railway's database:

1. **Get your Railway DATABASE_URL:**
   - Go to https://railway.app
   - Open your project
   - Click on your PostgreSQL service
   - Copy the `DATABASE_URL` from the variables tab

2. **Set environment variable:**
   ```bash
   export DATABASE_URL="your_railway_database_url_here"
   export PGSSLMODE=require
   cd backend
   npm start
   ```

3. **Run migrations:**
   ```bash
   cd backend
   node scripts/run-notification-migration.js
   ```

### Option 2: Local PostgreSQL Setup

For local development:

1. **Install PostgreSQL:**
   ```bash
   sudo apt-get update
   sudo apt-get install postgresql postgresql-contrib
   ```

2. **Create database and user:**
   ```bash
   sudo -u postgres createdb eamax
   sudo -u postgres psql -c "CREATE USER eamax WITH PASSWORD 'eamax123';"
   sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE eamax TO eamax;"
   ```

3. **Run schema:**
   ```bash
   psql -U eamax -d eamax -f backend/sql/schema.sql
   ```

4. **Run migrations:**
   ```bash
   cd backend
   node scripts/run-notification-migration.js
   ```

5. **Create .env file:**
   ```bash
   cd backend
   cat > .env << 'EOF'
   DATABASE_URL=postgresql://eamax:eamax123@localhost:5432/eamax
   PORT=4000
   NODE_ENV=development
   FIREBASE_SERVICE_ACCOUNT_KEY=your_firebase_service_account_json_here
   EOF
   ```

6. **Start backend:**
   ```bash
   npm start
   ```

### Option 3: Use Existing Railway Database (If Already Deployed)

If you already have a Railway database running:

1. **Check Railway environment:**
   ```bash
   railway variables
   ```

2. **Link to Railway project:**
   ```bash
   railway link
   ```

3. **Run backend with Railway env:**
   ```bash
   cd backend
   railway run npm start
   ```

## Verify Connection

After setting up the database:

1. **Test health endpoint:**
   ```bash
   curl http://localhost:4000/health
   ```
   
   Expected: `{"status":"ok","message":"EaMax backend is running"}`

2. **Test database connection:**
   ```bash
   curl http://localhost:4000/health/db
   ```
   
   Expected: `{"status":"ok","database":"connected"}`

3. **Test dashboard API:**
   ```bash
   curl http://localhost:4000/api/dashboard/stats
   ```
   
   Expected: JSON with stats (totalUsers, premiumUsers, etc.)

## Firebase Configuration

For push notifications to work, you also need Firebase credentials:

1. **Get Firebase service account key:**
   - Go to Firebase Console: https://console.firebase.google.com
   - Select your project
   - Go to Project Settings > Service Accounts
   - Click "Generate New Private Key"
   - Download the JSON file

2. **Set as environment variable:**
   ```bash
   export FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"your-project",...}'
   ```
   
   Or add to `.env` file (as a single line, no newlines).

## Common Errors and Solutions

### Error: "client password must be a string"
**Solution:** Set `DATABASE_URL` environment variable properly.

### Error: "relation does not exist"
**Solution:** Run the database schema:
```bash
psql -U eamax -d eamax -f backend/sql/schema.sql
```

### Error: "column does not exist"
**Solution:** Run the migration:
```bash
cd backend
node scripts/run-notification-migration.js
```

### Error: "Connection refused"
**Solution:** Make sure PostgreSQL is running:
```bash
sudo service postgresql start
# or
sudo systemctl start postgresql
```

## Environment Variables Reference

Required environment variables for the backend:

```bash
# Database (Required)
DATABASE_URL=postgresql://username:password@host:port/database

# SSL for cloud databases (Railway, Heroku, etc.)
PGSSLMODE=require

# Server
PORT=4000
NODE_ENV=development

# Firebase (Required for notifications)
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}

# Optional
HOST=0.0.0.0
```

## Full Deployment Flow

1. **Setup Database:**
   ```bash
   # Use Railway or local PostgreSQL
   export DATABASE_URL="your_database_url"
   ```

2. **Run Schema:**
   ```bash
   psql -U eamax -d eamax -f backend/sql/schema.sql
   ```

3. **Run Migrations:**
   ```bash
   cd backend
   node scripts/run-notification-migration.js
   ```

4. **Start Backend:**
   ```bash
   npm start
   ```

5. **Verify:**
   ```bash
   curl http://localhost:4000/health/db
   curl http://localhost:4000/api/dashboard/stats
   ```

6. **Run Admin App:**
   ```bash
   cd EaAdmin
   npx react-native run-android
   ```

## Need Help?

- Check Railway setup guide: `RAILWAY_SETUP.md`
- Firebase setup: `FIREBASE_SETUP.md`
- Backend logs for detailed errors
- Database connection: Use `psql` to test manually

## Production Checklist

Before deploying to production:

- [ ] Database URL configured
- [ ] SSL enabled for database connection
- [ ] Firebase service account key set
- [ ] Schema applied to database
- [ ] Migrations run successfully
- [ ] Backend health check passes
- [ ] Dashboard API returns data
- [ ] Notifications can be sent
- [ ] All endpoints tested

## Testing Without Database (Temporary)

If you need to test the UI without a database connection, you can temporarily modify the dashboard route to return mock data. **This is only for UI testing - NOT for production!**

Not recommended, but if needed:
1. Edit `backend/src/routes/dashboard.js`
2. Return hardcoded stats instead of querying database
3. Remember to revert before deploying

**Always use a real database for actual deployment.**
