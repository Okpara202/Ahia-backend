# Ahia — Backend Handoff

This document lists every backend integration the frontend expects. CLAUDE.md §8 has the
canonical list of routes from day-one planning; this file extends it with everything
that's been built (or stubbed) in the prototype since, plus implementation notes the
backend team needs.

Use this alongside the type definitions in [`src/types/index.ts`](src/types/index.ts) —
those are the shapes the frontend already consumes.

> **Looking for the frontend integration contract?** See [`FRONTEND_HANDOFF.md`](FRONTEND_HANDOFF.md)
> for the post-build documentation: every endpoint, response shape, Socket.io event,
> Paystack flow, and what's deferred. That doc is authoritative for "what's actually
> shipped"; this one is the original plan + decisions.

---

## 0a. Build status (last updated 2026-05-27)

**Shipped end-to-end:**

| Module | Status |
| --- | --- |
| Auth (email/password + JWT cookie) | ✅ |
| Google OAuth | ✅ |
| Apple OAuth | ⏸ Deferred to v2 |
| Forgot password | ⏸ Deferred (needs Resend) |
| Shops (CRUD + avatar/banner upload) | ✅ |
| Products read (feed, search, getById) | ✅ |
| Products write (create, update, delete, visibility) | ✅ |
| Conversations + messages (text, image, offer, system) | ✅ |
| Socket.io (chat + notifications) | ✅ |
| Transactions (escrow + Paystack + webhook) | ✅ |
| Auto-release job (7-day) | ✅ |
| Disputes | ✅ |
| Wishlist (server-side) | ✅ |
| Reviews | ✅ |
| Notifications (DB + socket) | ✅ |
| Boosts (product promotion + Paystack) | ✅ |
| Boost expiry job (hourly) | ✅ |
| Discover (posts, feed with paid slots, campaigns, analytics) | ✅ |
| Stories (24h ephemeral) | ✅ |
| Referrals (codes, claim, auto-completion) | ✅ |
| Image / video uploads to Cloudinary | ✅ |
| Resend (transactional emails) | ⚠️ Integration null-safe, no API key set — emails skipped in dev |
| Admin UI | — No frontend; flip role via Prisma Studio |
| Apple webhook (form-post) | ⏸ With Apple OAuth |
| Payment-request message type | Reserved in schema enum; no endpoint yet |
| Browse-before-signup gating | ✅ Enforced per-route via `requireAuth`; no global allowlist needed |

**Infra shipped:** Winston logger (JSON in prod, pretty in dev), custom error hierarchy
(`AppError` + `NotFoundError` / `ForbiddenError` / etc.), Zod validation on every
endpoint, request logger middleware, rate limiter (general + auth-strict), Redis adapter
for multi-instance Socket.io, Prisma migrations, two cron-style background jobs (escrow
auto-release + boost expiry).

**Migrations applied to date:**
1. `init` — all 16 base tables + enums (matches the CLAUDE.md §7 schema)
2. `v1_paystack_refs_and_referral_constraints` — combined: `paystack_ref` unique columns on Boost + DiscoverCampaign, foreign key on DiscoverPost.shopId + index, `Referral` constraint swap (dropped `@unique` on `code`, added composite `@@unique([referrerId, inviteeId])` + `@@index([inviteeId, status])`)

**Decisions made during build:**
- **ORM: Prisma** (over Drizzle).
- **Hosting: Render** (Web Service + Blueprint via committed `render.yaml`). Free tier; migrations run in `buildCommand` (free-tier doesn't support `preDeployCommand`).
- **bcrypt vs bcryptjs: kept bcrypt** — the install-time tar vuln is install-only, runtime safe.
- **Webhook source of truth:** transaction rows are only created when Paystack confirms (not at init time). Prevents orphan rows on abandoned checkouts.
- **Single Paystack dispatcher:** `paystack.controller.ts` routes by `metadata.type` (`escrow`/`boost`/`discover`). New monetized flows plug in with one switch case.
- **Plans shared between Boost and Discover:** same 3 plan IDs and prices (₦5k/₦12k/₦20k). Single source of truth in `src/modules/boosts/boosts.plans.ts`.
- **Referral code:** the user's shop handle (lowercase). Users without a shop can't refer.
- **Stories cleanup:** query-time filter only. No background job. Acceptable since the table grows slowly.
- **Cross-origin auth (production):** session cookie uses `SameSite=none; Secure` in production so a frontend on a different origin (including localhost dev) can authenticate against the prod backend. Dev still uses `SameSite=lax` for localhost convenience. CORS allowlist provides the practical CSRF gate.
- **`CLIENT_URL` is comma-separated:** the env var accepts multiple origins; the first one is the canonical post-OAuth and `/r/:code` redirect target.
- **`COOKIE_DOMAIN` is optional** (was `default("localhost")`). A defensive runtime check ignores `COOKIE_DOMAIN=localhost` in production so a misconfigured env doesn't silently break cookies.

**Endpoints/contract changes from the plan:**
- `transactions/by-reference/:reference` — added for the frontend to poll after Paystack returns. Not in §2 of the original plan.
- `transactions/sales` — added for seller view (claude.md §8 implied something like this but didn't enumerate).
- `PATCH /transactions/:id/release` — added so the buyer can release early (claude.md mentioned auto-release after 7 days only).

**Deploy artifacts:**
- [`render.yaml`](render.yaml) — Render Blueprint declaring the web service, build/start/migrate commands, health check path (`/health`), and 15 env vars marked `sync: false` (to be filled per environment).
- `package.json` build script: `prisma generate && tsc -p tsconfig.json` — generates the Prisma client before compilation. Render's `buildCommand` runs `npm install && npm run build && npx prisma migrate deploy`.

---

## 0. Stack — what you're building

| Layer              | Tool                             | Notes                                                                                                                                              |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / runtime | **TypeScript** + Node.js 20+     | Strict mode on. Shared interfaces with frontend (copy from `src/types/index.ts` or extract to an `@ahia/types` package).                           |
| Framework          | **Express.js**                   | Plus `helmet`, `cors` (whitelist `CLIENT_URL`), `cookie-parser`, `express-rate-limit`.                                                             |
| Database           | **PostgreSQL** (Neon serverless) | Schemas in CLAUDE.md §7. Recommend Prisma or Drizzle ORM. Use migrations from day one.                                                             |
| Cache / sessions   | **Redis** (Upstash)              | Online-status, feed cache, rate-limit counters, Socket.io adapter.                                                                                 |
| Auth               | **JWT in httpOnly cookies**      | Never expose tokens to JS. 7-day expiry. Refresh-token flow optional for MVP.                                                                      |
| Realtime           | **Socket.io**                    | One server, both chat and notifications. Adapter on Redis for multi-instance.                                                                      |
| File storage       | **Cloudinary**                   | Frontend uploads File → backend signs/uploads → returns URL. Direct browser upload is **not** used; CLAUDE.md §5 was revised — see §3 of this doc. |
| Payments           | **Paystack**                     | All payment logic backend-only. Frontend never sees secret keys. Webhook is the source of truth.                                                   |
| Email              | **Resend**                       | Transactional only. Templates for: payment_paid, payment_released, dispute_opened, dispute_resolved.                                               |
| Validation         | **Zod** recommended              | Validate every request body + query. Schemas can be exported and shared with frontend later.                                                       |
| Hosting            | **Render or Railway**            | Vercel is for the Next.js frontend, not Express.                                                                                                   |

Env vars list lives in CLAUDE.md §20.

---

## 1. Integration map (where backend plugs in)

The frontend never calls third-party services directly except Cloudinary uploads (and even
those are proxied through the backend now — see §3). Two seams matter:

| Frontend file           | Today                                                 | When backend lands                                                                |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/lib/services/*.ts` | Returns mock data with `setTimeout` delay             | Replace function body with Axios call. Signatures and return types do not change. |
| `src/lib/actions/*.ts`  | `"use server"` files that mutate in-memory mock store | Replace body with Axios call from server. Same export signature.                  |

So the integration approach is: keep the function names and types, swap the bodies.
No page or component needs changes.

---

## 2. Endpoints

The base list (auth/users/shops/products/feed/search/conversations/transactions/disputes/
notifications) is in CLAUDE.md §8. Below are **additions and clarifications** from work
since that document was written.

### Auth — full surface including OAuth

The frontend has Google and Apple OAuth buttons stubbed on `/login` and `/signup`
([`src/app/(auth)/_components/OAuthButtons.tsx`](<src/app/(auth)/_components/OAuthButtons.tsx>)).
Both routes call `handleOAuth()` which currently just redirects to `/onboarding`.
For production:

```
POST   /auth/signup                   { name, email, password } → set httpOnly cookie + 201
POST   /auth/login                    { email, password } → set httpOnly cookie + 200
POST   /auth/logout                   clear cookie → 204
GET    /auth/me                       current session user → 200 with User, or 401

// OAuth — redirect-based, no JS-readable tokens
GET    /auth/google/start?next=...    302 → Google consent screen
GET    /auth/google/callback          handles ?code=, exchanges for user info, finds-or-
                                      creates user, sets cookie, 302 → /onboarding (first
                                      sign-in) or `?next` (returning user)
GET    /auth/apple/start?next=...     same shape
POST   /auth/apple/callback           Apple posts the form back, not GET
```

**OAuth implementation notes:**

- Provider client IDs/secrets live in env (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`).
- Pass the `?next=` param through the OAuth round-trip via the `state` parameter (signed,
  short-lived) so the callback can route the user back to where they came from. The
  frontend `/signup?next=/inbox` flow depends on this.
- On first OAuth sign-in: create `users` row with no password, role default `"buyer"`,
  then redirect to `/onboarding`. On subsequent: skip onboarding, route to `?next` or `/feed`.
- Apple specifically: callback is `POST` form-post, not GET. Easy to miss.
- Email-conflict policy: if a user signs up with email/password and later tries Google
  with the same email, treat it as a link — verify ownership and merge. (Out of MVP if
  you want to skip — just return 409 and ask them to log in with the original method.)

**Standard error response shape** (use everywhere):

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Email is already in use",
    "fields": { "email": "Already registered" }
  }
}
```

Frontend's Axios interceptor can map `error.code` to a known set; `error.fields` is for
form-level inline validation. HTTP status follows the usual: 400 validation, 401 auth,
403 forbidden, 404 not found, 409 conflict, 422 unprocessable, 500 server.

### Products — new + clarified

```
POST   /products                    multipart form: images[] (File[]) + JSON fields
                                    OR JSON: { name, price, category, description, image_urls[] }
                                    First image becomes the cover, rest become gallery.
                                    See §3 for the image-upload contract.

PATCH  /products/:id                same body as POST. Re-ordering images[] reassigns
                                    cover. Frontend sends the full ordered list.

DELETE /products/:id                soft-delete recommended (set deleted_at) so disputes
                                    can still reference the product. Returns 204.

PATCH  /products/:id/visibility     { hidden: boolean }
                                    "Hide" keeps the product in the DB and accessible from
                                    inbox/transactions but excludes it from feed + search
                                    + shop storefront. Distinct from DELETE.
```

### Discover (ads surface) — entirely new since CLAUDE.md §8

Discover is **not** the same surface as shop catalogs. A `discover_posts` table holds
videos that only show in the Discover feed; they have their own engagement counters and
their own monetization model. CLAUDE.md §17 covers the boost concept; this is the
implementation.

```
GET    /discover?cursor=&limit=                    paginated Discover feed
       → { items: DiscoverFeedItem[], nextCursor }
       Server is responsible for the organic ranking and paid-slot interleaving.
       Current frontend assumes paid slots at positions [2, 6, 10] of each 12-item page,
       but server can override.

POST   /discover/posts                             seller uploads a new ad post
       multipart: { video: File, poster?: File, caption?, cta }
       cta: { type: "product", productId } | { type: "shop", shopId }

POST   /discover/campaigns                         buy/extend a campaign for a post
       { postId, plan: "monthly" | "quarterly" | "biannual" }
       → Paystack init: server returns authorization_url, frontend redirects.
       On Paystack success webhook: create row in discover_campaigns with starts_at = now,
       ends_at = starts_at + plan.months.

GET    /discover/campaigns/me                      my (seller) campaigns
       → DiscoverAdCampaign[] (with embedded post)

GET    /discover/campaigns/:id/analytics           per-campaign analytics
       → { campaign, post, daily: DailyAdStat[] }
       daily covers the campaign's full duration, one row per day:
       { date: "YYYY-MM-DD", impressions: number, clicks: number, spend: number }

POST   /discover/posts/:id/impression              fire-and-forget. Batch on backend.
POST   /discover/posts/:id/click                   fired when CTA tapped.
POST   /discover/posts/:id/save                    saves the linked product to wishlist.
```

Pricing (placeholder, awaiting team finalize) lives in `src/lib/mocks/boosts.ts → BOOST_PLANS`:
₦5,000 / 1 month, ₦12,000 / 3 months, ₦20,000 / 6 months. Same plan IDs are used for
product boosts (`POST /boosts`) and for Discover campaigns.

### Boosts — was schema-only in CLAUDE.md §7, now wired

```
GET    /boosts/plans                               list active plans
POST   /boosts                                     buy a product boost
       { productId, plan: "monthly" | "quarterly" | "biannual" }
       → Paystack init flow, same as Discover campaigns.
GET    /boosts/me                                  my active boosts
```

Active boost causes `Product.sponsored = true` to be returned at feed slots. Feed
service should reserve ~2 sponsored slots per 12-item page (positions [2, 7] in the
prototype).

### Conversations — message types

The `messages.type` enum needs two additions beyond what CLAUDE.md §7 lists:

```sql
type ENUM('text', 'payment_request', 'system', 'offer', 'image')
```

**`offer`** — buyer-initiated price offer.

- Payload columns or JSON: `amount NUMERIC, status ENUM('pending', 'accepted', 'declined'), note TEXT NULL`
- Seller can accept/decline → triggers `messages` mutation (status change) AND sends a
  follow-up system message.

**`image`** — image attached to a message.

- Payload: `url TEXT` (Cloudinary URL via §3), `caption TEXT NULL`

Endpoint additions:

```
POST   /conversations/:id/offer                    { amount, note? }
PATCH  /conversations/:id/offer/:messageId         { status: "accepted" | "declined" }
POST   /conversations/:id/image                    multipart { image: File, caption? }
```

### Wishlist (Saved)

Not in CLAUDE.md §7. The frontend currently uses localStorage via Zustand persist
([`src/store/wishlistStore.ts`](src/store/wishlistStore.ts)). For cross-device sync,
add:

```sql
wishlist_items (
  user_id    UUID REFERENCES users(id),
  product_id UUID REFERENCES products(id),
  created_at TIMESTAMP,
  PRIMARY KEY (user_id, product_id)
)
```

```
GET    /wishlist
POST   /wishlist           { productId }
DELETE /wishlist/:productId
```

Frontend can keep the local store as a write-through cache; reconcile on login.

### Stories

Per-shop, vertical-photo strip on shop pages. Currently mocked at
[`src/lib/mocks/stories.ts`](src/lib/mocks/stories.ts).

```sql
stories (
  id          UUID PRIMARY KEY,
  shop_id     UUID REFERENCES shops(id),
  media_url   TEXT (Cloudinary URL),
  duration_ms INT DEFAULT 5000,
  expires_at  TIMESTAMP,
  created_at  TIMESTAMP
)
```

```
GET  /shops/:id/stories       active (non-expired) stories for a shop
POST /shops/me/stories        multipart { image: File, duration_ms? }
```

Auto-expire 24h after creation. Cron job or query-time filter.

### Locations / search filtering

`Shop.location` is now used by the feed location chip. Backend should:

- Add `location VARCHAR` to `shops` table (free-text city, validated against allowlist
  `LOCATIONS` in [`src/lib/services/products.ts`](src/lib/services/products.ts))
- Accept `?location=Lagos` on `GET /feed` and `GET /search`

`GET /search` should accept both `?q=` and `?category=` (current frontend treats
category as a free-text query that matches against product category names).

### Reviews — new

Schema:

```sql
reviews (
  id              UUID PRIMARY KEY,
  product_id      UUID REFERENCES products(id),
  shop_id         UUID REFERENCES shops(id),
  transaction_id  UUID REFERENCES transactions(id) UNIQUE,
  author_id       UUID REFERENCES users(id),
  rating          INT CHECK (rating BETWEEN 1 AND 5),
  body            TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
)
```

- `UNIQUE(transaction_id)` enforces one review per completed sale.
- Only buyers in `transactions.buyer_id` can `POST` for that `transaction_id`.
- Frontend type is `Review` in [`src/types/index.ts`](src/types/index.ts).

Endpoints:

```
GET    /products/:id/reviews                  list reviews for a product
       → { reviews: Review[], average: number, count: number }
POST   /reviews                               buyer leaves a review
       body: { transactionId, productId, shopId, rating, body? }
       Constraints: transaction.status === 'released', author === buyer.
GET    /shops/:id/rating                      aggregate score for a shop
```

### Referrals — new

Schema:

```sql
referrals (
  id              UUID PRIMARY KEY,
  referrer_id     UUID REFERENCES users(id),
  invitee_id      UUID REFERENCES users(id),  -- nullable until claimed
  code            VARCHAR UNIQUE,             -- short slug, e.g. "chidera"
  status          ENUM('pending', 'completed', 'expired'),
  reward_naira    INT,                        -- 500 by default
  created_at      TIMESTAMP,
  completed_at    TIMESTAMP
)
```

- Codes are derived from the referrer's handle (lowercase, alphanumeric, dot,
  dash) and must be unique across users.
- Status flips to `completed` when the invitee completes their first
  transaction. Reward credited at that moment.

Endpoints:

```
GET    /referrals/me                  my code, link, count, total earned
POST   /referrals/claim               { code }  invitee on signup
GET    /r/:code                       public redirect → /signup?ref={code}
```

### Stories — already in §2 above, finalized

Frontend `createStory` action sends `{ mediaUrl, caption?, productId? }`. The
real flow is `POST /shops/me/stories` multipart-form with `image: File`,
backend uploads to Cloudinary, and returns the persisted `Story`.

### Shop display name privacy

`shops.show_legal_name BOOLEAN DEFAULT FALSE` — if true, the user's legal name
on `users.name` is rendered alongside the shop name on the storefront and
chat. Default off; most sellers stay pseudonymous.

### Browse-before-signup gating

The Hero CTA now sends visitors to `/feed` without requiring signup. The
middleware should:

- Allow read-only access to `/feed`, `/discover`, `/search`, `/shops/:id`,
  `/products/:id`, `/legal/*`, `/help/*`, `/r/*`.
- Gate any write action (chat, save to wishlist persisted server-side, pay,
  raise dispute) — return 401 → frontend redirects to `/signup`.

---

## 3. Image upload contract

**CLAUDE.md §5 originally specified browser-direct Cloudinary upload.** This has been
revised: per seller feedback, files now route through the backend so we can run
moderation/virus-scan/format conversion before storing the URL.

### Product images

Frontend sends one of two shapes, depending on whether the seller picked files vs.
pasted URLs:

```http
POST /products
Content-Type: multipart/form-data

name=...
price=...
category=...
description=...
image_files[]=<File>     (zero or more)
image_urls[]=<string>    (zero or more)
cover_index=0            (which entry in the combined ordered list is the cover)
```

Backend responsibilities:

1. Upload each `image_files[]` entry to Cloudinary.
2. For `image_urls[]` entries that are already Cloudinary URLs, keep as-is. For others,
   download → re-upload to Cloudinary (avoid hot-linking external hosts).
3. Store the final ordered list. Index `cover_index` becomes `product.media` (cover);
   the rest become `product.gallery`.

### Discover ad videos

```http
POST /discover/posts
Content-Type: multipart/form-data

video=<File>             (required — vertical .mp4)
poster=<File>            (optional — auto-generated from video if absent)
caption=...
cta_type=product|shop
cta_id=...
```

Cloudinary supports video. Generate a poster frame server-side if seller didn't upload one.

### Chat image messages

Same pattern as product images, single file.

```http
POST /conversations/:id/image
Content-Type: multipart/form-data

image=<File>
caption=...
```

### Stories

```http
POST /shops/me/stories
Content-Type: multipart/form-data

image=<File>
duration_ms=5000
```

---

## 4. Server actions (frontend → backend)

These are Next.js Server Actions in [`src/lib/actions/`](src/lib/actions). Each one needs
its body replaced with an Axios call once the backend is up. Signatures are stable.

| File                       | Action                                                              | Replaces with                              |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| `actions/conversations.ts` | `startConversation({ productId?, shopId? })`                        | `POST /conversations`                      |
| `actions/boosts.ts`        | `buyBoost({ productId, planId })`                                   | `POST /boosts` (Paystack init)             |
| `actions/discover.ts`      | `createDiscoverCampaign({ postId, planId })`                        | `POST /discover/campaigns` (Paystack init) |
| `actions/stories.ts`       | `createStory({ mediaUrl, caption?, productId? })`                   | `POST /shops/me/stories` (multipart)       |
| `actions/reviews.ts`       | `submitReview({ transactionId, productId, shopId, rating, body? })` | `POST /reviews`                            |

---

## 5. Socket.io events

Additions beyond CLAUDE.md §9:

```
offer:new              buyer sent an offer (broadcast to seller)
offer:resolved         seller accepted/declined (broadcast to buyer)
discover:metric        { postId, impressions, clicks } — optional live counter pulse
                       on seller's /seller/ads/[id] page
boost:metric           same shape as discover:metric for product feed boosts
```

---

## 6. Paystack flow (refresher)

CLAUDE.md §5 + §21 cover the rule (never call Paystack from frontend). Concrete contract:

1. Frontend calls a server action (e.g. `buyBoost`, `createDiscoverCampaign`, or `/pay`
   on a payment_request message) with the relevant IDs.
2. Backend creates a Paystack transaction with metadata (`productId`, `boostPlan`, etc.)
   and returns `{ authorization_url, reference }`.
3. Frontend redirects to `authorization_url`.
4. Paystack webhook hits `POST /webhooks/paystack` → backend resolves the transaction:
   - For escrow: insert `transactions` row with `status='held'`.
   - For boost/Discover: insert `boosts` or `discover_campaigns` row.
5. Backend emits the corresponding Socket.io event (`transaction:paid`, `boost:metric`
   start, etc.) and sends Resend email.
6. User returns to `/return-url?reference=...`. Frontend polls or socket-listens for the
   confirmation, then routes them onward.

Test mode keys in dev `.env`. Use Paystack's webhook tester to simulate.

---

## 7. Type definitions

All shapes the frontend expects are exported from
[`src/types/index.ts`](src/types/index.ts). Notable ones:

- `Product`, `Shop`, `Conversation`, `Message` (discriminated union by `type`),
  `Transaction`, `Notification` — match the schemas in CLAUDE.md §7 plus the additions
  noted above.
- `DiscoverPost`, `DiscoverAdCampaign`, `DailyAdStat`, `DiscoverFeedItem` — for Discover.
- `Boost`, `BoostPlan`, `BoostPlanId` — for monetization.
- `OfferMessage`, `ImageMessage`, `OfferStatus` — message subtypes.
- `Story` — for shop stories.

If you change a column name on the backend, change the corresponding type and the
frontend updates automatically (TypeScript will flag every read site).

---

## 8. Build progress on the frontend

See CLAUDE.md §11b — that section is kept in sync with what's been shipped in the
prototype.

---

## 9. Backend code organization

The frontend caps components at 150 lines per file (CLAUDE.md §14.1) and collocates
domain code under `_components/`. The backend should follow the same principle —
**one responsibility per file, target ≤ 200 lines** — with a layered structure:

```
backend/
├── src/
│   ├── server.ts                 boot the Express app + Socket.io adapter
│   ├── app.ts                    middleware + route mounting
│   ├── config/
│   │   ├── env.ts                Zod-validated env loader
│   │   └── db.ts                 Prisma/Drizzle client
│   ├── middleware/
│   │   ├── auth.ts               requireAuth, requireRole
│   │   ├── error.ts               central error handler (the response shape in §2)
│   │   └── rateLimit.ts
│   ├── modules/                  one folder per domain
│   │   ├── auth/
│   │   │   ├── auth.routes.ts    Express router — thin, calls controller
│   │   │   ├── auth.controller.ts  req → service → res (≤ 150 lines)
│   │   │   ├── auth.service.ts     business logic (≤ 200 lines)
│   │   │   ├── auth.repo.ts        DB queries only
│   │   │   ├── auth.schemas.ts     Zod validators for each route
│   │   │   └── oauth/
│   │   │       ├── google.ts
│   │   │       └── apple.ts
│   │   ├── products/             same shape
│   │   ├── conversations/
│   │   ├── transactions/
│   │   ├── discover/
│   │   ├── boosts/
│   │   ├── stories/
│   │   ├── reviews/
│   │   ├── wishlist/
│   │   ├── referrals/
│   │   ├── disputes/
│   │   └── notifications/
│   ├── realtime/
│   │   ├── socket.ts             Socket.io setup + auth handshake
│   │   └── handlers/             one file per event (message:new, offer:new, …)
│   ├── integrations/             external services — wrap to keep modules clean
│   │   ├── paystack.ts
│   │   ├── cloudinary.ts
│   │   ├── resend.ts
│   │   └── redis.ts
│   ├── jobs/                     cron / queue workers
│   │   ├── escrowAutoRelease.ts  7-day auto-release after delivery
│   │   └── storyExpiry.ts        24h story cleanup
│   └── types/                    shared with frontend
│       └── index.ts              copy from frontend/src/types/index.ts
├── prisma/                       (or drizzle/)
│   ├── schema.prisma
│   └── migrations/
└── tests/
    ├── auth.test.ts
    └── ...
```

**The layering principles, mapped to the frontend rule:**

| Frontend                           | Backend equivalent                  | Cap                            |
| ---------------------------------- | ----------------------------------- | ------------------------------ |
| Page component (≤ 150 lines)       | Route file (Express router)         | ≤ 80 lines — thin              |
| `_components/` UI piece            | Controller — request/response shape | ≤ 150 lines                    |
| `lib/services/*.ts` (data fetcher) | Service — business logic            | ≤ 200 lines, split when bigger |
| `lib/actions/*.ts` (mutation)      | Service method                      | (same as service)              |
| Mocks                              | Repository — DB access only         | ≤ 150 lines                    |
| `types/index.ts`                   | Same shapes mirrored                | (copy or share)                |

**When a service grows past 200 lines, split by sub-domain.** Example:
`conversations.service.ts` → `conversations/messages.service.ts` +
`conversations/payments.service.ts` + `conversations/offers.service.ts`. Same idea as
splitting `ProductGridCard` into `ProductCardActions` when it got too tall.

**Controllers stay dumb.** They validate input via Zod, call one service method, shape
the response, return. Anything that smells like business logic belongs in the service.

**Repositories own the DB.** Services call `repo.findById(...)`, never raw SQL or Prisma
queries inline. This is the seam that lets you swap Prisma → Drizzle later if needed.

**Each module owns its types.** If a controller needs a shape that doesn't belong in
the shared `types/`, declare it in `module/foo.types.ts` — keep cross-module imports of
internal types rare.

**Tests live next to the module** (`auth.service.test.ts`) or in `tests/` — team
preference. Don't skip tests for the auth and transactions modules.

---

## 10. Dev-setup checklist for the backend dev

When you start, before writing code:

1. Create accounts: Neon (Postgres), Upstash (Redis), Cloudinary (image/video), Paystack
   (test mode first), Resend (transactional email), Google Cloud Console (OAuth client),
   Apple Developer (OAuth — optional Phase 1, can ship Google first).
2. Copy `.env.example` (will be created in backend repo) and fill in all keys from above.
3. Initialize Prisma against Neon, run `prisma migrate dev` after committing the schema
   from CLAUDE.md §7.
4. Set `CLIENT_URL=http://localhost:3000` in dev for CORS.
5. Pick one module to ship end-to-end first as a vertical slice — recommend **Auth +
   Products read** so frontend can flip `getFeed` / `getProduct` to real APIs immediately
   and validate the integration pattern. After that, the rest are mechanical.

The frontend integration is a single file edit per service. See §1 — keep the function
signatures, swap the body for an Axios call. The frontend types are the contract.
