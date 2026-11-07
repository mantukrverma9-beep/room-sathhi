# RoomSaathi

A room, flat and PG rental marketplace demo built with plain HTML, CSS, browser JavaScript and Node.js.

## Run on your computer

1. Install Node.js 22.13 or newer (the built-in SQLite module is used).
2. Open this folder in a terminal and run `npm start`.
3. Open `http://127.0.0.1:3000`.

## GitHub Pages preview

You can publish the contents of `public/` plus the safe sample files `data/listings.json`, `data/india-states.json` and `data/chhattisgarh-locations.json` as a read-only preview. Keep the same relative folder layout. This preview supports styling, sample room cards, details and search. GitHub Pages cannot run `server.js`, SQLite, login, publishing, uploads or owner tools; those features need a separate Node.js host. Do not upload `data/users.json`, `data/roomsaathi.sqlite`, `data/media/` or `.env`.

No paid service or npm package is required for the local demo. On first start, the app imports `data/listings.json` and `data/users.json` into `data/roomsaathi.sqlite`. The JSON files remain as a readable snapshot; after migration, SQLite is the live data store. Back up the SQLite file and its WAL files while the server is stopped.

## Features

- Search by location, home type and monthly budget
- Chhattisgarh as the default state, with all 33 districts and starter town suggestions
- Owner accounts, password hashing, email verification and password reset flows
- Owner dashboard to edit, mark rented, or remove listings
- Optional review queue for new and edited listings
- Room photos and video tours
- Minimum monthly rent: PG ₹1,500 and Flat ₹5,000
- SQLite storage for accounts, listings and one-time verification/reset tokens
- Rate limits on account endpoints and same-origin checks on writes

## Local email links

The demo does not send real email. It prints verification and reset links in the terminal and returns a local preview link to the browser. This lets you learn and test the complete flow without paying for an email service. Never expose local preview links on a public server. In production, `SHOW_LOCAL_EMAIL_LINKS=false` prevents account creation until a real email provider is implemented and configured.

## Listing moderation

Moderation is off by default so the starter project is easy to try. To turn it on, set these environment variables before running Node:

```text
REQUIRE_MODERATION=true
ADMIN_EMAILS=admin@example.com
```

Create an account using an address listed in `ADMIN_EMAILS`, verify it using the local link, and log in. The **Review listings** button then lets the administrator approve or reject pending places. Keep the administrator email private. Do not use an email address you cannot access as an admin account.

On PowerShell, for a one-time local run:

```powershell
$env:REQUIRE_MODERATION = 'true'
$env:ADMIN_EMAILS = 'your-email@example.com'
npm start
```

## Locations

The address order is **state → district → city/town → area/locality → PIN code**. `data/india-states.json` contains states and Union Territories. `data/chhattisgarh-locations.json` contains the district list and a starter set of towns. Other towns and areas can be typed manually. PIN lookup uses the public PostalPincode service and needs internet access. The full PIN directory is too large and changes over time, so the app does not bundle it.

## Before a public launch

This is still a learning project, not a production-ready service. Real verification/reset emails need an email provider and verified sender domain; choose one only after checking whether its current plan is free. Public hosting, a domain, reliable media storage and backups may also cost money, so this project does not sign you up for or configure any paid service. Login sessions are stored in server memory and end when it restarts. Uploaded media is stored on local disk.

Before going public, also configure HTTPS at the hosting proxy, set `NODE_ENV=production`, set an accurate `APP_ORIGIN`, keep `SHOW_LOCAL_EMAIL_LINKS=false`, and add email delivery. Until email delivery is configured, production sign-up is deliberately disabled. Do not expose admin accounts. The built-in rate limit is in memory and resets when the server restarts; a public multi-server deployment needs shared sessions/rate limiting, monitoring, moderation procedures, data backups and a security review. The current local demo binds to `127.0.0.1`; production defaults to `0.0.0.0` for a hosting container.

Booking, payments, built-in chat, identity checks and property ownership checks are not included. Renters should visit and verify a place before paying anyone.

## Where to read the code

- `server.js` — API, account security, SQLite setup, search and moderation.
- `public/index.html` — page sections, forms and dialogs.
- `public/styles.css` — colors, spacing and responsive layouts.
- `public/app.js` — search, accounts, uploads, forms and dialogs.
- `data/india-states.json` — state suggestions.
- `data/chhattisgarh-locations.json` — districts and starter town suggestions.
