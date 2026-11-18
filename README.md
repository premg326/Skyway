# Skyway flight booking demo

Responsive HTML/CSS/JavaScript flight-booking demo with a Node.js 24 and SQLite backend. The Render service uses the free plan and stores its SQLite file on the service filesystem.

## Included flows

- Flight search for round trips, one-way trips, and multi-city trips (2–4 legs) with generated sample fares.
- Seven-day flexible-date fare comparison with one-click date switching; the displayed prices are illustrative demo estimates.
- Dedicated Explore view with destination cards that launch a sample flight search when selected.
- Account registration, sign-in, profile and password changes, sign-out, salted `scrypt` password hashes, and seven-day `HttpOnly` session cookies.
- Guest booking and signed-in booking, with up to nine traveler names and a booking contact.
- Confirmed demo booking references, account booking history, guest booking lookup by reference and email, and demo cancellation.
- Newsletter signups stored in SQLite.

## Run locally

Requires Node.js 24 or later. From this folder run `node server.mjs`, then open `http://127.0.0.1:4173`. SQLite data is stored in `data/skyway.sqlite` by default. Set `DATA_DIR` to choose another data directory.

## Render deployment

`render.yaml` configures a free Node web service. Free Render instances can sleep while idle and have ephemeral filesystems, so accounts and booking records can be cleared by a restart or redeploy. This tier is for demos only.

## Real booking limitations

Fares and schedules are generated examples. “Confirmed” means confirmed inside this demo only: the app does not charge payment, reserve airline inventory, issue a PNR or ticket, or send email. Account creation does not verify email and password reset email is not configured. Before taking real bookings, connect an authorized airline/GDS inventory provider, payment processor, persistent managed database, email delivery service, and the applicable operational and legal workflows.

## PHP/MySQL starter files

`api.php` and `schema.sql` are a separate basic search and booking-request starter for PHP/MySQL. The deployed Node demo uses `server.mjs` and SQLite; the account/session flows described above are implemented in that Node app.
