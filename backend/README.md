# ChristHelper Backend - Node 24 Safe

This backend uses a simple JSON file database, so it works with Node 24 on Windows without native SQLite build tools.

## Run

```powershell
cd C:\dev\christhelper\backend
copy .env.example .env
npm install
npm start
```

## Default admin

- Email: `admin@christhelper.local`
- Password: `admin123`

## Notes

- Data is stored in `data.json`
- Stripe is optional. If not configured, donation requests are recorded in demo mode
- The backend now supports Stripe Connect Express onboarding for project owners
- Profile routes:
  - `GET /auth/me`
  - `GET /profile`
  - `POST /stripe/connect/onboard`
  - `GET /stripe/connect/status`
- Project donations only open when:
  - admin approved financial support
  - the project owner connected Stripe
  - Stripe reports charges enabled for that owner account
