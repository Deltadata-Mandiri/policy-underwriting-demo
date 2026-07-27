# BRI Life · Underwriting Console

A simple web console over the `policy_underwriting` workflow, served by a
zero-dependency backend-for-frontend proxy that keeps the Conductor key/secret
**server-side** — the browser only ever talks to this proxy's `/api/*` routes.

Same architecture as `../../credit-score-demo/credit-ui`: pure Node (≥18), built-in
`fetch` + `http`, no `npm install` required.

## Run

```bash
cp .env.example .env      # fill in CONDUCTOR_SERVER_URL / AUTH_KEY / AUTH_SECRET
node server.js            # -> http://localhost:4300
```

The `policy_underwriting` workflow (v1) must already be registered on the tenant
(`npx @conductor-oss/conductor-cli workflow create ../policy_underwriting.json`).

## What it does

- **Application form** — all the underwriting inputs, with health / family-history /
  hazardous-hobby checkbox groups that map straight onto the workflow's array inputs.
  `asOfDate` is set to today so age is computed live. Quick-fill buttons load the
  Rated / Refer / Decline / Postpone scenarios.
- **Decision panel** — polls the workflow and shows the risk score, risk class, premium
  loading, annual & monthly premium, age/BMI, the full list of rating factors, any policy
  exclusions, and the rendered decision letter.
- **Underwriter review** — when a case routes to `REFER`, the workflow pauses on the
  `underwriter_review_ref` WAIT task and the console shows a review panel. Submitting it
  posts `{decision, loadingPct, note, reviewedBy}` to
  `/tasks/{id}/underwriter_review_ref/COMPLETED`, and polling resumes to the final letter.

## API surface (proxy)

| Route | Conductor call |
|---|---|
| `POST /api/applications` | `POST /workflow/policy_underwriting?version=1` |
| `GET /api/applications/{id}` | `GET /workflow/{id}?includeTasks=true` (flags the WAIT task) |
| `POST /api/applications/{id}/review` | `POST /tasks/{id}/underwriter_review_ref/COMPLETED` |

## Not production

Prototype only — no authentication. `reviewedBy` is free text that should be bound to an
SSO identity before this drives anything real.
