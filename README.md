# ChristHelper V1

ChristHelper V1 is a starter full-stack web app based on the platform concept you described: a Christian support network where users can browse projects, pray, reply, volunteer, and donate safely.

This package was created from your platform brief. See the original idea summary here: fileciteturn0file0

## Included

### Frontend
- Homepage with live project cards and filters
- Project detail page
- Submit project page
- Login and register pages
- Help ChristHelper page
- Simple admin dashboard
- Success page after payment

### Backend
- Node.js + Express API
- SQLite database using better-sqlite3
- JWT login/register
- Project listing and detail endpoints
- Prayer, reply, report, and submit project endpoints
- Admin review endpoints
- Stripe Checkout endpoints for project support and ChristHelper support
- Seed data + demo admin account

## Folder structure

```text
christhelper-v1/
  backend/
    package.json
    server.js
    .env.example
  frontend/
    index.html
    project.html
    submit.html
    help-christhelper.html
    login.html
    register.html
    admin.html
    success.html
    css/styles.css
    js/app.js
```

## Run locally

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Backend default URL:

```text
http://localhost:3000
```

Demo admin:

```text
admin@christhelper.local
admin123
```

### 2. Frontend

Serve the `frontend` folder with any static server. Example with VS Code Live Server.

Recommended frontend URL:

```text
http://127.0.0.1:5500
```

If needed, update the API URL in browser localStorage:

```js
localStorage.setItem('christhelper.api', 'http://localhost:3000')
```

## Stripe setup

1. Put your Stripe secret key in `backend/.env`
2. Set `FRONTEND_URL` correctly
3. Configure your Stripe webhook to call:

```text
http://localhost:3000/webhook
```

4. Put the webhook secret in `STRIPE_WEBHOOK_SECRET`

If Stripe is not configured, checkout endpoints still work in demo mode and record a pending donation in SQLite.

## Suggested V2 improvements

- Better session handling and password reset
- File/image upload with moderation rules
- Real project owner dashboard
- Comment threading and notifications
- Church/ministry verification workflow
- Better admin moderation tools
- Email confirmations
- Donation receipts
- Deployment configuration for production

