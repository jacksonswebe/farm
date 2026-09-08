# 07 — Commercial Model & Go-to-Market

The source proposal positions SafeSphere as recurring SaaS but gives no numbers, no billing
enforcement and no payment rails. This fills that gap.

**Pricing here is a starting hypothesis to test in prospect interviews, not a decision.**
The one thing that is a decision: it is per-site + per-seat recurring, never a one-time licence.

---

## 1. What is actually being sold

Not "safety software". The buyer is the person who has to produce evidence during an audit, or
after a fatality, and cannot. Price against that:

| Buyer pain | What it costs them today | What the product replaces it with |
|---|---|---|
| Audit evidence scattered | Days of preparation, findings, sometimes lost contracts | A PDF pack in under 2 minutes |
| Corrective actions silently missed | Repeat incidents, regulatory exposure | Automated chase + escalation to the boss |
| No visibility across sites | Risk invisible until it materialises | One live dashboard |
| ISO 45001 certification/surveillance | Consultant days | Structured records that survive the audit |

The Incident PDF pack (S4-03) and the escalation engine (S3-05) are the two features that justify
the price. Everything else is table stakes.

## 2. Pricing hypothesis

Per organization, per month, billed annually (monthly available at +20 %).
Two currencies: USD for international, TZS for the local market at a locally-calibrated rate —
**not** a straight FX conversion of the USD price.

| | **Starter** | **Professional** | **Enterprise** |
|---|---|---|---|
| Target | Single-site SME, 50–200 workers | Multi-site mid-market, 200–2,000 | Group / multi-country |
| Sites | 1 | up to 10 | Unlimited |
| Seats included | 15 | 75 | Negotiated |
| Extra seat | $3 / mo | $2.50 / mo | Negotiated |
| Storage | 5 GB | 100 GB | Negotiated |
| Reporting, investigation, 5 Whys, CAPA | ✓ | ✓ | ✓ |
| Dashboards | Basic | Full + executive | Full + custom |
| Notifications | Email, in-app | + WhatsApp | + SMS |
| Incident PDF pack | ✓ | ✓ | ✓ |
| AI assistance | — | ✓ | ✓ |
| Audit-log export, auditor seats | — | ✓ | ✓ |
| SSO, API keys, data residency | — | — | ✓ |
| Support | Email, 48 h | Email + WhatsApp, 24 h | SLA + named contact |
| **USD / month** | **$149** | **$449** | from **$1,200** |
| **TZS / month** | **350,000** | **1,150,000** | from 3,000,000 |

Non-recurring:

| Item | Price | Note |
|---|---|---|
| Implementation & configuration | $900 – $3,500 | Scoped by sites and taxonomies. **Always charge it** — free setup signals the product is worthless and produces uncommitted customers |
| Data migration (open actions, historical incidents) | $400 – $1,500 | The CSV importer makes this margin, not labour |
| On-site training (per day) | $350 | Local delivery, high perceived value |
| Custom integration (HR/ERP) | Quoted | Enterprise only |

Add-ons: extra storage $15/100 GB/mo · SMS bundle at cost + 30 % · additional AI budget above the
org cap at cost + 40 % · in-country/customer-VPC hosting from $400/mo.

### Pricing notes worth arguing about

- **Per-site, not per-user, is the primary axis.** Worker seats must be effectively free at the
  margin or customers ration logins — and a safety product that rations reporters is broken.
  Charge for sites and for the manager seats that use the workflow.
- **The Starter tier is deliberately thin on AI and dashboards.** It exists to land single-site
  customers and to make Professional look obvious, not to be a good long-term home.
- **Never discount the subscription to win a pilot. Discount the implementation fee instead.**
  A discounted subscription resets your price anchor permanently; a discounted setup fee is a
  one-time concession that expires.

## 3. Unit economics

Infrastructure per tenant at MVP scale is close to nothing — the whole stack is one VPS:

| Line | Monthly |
|---|---|
| VPS (4 vCPU / 8 GB, ~50 tenants) | ~$25 |
| R2 storage + zero egress (~30 GB/tenant) | ~$0.50 / tenant |
| Resend email | ~$0.30 / tenant |
| WhatsApp conversations | ~$1–4 / tenant (usage-driven) |
| AI (capped at $25/org, typical use $3–8) | ~$5 / tenant |
| Sentry, uptime, backups | ~$0.50 / tenant |
| **Total COGS** | **≈ $8–14 / tenant / month** |

At $449 Professional that is a **~97 % gross margin**. The business constraint is not
infrastructure — it is sales cycles and implementation labour. Which means:

1. **Productise implementation.** A repeatable 5-day configuration playbook, delivered by a
   trained associate, not by the founder. Until it is a checklist, it is not a business.
2. **Every hour of custom work must either become a feature or be billed at a rate you would
   happily do it at forever.**
3. Target metrics: CAC payback < 6 months, gross logo churn < 10 %/yr (EHS software is sticky
   once the records live in it — switching means abandoning your audit history), NRR > 110 %
   from site expansion.

**The expansion motion is sites, not upsell.** A construction group that starts with one project
site adds the next one when it wins the tender. Land one site, instrument the value, and be
present when the next project starts.

## 4. Billing implementation (E12)

Already in the schema: `subscriptions` with `tier`, `status`, `seat_limit`, `site_limit`,
`storage_limit_gb`, `trial_ends_at`, `provider*` fields.

**Enforcement points** — check the limit, return `402 PLAN_LIMIT_EXCEEDED` with an upgrade link:

| Limit | Enforced at |
|---|---|
| Seats | Invitation creation and acceptance |
| Sites | Site creation |
| Storage | `POST /attachments/presign` |
| AI budget | Every AI call (soft warning at 80 %, hard stop at 100 %) |
| Feature gates (AI, WhatsApp, audit export) | Permission layer, by tier |

**Trial and dunning — never delete a customer's safety records:**

```
TRIALING ──30 days──▶ (no payment) ──▶ READ_ONLY ──60 days──▶ export offered, data retained
    │                                      ▲
    └──payment──▶ ACTIVE ──failed──▶ PAST_DUE ──14 days──▶ ┘
                     ▲                   │
                     └──── recovered ────┘
```

`READ_ONLY` means: everything is visible and exportable, nothing new can be created. A company
that cannot retrieve its injury records because an invoice bounced will never come back, and will
tell the market why.

**Payment rails.** A `PaymentProvider` interface with two implementations:

- **Stripe** — cards, international, self-serve checkout, the default.
- **A local rail** (Flutterwave / ClickPesa / Selcom) for mobile money — M-Pesa, Tigo Pesa,
  Airtel Money. In East Africa this is not a nice-to-have; a card-only checkout loses a large
  share of SME buyers outright.

Enterprise is invoiced: bank transfer, annual, PO-driven. Build the invoice PDF before the
self-serve checkout — the first real money will arrive that way.

Webhooks are signature-verified and idempotent on the provider event id
([02 §9.4](02-TECHNICAL-BLUEPRINT.md#94-payments)).

## 5. Go-to-market

### 5.1 Sequence

| Phase | Goal | Motion |
|---|---|---|
| **Design partners** (now → week 8) | 2 signed pilots | Founder-led. Discounted implementation, full price subscription, contractual weekly feedback |
| **Pilot → reference** (week 8 → 20) | 2 referenceable customers with numbers | Run the pilot exit metrics from [01-PRD §3](01-PRD-MVP.md#3-success-criteria-pilot-exit-gate). Publish the before/after |
| **Sector beachhead** (month 5–12) | 15–25 customers in one sector | Pick **one**: construction, or mining, or agro-processing. Not all three |
| **Channel** (month 12+) | Non-linear growth | HSE consultants and ISO 45001 certification bodies resell; insurers and industry associations refer |

### 5.2 Where the first customers come from

1. **HSE consultants and ISO 45001 auditors.** They sit with 20+ organizations that all have this
   exact problem, and they are asked "what should we use?" constantly. Give them a referral fee
   and a free auditor seat in every deployment. Highest-leverage channel available.
2. **Industry associations and contractor federations.** One presentation, a room full of buyers.
3. **Insurers and brokers** underwriting workers' compensation — they have a direct financial
   interest in falling incident rates and will introduce you.
4. **Large contractors' supply chains.** When a main contractor adopts it, they can require their
   subcontractors to report through it. One enterprise deal drags in a dozen SMEs.
5. **Regulator-driven urgency.** Organizations that have just had a serious incident or a
   regulatory finding buy immediately and do not haggle.

### 5.3 The demo is the pitch

From the source proposal's own conclusion, and it is right: one complete incident, live —
report on a phone → investigation → 5 Whys → CAPA assigned → reminder fires → verification →
dashboard updates → PDF pack exported. Fifteen minutes on the seeded demo tenant.

Do not present the 14-module feature catalogue. It invites "come back when you have permits and
training". Show the loop; offer the roadmap as something you are co-designing with them.

### 5.4 Content that compounds

The founder's media and events reach is a distribution asset most competitors do not have:

- **Incident teardowns.** Anonymised real incidents, walked through the 5 Whys, published as short
  video. This is simultaneously safety education, a product demo, and SEO.
- **A free annual "State of Workplace Safety" report** built on anonymised aggregate platform data
  — once there is enough of it. This is the asset that gets you into associations and press, and
  no competitor can copy it without your data.
- **Free tools as lead magnets**: incident-cost calculator, 5 Whys template, ISO 45001 readiness
  checklist. Each gated by an email address and followed by a demo offer.
- **Safety at your existing events.** An EHS track at an expo puts you physically in front of the
  exact buyers, at zero marginal customer-acquisition cost.

## 6. Revenue model — what it takes to matter

Blended ARPU of ~$400/month ($4,800/year):

| Customers | ARR | What it requires |
|---|---|---|
| 10 | ~$48 k | Founder-led sales, one sector |
| 50 | ~$240 k | A repeatable implementation playbook + 1 salesperson |
| 150 | ~$720 k | Channel partners producing, self-serve trial converting |
| 200 + enterprise mix | **~$1 M+** | Multi-country enterprise deals at $15–30 k/yr each carrying the average |

**The honest arithmetic:** at SME pricing, $1 M ARR needs roughly 200 customers — a real sales
organization and 3–4 years. The faster path is a **barbell**: a handful of enterprise/group
accounts at $15–30 k/yr (which alone can be a third of the target) sitting on top of a
self-serve SME base that provides volume, references and product feedback. Plan for both from the
start; the schema and RBAC already support the enterprise end (multi-site, auditor seats, audit
export, residency).

**What would make this materially bigger than a SaaS licence:** the aggregate safety dataset.
Anonymised, benchmarked incident data across an industry is something insurers, regulators and
large contractors will pay for, and it strengthens every month the product runs. That is a
Release-4 conversation — but only if tenant data ownership, consent and anonymisation are handled
correctly from day one, which is why they are in the schema and the retention policy now.
