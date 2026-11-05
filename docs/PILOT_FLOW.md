# Company pilot

New pilot scope: one site, up to 25 active workers, and up to 30 days from approved activation. Fees and rollout terms are agreed manually before activation. This flow does not collect a card or charge automatically.

## Customer journey

1. Public navigation, hero, and Pilot plan card lead to `#pilot`.
2. The inquiry collects company, work email, country, industry, company site/team size, languages and the intended use case. Country, industry and site information are included in the existing inquiry message. Existing receipt/retry protection and contact-data retention apply.
3. After discussing scope, direct the company to `#register` to prepare its owner account. Neon email verification remains required.
4. Verification creates one company/site and a read-only `pilot_pending` entitlement with no end date. It also records a pending activation request. Email verification does not start pilot access or its clock.
5. Signing in before approval shows the pilot approval screen instead of asking the owner to complete blocked setup. The owner can contact the team or recheck approval.
6. Approval enables first-run setup, then ordinary instruction and worker workflows. Expiry is enforced by the existing read-only entitlement gates, preserving retained records.

## Platform admin approval

Open **Entitlements** in the platform admin console, locate the company and choose **Review pilot**. Its preset is Pilot/evaluation, plan `pilot`, 25 workers and a date 30 days ahead. Review the agreed scope/date, confirm and apply the entitlement. This accepts the pending activation request and records the operator decision. Initial approval resets the pilot start instant to approval time. Extensions preserve the original start and require another explicit admin decision.

The server rejects operational pilot grants above 25 workers, more than 30 days into the future, or for an organization with multiple sites. Both SQLite and PostgreSQL site-creation paths prevent adding a second site during a pilot. To authorize a paid multi-site rollout, record the appropriate paid plan and access terms in the admin console. Payment/invoicing remains a separate process.

## Compatibility and deployment

The internal `trial` state is reused for an approved, time-limited pilot; `plan` distinguishes `pilot` and `pilot_pending`. This avoids changing historical schema constraints or resetting existing account dates/terms. Existing customer entitlements remain unchanged. No new environment variable or database migration is required for this replacement.

Inquiry notification delivery still uses the existing configured mail service. A saved inquiry is not proof of email delivery or pilot approval. Neon continues to handle email verification; provider settings and credentials were not changed.

Validation covers verification without activation, one pending approval request, authenticated operator approval, receipt replay, expiry, worker/site caps, first-run gating and the English/Arabic public request flow. Tests use disposable data and synthetic mail; no live verification messages are sent for these checks.
