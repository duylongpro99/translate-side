# Selling Pro ($5/month) from a server-less MV3 extension

Date: 2026-10-13 · Scope: research only, no code changed · Sources checked 2026-10-13

## Outcome

**Use Polar.sh (license-key benefit on a $5/month subscription).** Keep Lemon Squeezy as the fallback.
Do not use Paddle, ExtensionPay or Stripe direct. Only three of the six options let an individual in
Vietnam get paid and also let the extension check a license without a server: Polar, Lemon Squeezy
and Gumroad. Polar ranks first for three reasons. It is a merchant of record that lists Vietnam for
payouts. Its license endpoints are documented as unauthenticated and "safe for public clients". And,
unlike Lemon Squeezy, it is not being moved onto Stripe Managed Payments, which does not accept
Vietnamese businesses.

**No manifest change is needed.** I loaded a test MV3 extension with only the `storage` permission
into headless Chromium (Playwright 1.64) and ran `fetch` from its service worker. The Polar, Lemon
Squeezy and Gumroad license endpoints all returned JSON. A control request to a site without CORS
(`example.com`) failed with "Failed to fetch". All three endpoints send `Access-Control-Allow-Origin: *`,
so the call needs no host permission, no optional-permission prompt and no change to
`scripts/check-manifest.mjs` or `docs/store/permission-justifications.md`. The privacy page does need
to change (see Fit below).

## Hard filters

| Provider | Merchant of record | Individual in Vietnam can be paid | License check without our server | Verdict |
|---|---|---|---|---|
| Polar.sh | Yes | Yes on paper: Vietnam is on the payout list, paid through Stripe Connect Express to a local bank account [P3] | Yes. Unauthenticated, CORS `*`, verified [P1][P2] | **1st** |
| Lemon Squeezy | Yes [L4] | Yes: Vietnam is on the bank payout list, and PayPal is available [L5] | Yes. No API key, CORS `*`, verified [L1] | **2nd** |
| Gumroad | Yes, since 2025-01-01 [G1] | Probably, through PayPal where bank deposit is not offered. UNVERIFIED for Vietnam [G2] | Yes. No auth, CORS `*`, verified [G3] | 3rd |
| Paddle | Yes [D1] | Vietnam is not on the excluded seller list; payouts by wire or Payoneer [D2][D3] | **No.** Billing has no license keys, and reading a subscription needs a secret API key [D4][D5] | Out |
| ExtensionPay | No. You handle tax yourself [E1] | **No.** Money goes to your own Stripe account [E1], and Stripe does not list Vietnam [S1] | Yes, through ExtPay.js | Out |
| Stripe direct or Managed Payments | Only in Managed Payments | **No.** Vietnam is not in Stripe's country list [S1] or the Managed Payments business locations [S2] | No. Needs a secret key | Out |

## Fees on one $5.00 sale, before tax

| Provider | Per sale | Net per sale | Payout costs |
|---|---|---|---|
| Polar Starter (orgs created after 2026-05-27) | 5% + $0.50 = $0.75; buyer card outside the US adds 1.5%, so $0.83 | $4.17–4.25 | $2 for each month with a payout, 0.25% + $0.25 per payout, plus 1% currency conversion outside the EU [P4] |
| Lemon Squeezy | 5% + $0.50 + 0.5% subscription = $0.78; outside the US +1.5% ($0.85); PayPal +1.5% more ($0.93) [L4] | $4.07–4.22 | 1% per bank payout outside the US; 3% per PayPal payout outside the US (capped at $30) [L4] |
| Gumroad | 10% + $0.50 = $1.00 [G1]; whether card processing is added on top is UNVERIFIED | ≤ $4.00 | UNVERIFIED |
| Paddle | 5% + $0.50 = $0.75; sales under $10 are "bespoke pricing" [D1] | $4.25 | Possible $15 SWIFT fee [D3] |

Lemon Squeezy calculates its fee on the total including tax [L4]. Polar and Lemon Squeezy come out
within about 2% of each other. Gumroad costs about 5 points more on a $5 price.

## Client-side verification, per viable provider

### Polar.sh (recommended)

- **Endpoints:** `POST https://api.polar.sh/v1/customer-portal/license-keys/{activate|validate|deactivate}`,
  JSON body. The API docs list them as "Unauthenticated", and the validate reference says it is "safe for
  public clients such as desktop or mobile apps" [P1][P2]. CORS allows any origin (`*`, max-age 600),
  verified. `organization_id` is a public UUID and can be hard-coded in the build.
- **What a call sends:** `key`, `organization_id`, and `activation_id` once activated. Activation also sends
  a `label`, which we choose. Polar also sees the user's IP address and the `chrome-extension://` origin.
  The response returns the customer record, including email and name, to the device [P2]. We should
  keep only the status fields.
- **What lapse looks like:** Cancelling sets `cancel_at_period_end`, and the benefits stay until
  `current_period_end`. A failed renewal goes to `past_due` and is retried up to four times; the
  seller can set a 0/2/7/14/21-day grace before benefits are revoked. After that the subscription is
  `unpaid`, which is revoked like a cancellation [P5]. License keys are listed as revoked automatically
  when a subscription is cancelled [P1]. Validate answers **404** when the key is "not found, revoked,
  disabled, or expired" or the activation does not match [P2]. So for us, 404 means "not Pro", not
  "offline". The only documented 200 status is `granted`.
- **Activations:** Set `limit_activations` on the benefit, for example 3 Chrome profiles. When the limit
  is set, the client must activate first and send `activation_id` on every validate. Activating past
  the limit returns 403 `NotPermitted` [P6]. Deactivate frees a slot, and customers can also free slots
  in the Polar customer portal if the seller allows it [P1].
- **Rate limit:** 3 requests per second for the license endpoints [P7]. Whether that is per IP or per
  organization is UNVERIFIED. If it is per organization, a 24-hour re-check still allows about 250,000
  checks a day.
- **Also check:** that `benefit_id` in the response matches our Pro benefit, because keys are not tied
  to one product unless scoped [P1].

### Lemon Squeezy (fallback)

- **Endpoints:** `POST https://api.lemonsqueezy.com/v1/licenses/{activate|validate|deactivate}`, sent as
  `application/x-www-form-urlencoded` with `Accept: application/json` and no API key [L1][L2][L3].
  CORS `*`, verified.
- **What a call sends:** `license_key`, plus `instance_name` on activate and `instance_id` afterwards. The
  response includes `meta.customer_email` and `customer_name`. Check `meta.store_id`, `product_id` and
  `variant_id` against hard-coded values [L6].
- **What lapse looks like:** `license_key.status` is `inactive`, `active`, `expired` or `disabled`. A
  subscription key changes to `expired` when the subscription expires, which happens only after the
  billing period of a cancelled subscription ends or after a failed payment can no longer be retried
  [L1][L7]. A paused subscription is not covered by the docs (UNVERIFIED).
- **Activations:** `activation_limit` is set per product or variant, and activating past it fails with
  "This license key has reached the activation limit" [L2]. Whether an unlimited setting exists is
  UNVERIFIED.
- **Rate limit:** the docs say 60 requests per minute [L1]. The live response header said
  `x-ratelimit-limit: 300`.
- **Adoption risk:** Lemon Squeezy's January 2026 update presents Stripe Managed Payments as the way
  forward. It tells merchants outside Stripe's countries to incorporate through Stripe Atlas, and it
  says nothing about license keys [L8]. Lemon Squeezy works today, but a Vietnam-based seller could be
  left without a home if the migration becomes mandatory.

### Gumroad (third)

`POST https://api.gumroad.com/v2/licenses/verify` takes `product_id`, `license_key` and
`increment_uses_count=false`, needs no auth, and is CORS `*` (verified) [G3]. A lapse shows up as
`purchase.subscription_cancelled_at`, `subscription_ended_at` and `subscription_failed_at`, which the
client has to interpret. There are no activation instances, only a uses counter, so there is no
per-device limit and no deactivation. Combined with the higher fee, it ranks last of the viable three.

## MV3 caveats and fit with the existing model

- **Permissions:** none to add. Call the endpoints from extension pages (options or panel) or the service
  worker, never from the content script, which runs with the page's origin. The current
  `optional_host_permissions` (`https://*/*`) could request `https://api.polar.sh/*`, but CORS makes a
  prompt unnecessary, so don't.
- **Service worker lifetime:** do not keep a timer in the worker. A scheduled check would need the
  `alarms` permission, which is a manifest change. Check lazily instead: when a Pro feature is used, or
  when Settings or the panel opens, look at `lastCheckedAt` and re-validate in the background if it is
  stale. `chrome.tabs.create` for the checkout link needs no permission.
- **Storage:** follow the API-key rule (`src/shared/settings.ts:182-198`). Put one `license` item in
  `storage.local`, never in sync: `{ key, activationId, status, expiresAt, lastCheckedAt, lastOkAt }`.
  Leave it out of Settings export unless keys are included, as with provider keys. Each Chrome profile
  activates its own copy, which matches how activation limits count.
- **Privacy and store text (required):** `docs/privacy.md` currently says "The extension makes network
  requests only to the provider addresses you configured" and "no account". Both become false the moment
  the license check ships. Add a section that names Polar, lists what is sent (key, activation ID, the
  IP address as with any request) and when (on activation, then about once a day while Pro is in use),
  and says there is no check for users who never enter a key. Update the store data-use answers to match.
- **Forks:** the gate is client-side in MIT code, so anyone can remove it. That trade-off is already
  accepted.

## Recommended re-check cadence

- **Activate** once, from Settings, on a click. Store `activationId`.
- **Fresh for 24 hours.** Pro features trust the cached `granted` result. After 24 hours the next Pro use
  (or opening Settings) re-validates in the background, so the feature does not wait on the network.
- **7-day offline grace.** A network error, a 5xx or a 429 keeps Pro on until `lastOkAt + 7 days`, and the
  client backs off (it honours `Retry-After`). After 7 days without a successful answer, Pro pauses and
  shows "Couldn't confirm your Pro subscription", with a retry button.
- **A definitive "no" turns Pro off at once:** a 404 from Polar, a non-`granted` status, a `benefit_id`
  that does not match, or `expires_at` in the past. Translations already cached stay readable, as the
  brainstorm requires.
- **Why 24 hours and 7 days:** cancellation already keeps access until the end of the billing period,
  and dunning plus the seller's grace (set it to 7 days in Polar) covers payment failures. So a daily
  check can at most extend a lapsed user by a day, and 7 days covers travel or flaky networks without
  making the grace a loophole.

## Exact HTTP calls (Polar)

```http
POST https://api.polar.sh/v1/customer-portal/license-keys/activate
Content-Type: application/json

{"key":"<user key>","organization_id":"<ORG_UUID>","label":"Translate Side (Chrome)"}
→ 200 {"id":"<activation_id>","license_key":{"status":"granted","limit_activations":3,"expires_at":null,…}}
→ 403 NotPermitted (limit reached, revoked, disabled or expired) · 404 key not found · 422 bad body
```

```http
POST https://api.polar.sh/v1/customer-portal/license-keys/validate
Content-Type: application/json

{"key":"<user key>","organization_id":"<ORG_UUID>","activation_id":"<activation_id>","benefit_id":"<PRO_BENEFIT_UUID>"}
→ 200 {"status":"granted","benefit_id":"…","expires_at":null|"…","activation":{…},"customer":{…}}  → Pro on
→ 404 not found, revoked, disabled, expired or mismatched  → Pro off
→ 429 / 5xx / network error  → keep cached state within the 7-day grace
```

```http
POST https://api.polar.sh/v1/customer-portal/license-keys/deactivate
Content-Type: application/json

{"key":"<user key>","organization_id":"<ORG_UUID>","activation_id":"<activation_id>"}
→ 204   (Settings › Pro › "Remove from this browser", then delete the local item)
```

Buying works like this: Settings opens a Polar checkout link in a new tab, Polar emails the license key
(it is also in the customer portal), and the user pastes it into Settings › Pro.

## Trade-off summary

| Dimension | Polar | Lemon Squeezy | Gumroad |
|---|---|---|---|
| Net on $5 | ≈ $4.17–4.25 | ≈ $4.07–4.22 | ≤ $4.00 |
| Vietnam payout | Listed; local VND bank account through Stripe Connect Express | Listed for bank and PayPal | PayPal, UNVERIFIED |
| Public license API | Documented as public | Works keyless | Works keyless |
| Device limit and deactivate | Yes | Yes | No |
| Lapse signal | 404 (clear) | `status: expired` (clear) | Timestamps to interpret |
| Platform risk | Young; fees changed May 2026; open source | Being moved to Stripe MP, which excludes Vietnam | Stable but expensive |

## Sources

- [P1] https://polar.sh/docs/features/benefits/license-keys
- [P2] https://polar.sh/docs/api-reference/customer-portal/license-keys/validate
- [P3] https://polar.sh/docs/merchant-of-record/supported-countries
- [P4] https://polar.sh/docs/merchant-of-record/fees
- [P5] https://polar.sh/docs/features/subscriptions/failed-payments , https://polar.sh/docs/features/subscriptions/introduction
- [P6] https://polar.sh/docs/api-reference/customer-portal/license-keys/activate
- [P7] https://polar.sh/docs/api-reference/introduction
- [L1] https://docs.lemonsqueezy.com/api/license-api (also /validate-license-key)
- [L2] https://docs.lemonsqueezy.com/api/license-api/activate-license-key
- [L3] https://docs.lemonsqueezy.com/api/license-api/deactivate-license-key
- [L4] https://docs.lemonsqueezy.com/help/getting-started/fees , https://www.lemonsqueezy.com/pricing
- [L5] https://docs.lemonsqueezy.com/help/getting-started/supported-countries
- [L6] https://docs.lemonsqueezy.com/guides/tutorials/license-keys
- [L7] https://docs.lemonsqueezy.com/help/licensing/license-keys-subscriptions
- [L8] https://www.lemonsqueezy.com/blog/2026-update
- [G1] https://gumroad.com/pricing · [G2] https://gumroad.com/help/article/13-getting-paid (country table not readable) · [G3] Gumroad license verify API, checked live
- [D1] https://www.paddle.com/pricing · [D2] https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle
- [D3] https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid · [D4] https://developer.paddle.com/migrate/learn/feature-comparison/ · [D5] https://developer.paddle.com/paddlejs/include-paddlejs
- [E1] https://extensionpay.com/ , https://github.com/Glench/ExtPay
- [S1] https://stripe.com/global · [S2] https://docs.stripe.com/payments/managed-payments/eligibility
- Chrome: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests. Its text only
  says cross-origin requests are "treated as cross-origin" without host permissions; the CORS
  behaviour was settled by the Chromium test above.

## Limitations

Fees and payout terms change often (Polar repriced in May 2026), so check them again at sign-up. I did
not create merchant accounts, so onboarding as an individual from Vietnam is unproven for every
provider. I did not test real keys through a full subscription lifecycle (cancel, past due, pause). I
did not review tax obligations in Vietnam on merchant-of-record payouts.

## Unresolved questions

1. Can an **individual** (not a company) in Vietnam finish Polar's Stripe Connect Express onboarding with a
   VND bank account? Stripe's own docs offer self-serve cross-border payouts only to US, UK, EEA, CA and CH,
   so Polar must rely on a special arrangement. The owner should start Polar onboarding before any code is
   written. If it fails, use Lemon Squeezy.
2. Is Polar's 3 requests per second per IP or per organization?
3. Does a Polar validate still return `granted` during the past-due grace? The docs say the grace delays
   revocation, which implies yes. Test this in the sandbox.
4. Which Chrome Web Store data-use boxes does a license check that receives the buyer's email tick? And
   does the listing need an "in-app purchases" note now that store payments are gone?
5. Should Lemon Squeezy migrate to Stripe Managed Payments, will existing license keys keep validating?
