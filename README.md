# Term-Life Underwriting — Orkes Conductor

Standalone underwriting for a **term-life insurance** policy, modelled on Indonesian
life-insurer practice (IDR amounts, OJK-style adverse-action disclosure, entry/maturity
age limits, financial anti-over-insurance).

One workflow definition — `policy_underwriting` — that takes an application, computes a
**deterministic, explainable mortality-risk score**, routes it down one of five
underwriting outcomes, prices the annual premium, and produces a decision letter as a PDF.

```
validate → gate → assess_risk → decision_router ─┬─ ACCEPT_STANDARD → price → set
                                                 ├─ ACCEPT_RATED    → price → set
                                                 ├─ REFER  → underwriter WAIT → price → set
                                                 ├─ POSTPONE                → set
                                                 └─ DECLINE                 → set
        → decision letter (LLM) → PDF → notify
```

Plus **`policy-ui/`** — a BDN Life–themed underwriting console over the workflow, served
by a zero-dependency backend-for-frontend proxy that keeps the Conductor key/secret
server-side. Application form with health/family/hobby checkbox groups, a live decision
panel (score, premium, exclusions, letter), and an underwriter review panel that drives
the `REFER` WAIT gate. See [policy-ui/README.md](policy-ui/README.md).

```bash
cd policy-ui && cp .env.example .env   # fill in credentials
node server.js                         # -> http://localhost:4300
```

## Why this shape

Life underwriting is not a single score — it is a **score plus a set of hard rules that
override the score**. A 30-year-old with active cancer is uninsurable regardless of how
clean the rest of the file is; an applicant whose cover would exceed 30× their income
needs a human to justify it no matter how healthy they are. So the decision is layered,
and the order matters:

1. **Structural hard rules** — entry age (18–65), maturity age ceiling (75), valid term.
2. **Clinical hard rules** — decline-list conditions (e.g. `active_cancer`) → **DECLINE**;
   postpone-list conditions (e.g. `pending_surgery`) → **POSTPONE**. These short-circuit
   before the score is even banded.
3. **Financial / large-case rules** — cover > 30× income, or sum assured ≥ Rp 5 miliar →
   forced **REFER** (financial justification / senior sign-off), independent of health.
4. **The score** — only if none of the above fire does the debit total decide the band.

That layering is exactly why the demo `sample_decline.json` scores only **50** but is
still declined: the clinical rule wins. A score-only system would have accepted it.

## The risk model (`assess_risk`)

Deterministic and explainable — every point is traceable to a named factor in
`reasonCodes`, in the debit tradition of manual underwriting. Age is computed from
`dateOfBirth` against a pinned `asOfDate` so results never drift as real time passes.

| Factor | Debits |
|---|---|
| Age 31–40 / 41–50 / 51–60 / over 60 | +20 / +50 / +90 / +150 |
| Tobacco/nicotine use | +80 |
| BMI class I (28–31.9 or 17–18.4) / II (32–36.9 or 15–16.9) / III | +30 / +80 / +150 |
| Occupation class 2 / 3 (heavy manual) / 4 (hazardous) | +20 / +70 / +150 |
| Hypertension controlled / uncontrolled | +40 / +120 |
| Diabetes type-2 controlled / uncontrolled / type-1 | +90 / +160 / +160 |
| High cholesterol / asthma mild / asthma severe | +30 / +20 / +80 |
| Cancer in remission | +150 |
| Thyroid disorder / depression treated / sleep apnea / hepatitis B | +20 / +30 / +40 / +60 |
| Family history: cardiac / cancer / stroke before 60 | +40 / +40 / +30 |
| Family history: diabetes | +20 |
| Hazardous pursuit (scuba / aviation / motorsport / mountaineering / skydiving) | +40…+70 **and an exclusion** |

Banding, once the hard rules have not fired:

| Score | Band | Risk class | Outcome |
|---|---|---|---|
| ≤ 40 | `STANDARD` | PREFERRED (≤10 & non-smoker) / STANDARD | Accept at standard rates |
| 41–120 | `RATED` | SUBSTANDARD | Accept with premium loading + any exclusions |
| 121–220 | `REFER` | REFER | Underwriter WAIT — accept / decline / postpone |
| > 220 | `DECLINE` | UNINSURABLE | Decline |

Loading for `RATED`: score ≤70 → **+50%**, ≤100 → **+100%**, ≤120 → **+150%**.

### Hard rules (override the score)

| Rule | Outcome |
|---|---|
| Age < 18 or > 65 | DECLINE |
| Age + term > 75 (maturity ceiling) | DECLINE |
| `active_cancer`, `recent_heart_attack`, `recent_stroke`, `severe_heart_disease`, `organ_failure`, `end_stage_renal` | DECLINE |
| `pending_surgery`, `pending_diagnosis`, `recent_hospitalization`, `pregnancy_complication` | POSTPONE |
| Sum assured > 30× annual income | REFER (financial justification) |
| Sum assured ≥ Rp 5 miliar | REFER (large case — medical evidence + senior sign-off) |

## Premium pricing

A base mortality rate per mille of sum assured, driven by age and smoker status, with the
substandard loading applied on top:

```
ratePerMille = 1.5 + max(0, age − 25) × 0.12       (× 1.8 if smoker)
annualPremium = (sumAssured / 1000) × ratePerMille × (1 + loadingPct / 100)
```

Rounded to the nearest Rp 1.000. The same formula prices the underwriter's manual
decision on the REFER path, using the loading the underwriter sets.

## Running it

Credentials are read the same way as the sibling demos (server URL + app key/secret in
`../credit-score-demo/credit-ui/.env`, or your own Conductor CLI config).

```bash
npx @conductor-oss/conductor-cli workflow create policy_underwriting.json
npx @conductor-oss/conductor-cli workflow start -w policy_underwriting -f sample_standard.json
```

| Sample | Subject | Age | Score | Outcome |
|---|---|---|---|---|
| `sample_standard.json` | Andi Wijaya | 30 | 0 | `STANDARD` / **PREFERRED** → Rp 2.100.000/yr |
| `sample_rated.json` | Dewi Lestari | 42 | 110 | `RATED` / SUBSTANDARD, +150% → Rp 8.850.000/yr |
| `sample_refer.json` | Slamet Riyadi | 55 | 200 | `REFER` — smoker + BMI + age, underwriter WAIT |
| `sample_large_case.json` | Hendra Gunawan | 40 | 20 | `REFER` — healthy but Rp 6 miliar large case |
| `sample_decline.json` | Bambang Sutrisno | 46 | 50 | `DECLINE` / **UNINSURABLE** — active cancer overrides score |
| `sample_postpone.json` | Rina Marlina | 36 | 20 | `POSTPONE` — pending surgery, invite re-apply |

Every sample pins `asOfDate: 2026-07-27`, so the age maths is deterministic and the
outcomes above are reproducible.

### Signalling an underwriter review (REFER path)

`sample_refer.json` and `sample_large_case.json` pause `RUNNING` on the WAIT task. A
reviewer console (or curl) completes it — `decision` is `ACCEPT`, `DECLINE`, or
`POSTPONE`; on `ACCEPT`, `loadingPct` feeds the premium calculation:

```bash
curl -X POST "$CONDUCTOR_SERVER_URL/tasks/{workflowId}/underwriter_review_ref/COMPLETED" \
  -H "Content-Type: application/json" -H "X-Authorization: $TOKEN" \
  -d '{"decision":"ACCEPT","loadingPct":75,"note":"APS reviewed; controlled risk","reviewedBy":"Chief Underwriter"}'
```

## Two design points worth demoing

**Postpone is not decline.** They are distinct outcomes with distinct letters. A pending
surgery or diagnosis is a *timing* problem — the risk is unmeasurable **right now**, not
unacceptable. The workflow keeps them separate so the applicant is invited to re-apply
rather than turned away, which is both fairer and commercially correct.

**Hazardous pursuits produce exclusions, not just loadings.** Scuba, aviation, motorsport
and the like add debits *and* attach a named exclusion (e.g. *"Death occurring during
competitive motorsport"*) that flows all the way into the decision letter. That mirrors
how real term-life is written: you price the ordinary risk and carve out the extraordinary
one, rather than declining an otherwise healthy applicant over a weekend hobby.

## Path to production

The workflow shape does not change — only a few task bodies do:

| Demo (now) | Production |
|---|---|
| `assess_risk` INLINE with inline debit tables | Rules engine / actuarial rating service via `HTTP`, or a reinsurer's automated-underwriting API (e.g. SCOR, Munich Re, RGA) |
| Medical/family/hobby arrays passed in per run | `HTTP` pulls from the tele-underwriting questionnaire + APS / medical-exam vendor |
| `underwriter_review` WAIT signalled by curl | Underwriting workbench UI posting the task completion, `reviewedBy` bound to SSO |
| `prepare_notification` INLINE | `EVENT` to the notification sink, or `HTTP` to the messaging gateway |
| Premium formula INLINE | Product/actuarial pricing service; the formula here is illustrative, not tariff-accurate |

## Gotchas handled while building this

- **Arrays into an INLINE task arrive as Java-`List`-backed proxies** where the reflective
  JS APIs misbehave. The three list inputs (`medicalConditions`, `familyHistory`,
  `hazardousHobbies`) are serialized to a JSON string with `JSON_JQ_TRANSFORM` + `tojson`
  in `stringify_inputs` first, and `assess_risk` `JSON.parse`s a genuine string.
- **Arrays into LLM messages** get Java-`toString`'d into `{k=v}` garbage. `reasonCodes`,
  `exclusions`, and the decline/postpone reason lists are joined into readable strings in
  `stringify_context` (`JSON_JQ_TRANSFORM` + `join`) before reaching the letter prompt.
- **Hard rules must be evaluated before banding**, or a clinical decline gets quietly
  accepted because its numeric score happens to be low. The order in `assess_risk` is
  structural → clinical → financial → score, and the samples prove it (`sample_decline`
  scores 50 but declines).
- **The LLM must never assert cover is in force.** The system prompt forbids stating the
  policy is active until premium is paid; the notification body says the same in Indonesian
  (*"Pertanggungan berlaku setelah premi dibayarkan"*). Re-check this whenever the prompt
  changes.

## Demo data — fictional

⚠ The names, medical histories, and financials in the `sample_*.json` files are invented
for demonstration and do not refer to real people. The premium formula and debit tables
are illustrative and are **not** an actuarial tariff.
