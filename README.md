# cf-analytics

A Vercel-style analytics dashboard for **Cloudflare Web Analytics**. It runs as a single Cloudflare Worker that you deploy to your own account. You sign in with a Cloudflare API token and get visits, page views, top pages, referrers, countries, devices, browsers and operating systems for every Web Analytics site in your account, with one site switcher.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/imfaisii009/cf-analytics)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![cf-analytics dashboard showing visits, page views, a 30-day chart and breakdown panels](docs/screenshot.png)

## Why

Cloudflare Web Analytics is free, cookie-less and privacy-friendly, but its dashboard is spread across zones and accounts. cf-analytics puts all of your sites behind one switcher in a layout modeled on Vercel Analytics. It reads Cloudflare's GraphQL Analytics API directly, so nothing new gets added to your sites and no data is stored anywhere.

## Features

- **Every site in one place.** Lists all Web Analytics sites across every account your token can read, plus an "All sites" view for each account.
- **Visits, page views and views per visit**, each with the change against the previous period of the same length.
- **Time ranges** of 24 hours (hourly), 7 days, 30 days and 3 months (daily). The bucket that is still in progress is drawn dashed.
- **Breakdowns:** pages, hostnames, referrers, countries (with flags), devices, browsers and operating systems. Each panel opens a searchable full list.
- **Online now:** visits in the last 5 minutes.
- **Shareable state:** the account, site, range and metric live in the URL.
- **Sign in with a Cloudflare API token.** The token is encrypted (AES-GCM) into an `HttpOnly`, `Secure` cookie, so page scripts can never read it.
- Responsive down to phone width.

## Deploy

### One click

Click **Deploy to Cloudflare** above. Cloudflare copies this repository to your GitHub account, asks for one secret, then builds and deploys the Worker:

| Secret | Value |
| --- | --- |
| `SESSION_SECRET` | Any long random string. Generate one with `openssl rand -hex 32`. |

### From the command line

```bash
git clone https://github.com/imfaisii009/cf-analytics.git
cd cf-analytics
npm install
npx wrangler login
npx wrangler secret put SESSION_SECRET   # paste the output of: openssl rand -hex 32
npm run deploy
```

Wrangler prints your URL, for example `https://cf-analytics.<your-subdomain>.workers.dev`.

## Sign in

Create a **user API token** with these two read-only permissions:

| Scope | Permission | Used for |
| --- | --- | --- |
| Account | Account Analytics: Read | Querying Web Analytics through the GraphQL API |
| Account | Account Settings: Read | Listing your Web Analytics sites |

[Create this token with both permissions pre-filled](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=Web%20Analytics%20Dashboard). The login screen links there too. Paste the token into the login screen; the session lasts 7 days.

Your sites need [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/) turned on, either automatically for proxied sites or with the JS beacon.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then put a random string in SESSION_SECRET
npm run dev
```

Open `http://localhost:5173`. To work on the UI without a token, open `http://localhost:5173/?demo` to load generated sample data. Demo mode only exists in the dev server and is removed from production builds.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with the Worker running in workerd |
| `npm run build` | Type-check the app and Worker, then build both |
| `npm run deploy` | Build, then `wrangler deploy` |
| `npm run lint` | oxlint |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |

## How it works

One Worker serves both the React single-page app (as [static assets](https://developers.cloudflare.com/workers/static-assets/)) and a small JSON API under `/api/*`:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/login` | Checks the token against the Cloudflare API, then sets the encrypted session cookie |
| `POST /api/logout` | Clears the cookie |
| `GET /api/me` | Lists the accounts the token can read |
| `GET /api/sites` | Lists Web Analytics sites (`/accounts/{id}/rum/site_info/list`) |
| `GET /api/analytics?account=&site=&range=` | Runs one GraphQL query and returns totals, the time series and every breakdown |

Each dashboard load is a single GraphQL request to the `rumPageloadEventsAdaptiveGroups` dataset. Aliases fetch the totals, the previous period, online visitors, the series and seven breakdowns in one round trip. The request and response types live in [`shared/api.ts`](shared/api.ts), which both the Worker and the UI import.

POST requests must send `Content-Type: application/json` and a same-origin `Origin` header. The cookie is `SameSite=Lax`.

## What Cloudflare's data can and can't show

- **Visits, not unique visitors.** Cloudflare Web Analytics sets no cookies, so it counts visits: page views whose referrer is another site or empty. There is no unique-visitor metric.
- **No bounce rate.** Cloudflare has no session data, so the third metric is views per visit instead.
- **No UTM parameters.** Cloudflare drops query strings from page paths.
- **Sampled data.** Large sites and long ranges come back from Cloudflare's adaptive sampling, so you may see rounded numbers such as 81,200.
- **History.** Cloudflare keeps about 6 months of data and allows at most 93 days per query, which is why the longest range is 3 months.

## Project structure

```text
cf-analytics/
├── worker/
│   ├── index.ts         # routes, CSRF checks, handlers
│   ├── cloudflare.ts    # REST calls, GraphQL query builder and response shaping
│   └── session.ts       # AES-GCM session cookie
├── shared/api.ts        # API contract shared by Worker and UI
├── src/
│   ├── App.tsx          # sign-in gate
│   ├── Login.tsx
│   ├── Header.tsx       # site switcher, log out
│   ├── Dashboard.tsx    # URL state, data fetching, toolbar
│   ├── Overview.tsx     # metric tabs and chart
│   ├── Breakdowns.tsx   # breakdown panels and "view all" dialog
│   ├── demo.ts          # sample data for ?demo (dev only)
│   └── components/ui/   # shadcn/ui components
├── wrangler.jsonc
└── vite.config.ts
```

## Stack

React 19, Vite with [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/), Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com) (Radix), Recharts, the Geist font, and Cloudflare Workers.

## Hosted instance

You can try it at [cf-analytics.imfaisii009.workers.dev](https://cf-analytics.imfaisii009.workers.dev) with your own token. Signing in there sends your read-only token to a Worker someone else runs, so for regular use deploy your own copy with the button above.

## Notes

This project isn't affiliated with Vercel or Cloudflare. The layout is inspired by Vercel Analytics; no Vercel code or assets are used.

## License

[MIT](LICENSE)
