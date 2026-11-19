# Subscription launch and Paddle sandbox preparation

## Catalog

All prices are USD per month, before applicable taxes. The 10% reduction recurs
every month; there is no annual prepayment or extra discount code.

| Plan | List | Recurring price | Workers | Supervisors | Sites | Characters/month | Transcription minutes/month |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Starter | $99 | $89.10 | 25 | 2 | 1 | 200,000 | 60 |
| Pro | $299 | $269.10 | 100 | 5 | 3 | 750,000 | 300 |
| Business | $799 | $719.10 | 300 | 15 | 10 | 2,500,000 | 1,000 |
| Enterprise | $2,499 | From $2,249.10 | 1,000 | 40 | 25 | 10,000,000 | 3,000 |

The source of truth is `server/subscription-plans.mjs`. Characters mean the
combined instruction, question, choices and clarification text in each generated
language version. A translated and narrated version consumes the bundled
allowance once. Replaying an existing recording does not generate new audio.
Allowances do not roll over. Enterprise custom integrations, security commitments
and dedicated infrastructure require separate scoping and pricing.

New pilot applications are retired (HTTP 410). Old private inquiry receipts and
existing entitlement history remain readable. New signups default to Starter and
stay read-only after email verification. Old unverified pilot registrations finish
as Starter pending instead of starting a trial. No existing approved pilot is
silently converted into a charge or canceled.

## What works in this release

- Owner-only subscription selection in pending workspace access and Plan & usage.
- Disabled-by-default Paddle sandbox transactions, with price validation on the server.
- Explicit test checkout labeling and sandbox-only browser tokens and API host.
- Signed raw-body webhook verification, five-minute timestamp tolerance, bounded
  requests and event deduplication.
- Durable checkout request identity. A lost response reuses a known transaction;
  an unknown remote creation outcome requires reconciliation rather than creating
  another possible charge.
- Completed initial test payments create an immutable test allowance grant with
  per-service estimated cost reserves. Duplicate notifications cannot grant twice.
- Test grants cannot activate workspace entitlements, dispatch paid provider work
  or transfer money. No live mode exists in this release.

The test ledger is deliberately separate from the existing invoice/payment ledger,
which records invoices and already-received manual payments.

## Cash flow with zero starting funds

Paddle is the merchant of record. A checkout payment is not a bank payout and is
not a payment to Azure, Groq, DeepL, Neon or Vercel. Paddle pays out periodically
subject to the account's threshold, deductions and verification. Provider funding
must happen using settled money through each provider's supported billing method.

Internal reserves in `provider_budget_json` are accounting estimates, not cash,
provider balances or financial transfers. Do not label them purchased API credits.
Azure and hosting may bill usage rather than support an immediate credit purchase.

With $0 available, instant paid-service delivery cannot be funded from an
unsettled Paddle balance. Before accepting live subscriptions, arrange startup
funding, provider-approved billing terms or an explicitly agreed delayed start
after settlement. Do not collect money promising immediate service while unable
to fund that service. No bank details, provider billing settings or spending
limits were changed by this implementation.

## Sandbox setup

1. Apply migration `131_subscription_checkout.sql` using the existing migration
   runner and migration credential. Re-run `configureRuntimePermissions` for the
   application and worker profiles so application ledger inserts work and workers
   cannot read billing data. Never grant schema ownership to the runtime.
2. Create four Paddle sandbox products and active monthly recurring USD prices:
   `8910`, `26910`, `71910`, `224910` cents. Frequency 1 month, no trial,
   quantity 1. These prices already contain 10% off; do not apply another discount.
   Avoid country overrides while using this fixed-USD preparation.
3. Set the blank server-side environment variables in `.env.example` privately.
   Use sandbox API credentials, a `test_` client token and sandbox price IDs.
   Set `UNDERSTOOD_PADDLE_MODE=sandbox`. Never place API keys or webhook secrets
   in Vite variables, the client bundle, source control or chat.
4. Set the Paddle default payment link to the site's HTTPS URL. The signed-in
   subscription panel loads Paddle.js and opens the server-created transaction.
   Configure the webhook destination as
   `https://<app-domain>/api/subscriptions/paddle/webhook` and subscribe to
   `transaction.completed`. The endpoint bypasses browser Origin checks only for
   this exact signed webhook path; browser checkout requests still require the
   current owner session, session-context header and same-origin mutation checks.
5. Use Paddle test cards. Verify a correct-price checkout, an altered price,
   duplicate notification, tampered signature, unknown checkout result and a
   non-owner attempt. Confirm test grants do not unlock real workspace activity.
6. Keep `UNDERSTOOD_PADDLE_MODE=disabled` outside the approved sandbox test.

This code does not automatically create Paddle accounts/products or deploy, apply
production migrations, transfer funds, or change existing provider credentials.

## Required before live subscriptions

Live acceptance remains disabled until the following implementation is completed
and verified with a funded account:

- Provider settlement reconciliation and funded reserve accounting based on
  actual received cash, net of Paddle fees, tax treatment, refunds and disputes.
- Atomic per-organization character/minute spending reservations and reconciliation
  at every provider entry point. The existing request quotas remain in force;
  catalog character limits and test grants are not yet live spend enforcement.
- Payment-backed entitlement activation and enforcement of worker, supervisor and
  site limits. Never use checkout browser events to grant access.
- Recurring renewals, upgrade/downgrade proration, cancellation, past-due, pause,
  refund and chargeback events, including out-of-order delivery and reconciliation.
  The prepared webhook currently handles initial sandbox checkout completion only.
- Approved live Paddle account/domain, live products/prices, tested refund and
  subscription-management flows, customer terms and the actual access-start policy.
- Measured real paid API rates and load/egress/storage costs at included usage.

## Discounted unit economics (estimates, not invoices)

Paddle publishes 5% + $0.50 per checkout transaction. Using that rate, the earlier
full-usage cost forecast and the new 10% discount gives:

| Plan | Revenue | API | Incremental hosting | Support reserve | Paddle estimate | Contribution |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Starter | $89.10 | $16 | $3 | $10 | $4.96 | $55.14 |
| Pro | $269.10 | $60 | $8 | $25 | $13.96 | $162.14 |
| Business | $719.10 | $197 | $25 | $75 | $36.46 | $385.64 |
| Enterprise | $2,249.10 | $786 | $150 | $300 | $112.96 | $900.14 |

These are rounded planning amounts excluding shared platform overhead (previous
budget $120/month), sales, development, taxes, refunds and custom enterprise work.
Actual Paddle deductions can differ with tax-inclusive checkout settings and
account terms. Internal provider reserves use $30/M translation characters,
$25/M voice characters, $10/M for text AI, a 20% retry reserve on those three,
and $0.111/hour transcription. Rates require verification against live invoices.

Official references checked 18 November 2026:
- https://www.paddle.com/pricing
- https://developer.paddle.com/build/go-live-checklist/
- https://developer.paddle.com/sdks/sandbox/
- https://developer.paddle.com/webhooks/about/how-webhooks-work/
- https://developer.paddle.com/build/reports/payout-reconciliation/
