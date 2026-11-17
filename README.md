# Skyway flight booking

Responsive flight booking website built with HTML, CSS and vanilla JavaScript. The runnable backend uses Node.js 24+ and SQLite. PHP/MySQL deployment files are included as an alternate stack.

## Run locally

From this folder, run `node server.mjs`, then open `http://127.0.0.1:4173` on the same computer. Search results and pending booking requests are saved in `data/skyway.sqlite`.

## Free demo deployment on Render

The included `render.yaml` uses Render's free web service tier. Add this folder to a GitHub repository, connect that repo to Render as a Blueprint, and deploy. Render provides the public URL after the first successful deploy. The free tier can spin down while idle and its filesystem is ephemeral, so booking records are temporary and may disappear on restarts or deploys. Do not use this tier for real bookings.

For persistent local SQLite storage, use a paid Render web service with a persistent disk mounted at the app's `data` folder. The service listens on the host-provided `PORT` and binds to `0.0.0.0`. Alternatively, switch to a managed database for a production architecture.

## Deploy the PHP/MySQL version

Import `schema.sql` into MySQL, configure `DB_HOST`, `DB_NAME`, `DB_USER` and `DB_PASS`, and serve this folder through Apache with PHP and `mod_rewrite` enabled. `.htaccess` maps `/api/search` and `/api/book` to `api.php`.

## Scope

The included flight results are sample fares, and bookings are saved as pending requests. This project does not charge payment, issue airline tickets, authenticate travelers, or connect to live airline inventory. Connect an authorized inventory provider and a payment processor before accepting real bookings. Fonts and destination photography are loaded from external providers.
