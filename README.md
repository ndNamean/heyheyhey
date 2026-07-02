# Hey Pelo Ops — InstantDB Edition

Full-stack restaurant operations platform. Google OAuth login, owner/admin approval gate, real-time queries, and photo proof storage — all backed by InstantDB (no server required).

---

## Prerequisites

- Node.js 18+ and npm installed
- [InstantDB account](https://www.instantdb.com) — app ID is already configured
- Google Cloud Console project with OAuth 2.0 credentials

---

## One-time setup

### 1. Install dependencies

```powershell
cd "restaurant-ops-instant"
npm install
```

### 2. Configure Google OAuth

a. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials.

b. Create an **OAuth 2.0 Web Client**:
   - Authorized redirect URIs: `https://api.instantdb.com/runtime/oauth/callback`
   - Authorized JavaScript origins: `http://localhost:5173` (dev) + your production domain

c. Go to [Instant Dashboard](https://www.instantdb.com/dash) → your app → **Auth** tab → **Set up Google** → paste your Client ID and Secret.

d. Note the **clientName** you set (default: `google-web`) — it must match what's in `src/components/GoogleLoginButton.tsx`.

### 3. Fill in your .env

Open `.env` and replace the placeholder values:

```
VITE_GOOGLE_CLIENT_ID=your_google_client_id
INSTANT_ADMIN_TOKEN=your_instant_admin_token
```

The `VITE_INSTANT_APP_ID` is already set to your app.

### 4. Push schema and permissions to Instant

```powershell
npx instant-cli@latest push schema --yes
npx instant-cli@latest push perms
```

This creates all the database entities and security rules in your Instant app.

### 5. Run the dev server

```powershell
npm run dev
```

Open http://localhost:5173

---

## First owner bootstrap

After first sign-in your account will be in **pending** status. To promote yourself to owner:

```powershell
npm run seed-owner -- your@email.com
```

This requires `INSTANT_ADMIN_TOKEN` to be set in `.env`. After running it, reload the app.

---

## User approval flow

```
Google sign-in → pending profile created
     ↓
Owner/areaManager sees request in Users → Access Requests tab
     ↓
Approves with role (staff/leader/manager/etc.) + store assignments
     ↓
User's screen updates in real-time — no refresh needed
```

---

## Roles and permissions

| Role | Capabilities |
|------|-------------|
| `owner` | Everything, including approving other owners/areaManagers |
| `areaManager` | Approve users, edit stores/templates, review all reports |
| `manager` | Review reports for assigned stores |
| `leader` / `subleader` | Submit and review at item level for assigned roles |
| `staff` | Submit reports for assigned stores |
| `viewer` | Read-only access to reports |

---

## Project structure

```
restaurant-ops-instant/
├── instant.schema.ts        # All 15+ entities and relationship links
├── instant.perms.ts         # Security rules (default-deny + role gates)
├── src/
│   ├── db.ts                # InstantDB init
│   ├── components/
│   │   ├── AuthGate.tsx     # Login / pending / rejected / approved states
│   │   ├── GoogleLoginButton.tsx
│   │   ├── Nav.tsx          # Desktop top nav + mobile bottom nav
│   │   └── TimemarkCamera.tsx  # GPS watermark camera + Instant Storage upload
│   ├── pages/               # 13 page components
│   │   ├── DashboardPage    # Metrics, filters, failed items
│   │   ├── StaffHome        # Today's slots for non-admin users
│   │   ├── SubmitReportPage # Step-by-step checklist wizard
│   │   ├── ReviewPage       # Approve/reject items with photo review
│   │   ├── UsersPage        # Access requests + all users management
│   │   ├── StoresPage       # Store CRUD with GPS coordinates
│   │   ├── TemplatesPage    # Checklist template builder
│   │   ├── CorrectiveActionsPage
│   │   ├── PhotoSheetPage
│   │   ├── VerifyPhotoPage  # Look up HP-XX-YYYYMMDD-XXXX codes
│   │   ├── ShiftsPage       # Scheduling + GPS clock-in/out
│   │   └── LogbookPage      # Shift notes + announcements + acks
│   └── lib/
│       ├── roles.ts         # Role helper functions (port of Roles.gs)
│       └── utils.ts         # Date helpers, badge classes, photo codes
└── scripts/
    └── seed-owner.ts        # One-time owner bootstrap
```

---

## Deployment

1. Build: `npm run build`
2. Deploy the `dist/` folder to [Vercel](https://vercel.com), [Netlify](https://netlify.com), or any static host.
3. Add your production domain to:
   - Google Cloud Console → OAuth client → Authorized JavaScript origins
   - Instant Dashboard → Auth → your Google client
4. Set `VITE_GOOGLE_CLIENT_ID` and `VITE_INSTANT_APP_ID` as environment variables in your host.
