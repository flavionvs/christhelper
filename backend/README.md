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

## Twice-weekly prayer request emails

The backend sends an automated engagement email on Monday and Thursday by default. It uses the existing SendGrid configuration and includes the latest active, public, non-expired requests.

Environment options:

- `ENGAGEMENT_EMAILS_ENABLED=true`
- `ENGAGEMENT_EMAIL_DAYS=1,4` (Monday and Thursday)
- `ENGAGEMENT_EMAIL_HOUR=9`
- `ENGAGEMENT_EMAIL_LIMIT=5`

Users can unsubscribe from the email link or from Profile > Preferences. Admins can manually trigger a send with `POST /admin/engagement-email/send-now`.
