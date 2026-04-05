# ChristHelper Backend - Node 24 Safe

This backend removes `better-sqlite3` and uses a simple JSON file database, so it works with Node 24 on Windows without Python or Visual Studio build tools.

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
- Stripe is optional. If not configured, donation requests are recorded in demo mode.
- API routes were kept compatible with the V1 frontend
