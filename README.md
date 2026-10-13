# Payback

A free bonus app for the **Postonomous** launch (Oct 15–22, 2026). Postonomous makes and scores social content; Payback helps the buyer turn credits and scores into money.

Live at **https://payback.misanmorrison.com** (password-protected).

## What's inside

| Tab | Tools |
|---|---|
| **How to Use** | Orientation and step-by-step guide for every tool |
| **CreditMap** | Credit Budget Builder · Brand Split & Plan-Fit Checker · Use-It-or-Lose-It Tracker |
| **Retainer** | Retainer Pricing Engine · Margin & Payback Calculator · Audit One-Pager |
| **Proven** | Budget Splitter · Predicted-vs-Actual Calibration Log · Boost Ledger |

Every tool autosaves its last inputs and has **Save / Open / Delete** plus **Copy**.

## How it's built

Fully static: plain HTML, CSS and JavaScript. No build step, no framework, no API calls, no backend, no hosting cost. All "smart" output comes from rule engines and templates working on the buyer's own inputs. Saved work lives in the buyer's browser (`localStorage`, keys prefixed `payback_`): no accounts, no cross-device sync.

Credit rates are defaults taken from the worked examples on the Postonomous sales page and are editable in the app (the buyer is told to confirm them against their Billing page). All outputs carry an "estimate, not a forecast or guarantee" note.

## Password gate

A client-side SHA-256 check (`GATE_HASH` in `app.js`). This is a soft deterrent that keeps the page out of search engines and casual hands. It is **not** real security: anyone with dev tools can read the hash. The plaintext password is never committed.

## Hosting

GitHub Pages via Actions (`.github/workflows/pages.yml`), deployed on every push to `main`. Custom domain via the `CNAME` file and the repo's Pages settings.

Powered by [Misan Morrison](https://misanmorrison.com/).
