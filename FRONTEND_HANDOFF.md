# Ahia Backend — Frontend Integration Guide

Everything the frontend needs to talk to the backend. Authoritative as of **2026-05-27**.

Pair this with [`claude.md`](claude.md) (the original planning doc) — this file documents
what's **actually built and shipped**, plus the integration contract.

---

## 0. TL;DR

- **Base URL (dev):** `http://localhost:4000`
- **Base URL (prod):** TBD — set in your `.env` as `NEXT_PUBLIC_API_URL`
- **Auth:** `session` cookie (httpOnly, sameSite=lax). Always send `withCredentials: true` on Axios / `credentials: "include"` on fetch.
- **Content types:** JSON for most writes, **multipart/form-data** for any endpoint that accepts a file.
- **Error response shape:** `{ error: { code, message, fields? } }` — always.
- **Realtime:** Socket.io at the same origin, cookie-authenticated. See §9.
- **Money:** all amounts are in **naira** in the API; Paystack uses kobo internally (backend handles conversion).
- **Decimals:** Prisma returns `Decimal` fields as **strings** (e.g., `"5000.00"`). Coerce with `Number(value)` if you need math.
- **Pagination:** cursor-based. Send `?cursor=...&limit=...`; response includes `nextCursor` (string or null).
- **IDs:** all UUIDs.

---

## 1. Setup

### Axios client

```ts
import axios from "axios";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  withCredentials: true, // <-- REQUIRED so the session cookie is sent
});
```

### Backend CORS expects

- `CLIENT_URL` env var on the backend matches the frontend's origin exactly.
- In dev: backend has `CLIENT_URL=http://localhost:3000`; frontend runs on port 3000.
- Backend sends `Access-Control-Allow-Credentials: true` and the origin echoed.

If you ever see a CORS error, the most common cause is `withCredentials` missing or the
backend's `CLIENT_URL` not matching the actual origin.

---

## 2. Auth

### Email + password

```ts
// Signup — sets the session cookie, returns the new user
POST /auth/signup
Content-Type: application/json
{ "name": "Test User", "email": "test@example.com", "password": "min8chars" }
→ 201 { "user": { id, name, email, role, avatarUrl, createdAt, ... } }
```

```ts
// Login — same shape as signup
POST /auth/login
{ "email": "test@example.com", "password": "min8chars" }
→ 200 { "user": {...} }
```

```ts
// Logout — clears the cookie
POST /auth/logout
→ 204
```

```ts
// Current session
GET /auth/me
→ 200 { "user": {...} }
→ 401 { error: { code: "UNAUTHORIZED", ... } }   when not logged in or expired
```

**Auth error codes you'll see:**
- `EMAIL_TAKEN` (409) — signup with an existing email
- `INVALID_CREDENTIALS` (401) — wrong email/password on login
- `VALIDATION_FAILED` (400) — body shape wrong; `error.fields` has per-field messages

### Google OAuth

This is a **redirect-based flow**, not an AJAX call.

1. Frontend's "Sign in with Google" button just navigates to:
   ```
   http://localhost:4000/auth/google/start?next=/feed
   ```
   The `next` query is where the user lands after success (relative path; defaults to `/feed`). Must start with `/`; protocol-relative URLs (`//evil.com`) and full URLs are rejected.

2. Backend redirects to Google's consent screen. User picks an account.

3. Google redirects back to `/auth/google/callback`. Backend exchanges the code, finds-or-creates the user, sets the `session` cookie, and 302-redirects the browser to:
   - `${CLIENT_URL}/onboarding` if **first sign-in** (new account created)
   - `${CLIENT_URL}${next}` if returning (or `/feed` if no `next`)

4. The frontend never sees the OAuth code/token. By the time the user lands, the cookie is set; just call `GET /auth/me` to get the user.

**Email-conflict policy:** if a user previously signed up with email/password and later does Google OAuth with the same email, the accounts are auto-linked (Google has verified the email). No 409.

### Apple OAuth

**Not implemented in v1.** Routes exist as stubs but return `501 NOT_IMPLEMENTED`. Deferred to v2.

### Forgot password

**Not implemented in v1.** Pending Resend setup. Workaround for dev: nudge users with email/password issues to use Google OAuth.

---

## 3. Standard error response

Every error from the backend follows this shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Invalid request",
    "fields": { "email": "Already registered" }
  }
}
```

| HTTP | Common codes |
|---|---|
| 400 | `VALIDATION_FAILED`, `BAD_REQUEST` |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `INVALID_SIGNATURE` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `HANDLE_TAKEN`, `SHOP_EXISTS`, `DISPUTE_EXISTS`, `REVIEW_EXISTS` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |
| 501 | `NOT_IMPLEMENTED` |

`fields` is set for form errors (validation, conflicts) — keys are the form field names; values are user-displayable messages.

---

## 4. Public endpoints (no login required)

The backend allows full read access without auth for these paths. The frontend can render product/shop pages, the feed, discover, etc., to logged-out visitors. Only **writes** require login.

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ ok: true }` |
| GET | `/products?cursor=&limit=&category=&location=&q=` | `{ items: Product[], nextCursor }` |
| GET | `/products/:id` | `{ product: Product }` |
| GET | `/products/:id/reviews` | `{ reviews: Review[], average: number, count: number }` |
| GET | `/shops/:id` | `{ shop: Shop }` |
| GET | `/shops/:id/products?cursor=&limit=` | `{ items: Product[], nextCursor }` |
| GET | `/shops/:id/rating` | `{ average: number, count: number }` |
| GET | `/shops/:id/stories` | `{ items: Story[] }` — only non-expired |
| GET | `/discover?cursor=&limit=` | `{ items: DiscoverFeedItem[], nextCursor }` |
| POST | `/discover/posts/:id/impression` | 204 — fire-and-forget |
| POST | `/discover/posts/:id/click` | 204 |
| GET | `/boosts/plans` | `{ plans: BoostPlanDef[] }` |
| GET | `/r/:code` | 302 → `/signup?ref=<code>` |

The `DiscoverFeedItem` is a `DiscoverPost` with an extra `sponsored: boolean` flag — `true` for posts at the paid slot positions [2, 6, 10] of each page.

---

## 5. Auth-required endpoints (by domain)

### Shops

| Method | Path | Body / files | Notes |
|---|---|---|---|
| POST | `/shops/me` | multipart: `name`, `handle`, `bio?`, `location?`, `showLegalName?`, `avatar?` (file), `banner?` (file) | One shop per user. 409 `SHOP_EXISTS` if you already have one. 409 `HANDLE_TAKEN` for duplicate handle. |
| GET | `/shops/me` | — | 404 if you haven't created a shop yet |
| PATCH | `/shops/me` | same as POST, all fields optional | Re-uploading avatar/banner overwrites the previous Cloudinary asset (stable `publicId`). |

Handles must match `^[a-z0-9][a-z0-9._-]{1,30}$` (lowercase letters/numbers, dot/dash/underscore, 2–31 chars).

### Products

| Method | Path | Body / files | Notes |
|---|---|---|---|
| POST | `/products` | multipart: `name`, `description`, `price`, `category`, `image_files[]?` (files), `image_urls[]?` (strings), `cover_index?` (default 0) | Caller must own a shop. At least one image required (file OR URL). |
| PATCH | `/products/:id` | same shape, all optional | If you send any new images, they **replace** the entire image set. If you send none, existing images stay. |
| DELETE | `/products/:id` | — | Soft delete (`deletedAt` set). The row stays in the DB so transactions/reviews keep working. |
| PATCH | `/products/:id/visibility` | `{ hidden: true \| false }` | Hidden ≠ deleted. Excludes from feed/search/storefront but keeps it accessible from inbox/transactions. |

**Product image flow:** `image_files[]` go up to Cloudinary as new uploads; `image_urls[]` are re-uploaded into Cloudinary unless they're already on our cloud (in which case kept as-is). The combined ordered list becomes the product's images, and the entry at `cover_index` becomes the cover; the rest become the gallery.

### Conversations & messages

| Method | Path | Body / files | Notes |
|---|---|---|---|
| POST | `/conversations` | `{ productId? \| shopId? }` | Idempotent — re-calling with the same product/shop+buyer/seller pair returns the existing thread. |
| GET | `/conversations` | — | `{ items: Conversation[] }` — sorted by latest activity, with participants + latest message included |
| GET | `/conversations/:id` | — | `{ conversation }` |
| GET | `/conversations/:id/messages?cursor=&limit=` | — | newest-first |
| POST | `/conversations/:id/messages` | `{ body: string }` | text message |
| POST | `/conversations/:id/image` | multipart `image` + `caption?` | image message |
| POST | `/conversations/:id/offer` | `{ amount: number, note?: string }` | buyer-only |
| PATCH | `/conversations/:id/offer/:messageId` | `{ status: "accepted" \| "declined" }` | seller-only; auto-emits a `system` message |

**Message types** discriminated by `type`:
- `text` — has `body`
- `image` — has `imageUrl`, `imageCaption`
- `offer` — has `offerAmount`, `offerStatus`, `offerNote`
- `system` — has `body`, `senderId: null`
- `payment_request` — reserved for future use

### Transactions (escrow)

The frontend's job is to call `POST /transactions`, redirect the user to Paystack, then poll for the result. See §7 for the full flow.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/transactions` | `{ productId, callbackUrl? }` | Returns `{ authorization_url, reference }`. **No transaction row exists yet** — the webhook creates it. |
| GET | `/transactions/me` | — | My purchases (as buyer) |
| GET | `/transactions/sales` | — | My sales (derived via shop ownership) |
| GET | `/transactions/:id` | — | Single, buyer or seller |
| GET | `/transactions/by-reference/:reference` | — | Poll this on the post-Paystack return URL until 200 |
| PATCH | `/transactions/:id/delivered` | — | Mark delivered (buyer OR seller). Starts the 7-day auto-release timer. |
| PATCH | `/transactions/:id/release` | — | Buyer manually releases early. |

**Transaction status state machine:**
- `held` (default after payment) → `released` (delivered + 7 days OR buyer clicks release) → end state
- `held` → `disputed` (someone opens a dispute) → `resolved_buyer` (refunded) / `resolved_seller` (released) / back to `held` if cancelled
- `refunded` and `cancelled` are end states

### Disputes

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/disputes` | `{ transactionId, reason }` | Either party can open. Transaction must be `held`. One dispute per transaction. |
| GET | `/disputes/me` | — | All disputes where I'm buyer or shop owner |
| GET | `/disputes/:id` | — | Single |
| PATCH | `/disputes/:id/resolve` | `{ resolution, note? }` | **Admin only.** Resolution: `resolved_buyer` (refund) / `resolved_seller` (release) / `cancelled` (revert to held). |

Admin role isn't exposed by signup; toggle it via Prisma Studio in dev. The frontend doesn't need an admin UI for v1.

### Wishlist

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/wishlist` | — | `{ items: WishlistItem[] }` — products included |
| POST | `/wishlist` | `{ productId }` | Idempotent (upsert). 404 if product doesn't exist or is soft-deleted. |
| DELETE | `/wishlist/:productId` | — | 204 |

Frontend can keep the local `wishlistStore` (zustand persist) as a write-through cache and reconcile on login.

### Reviews

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/reviews` | `{ transactionId, productId, shopId, rating (1-5), body? }` | **Constraints:** the calling user must be the transaction's buyer, transaction status must be `released`, productId must match the transaction's product, and there must be no existing review for that transaction. |

`GET /products/:id/reviews` and `GET /shops/:id/rating` are public (see §4).

### Notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?cursor=&limit=&unreadOnly=` | `{ items, nextCursor, unreadCount }` |
| PATCH | `/notifications/:id/read` | 204 |
| POST | `/notifications/read-all` | 204 |

**Notification types** the backend emits today (the `type` field on each row):

| Type | Trigger | Audience |
|---|---|---|
| `payment_paid` | escrow funded | buyer |
| `payment_received` | escrow funded | seller |
| `payment_released` | escrow released | buyer + seller |
| `dispute_opened` | dispute created | both parties |
| `dispute_resolved` | admin resolves dispute | both parties |
| `boost_purchased` | product boost paid | seller |
| `discover_campaign_started` | Discover campaign paid | seller |
| `referral_completed` | referee makes their first purchase | referrer |

`payload` is JSON; expected keys are documented in the service code. Frontend renders type-specific strings.

### Boosts

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/boosts/plans` | — | Public. `{ plans: [{ id, label, months, priceNaira }] }` |
| POST | `/boosts` | `{ productId, plan, callbackUrl? }` | Paystack flow. Must own the product's shop. |
| GET | `/boosts/me` | — | My active and historical boosts |

`plan` is one of `"monthly"` / `"quarterly"` / `"biannual"`. Same IDs as Discover campaigns. Pricing: ₦5,000 / ₦12,000 / ₦20,000.

### Discover

| Method | Path | Body / files | Notes |
|---|---|---|---|
| GET | `/discover?cursor=&limit=` | — | Public feed; paid posts spliced at [2, 6, 10] |
| POST | `/discover/posts` | multipart: `video` (required), `poster?`, `caption?`, `ctaType` (`product`/`shop`), `ctaTargetId` | Must have a shop. Poster auto-generated from video first frame if not provided. 50 MB max. |
| POST | `/discover/posts/:id/impression` | — | Public, fire-and-forget |
| POST | `/discover/posts/:id/click` | — | Public, fire-and-forget |
| POST | `/discover/posts/:id/save` | — | Auth required; if CTA is a product, adds to wishlist. Bumps save counter. |
| POST | `/discover/campaigns` | `{ postId, plan, callbackUrl? }` | Paystack flow, same plans as boosts |
| GET | `/discover/campaigns/me` | — | My campaigns |
| GET | `/discover/campaigns/:id/analytics` | — | `{ campaign, post, daily: [{ date, impressions, clicks, spend }] }` — date is `YYYY-MM-DD` |

### Stories

| Method | Path | Body / files | Notes |
|---|---|---|---|
| GET | `/shops/:id/stories` | — | Public, only non-expired (24h) |
| POST | `/shops/me/stories` | multipart: `image`, `durationMs?` (1000–15000, default 5000) | Shop owner only |

### Referrals

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/referrals/me` | — | `{ code, link, completedCount, pendingCount, totalEarnedNaira }`. `code` is your shop handle (lowercased), or `null` if you haven't created a shop yet. |
| POST | `/referrals/claim` | `{ code }` | Call this on signup when `?ref=` is present in the URL. Idempotent. 400 if `code === yourOwnHandle`. |
| GET | `/r/:code` | — | Public 302 redirect to `${CLIENT_URL}/signup?ref=<code>`. Use as your shareable link. |

**How completion works:** when the invitee successfully completes their first Paystack escrow purchase, the backend flips their pending referral(s) to `completed` and notifies the referrer with `referral_completed`. Rewards are tracked via `rewardNaira` (default ₦500) but the actual payout mechanism (wallet credit, etc.) is out of v1 scope — for now the frontend can render "₦X earned" from the count × rewardNaira.

---

## 6. File uploads

All upload endpoints use `multipart/form-data`. Backend caps:
- Images: **5 MB** per file
- Videos (Discover only): **50 MB** per file

Files are streamed to Cloudinary by the backend; the URL is stored in Postgres. The frontend never talks to Cloudinary directly.

**Example: upload a product with two images**

```ts
const form = new FormData();
form.append("name", "Ankara Dress");
form.append("description", "Hand-stitched, size M");
form.append("price", "15000");
form.append("category", "Fashion");
form.append("cover_index", "0");
form.append("image_files", file1);
form.append("image_files", file2);

await api.post("/products", form);  // Axios infers Content-Type
```

**Example: upload a Discover video**

```ts
const form = new FormData();
form.append("video", videoFile);
// optional: form.append("poster", customPosterImage);
form.append("ctaType", "product");
form.append("ctaTargetId", productId);
form.append("caption", "Check this out!");

await api.post("/discover/posts", form);
```

Backend returns the persisted entity with Cloudinary URLs in the response. Use those URLs directly in `<img>` / `<video>` tags.

---

## 7. Paystack flow

Three-step dance on the frontend. **Never** call Paystack APIs directly — all secrets stay on the backend.

### Step 1: Initiate

```ts
const { data } = await api.post("/transactions", {
  productId,
  callbackUrl: `${window.location.origin}/checkout/return`, // optional
});
// data: { authorization_url: string, reference: string }
```

Same shape for `POST /boosts` and `POST /discover/campaigns`.

### Step 2: Redirect

```ts
window.location.href = data.authorization_url;
```

Paystack hosts the card-entry page. Test cards (test mode):
- `4084 0840 8408 4081`, CVV `408`, exp `12/30`, PIN `1234`, OTP `123456`

### Step 3: Return + poll

Paystack redirects the user back to your `callbackUrl` with `?reference=<the-reference>`. The webhook may land **before or after** the user returns — typically within a second or two. Poll until you see the transaction:

```ts
async function pollForTransaction(reference: string) {
  for (let i = 0; i < 10; i++) {
    try {
      const { data } = await api.get(`/transactions/by-reference/${reference}`);
      return data.transaction; // success
    } catch (err) {
      if (err.response?.status === 404) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Payment confirmation timeout — check transactions list");
}
```

Same pattern for boosts/discover (poll by listing). After confirmation:
- Buyer's socket emits `transaction:paid` (live update)
- Notifications appear in their notification list

---

## 8. Socket.io

Connect once after login. The handshake reads the `session` cookie automatically.

```ts
import { io } from "socket.io-client";

const socket = io(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000", {
  withCredentials: true,
});

socket.on("connect", () => console.log("connected", socket.id));
socket.on("disconnect", (reason) => console.log("disconnected", reason));

socket.on("message:new", ({ conversationId, message }) => { /* ... */ });
socket.on("offer:new", ({ conversationId, message }) => { /* ... */ });
socket.on("offer:resolved", ({ conversationId, messageId, status, offer }) => { /* ... */ });

socket.on("transaction:paid", ({ transaction }) => { /* ... */ });
socket.on("transaction:delivered", ({ transaction }) => { /* ... */ });
socket.on("transaction:released", ({ transaction }) => { /* ... */ });

socket.on("dispute:opened", ({ dispute }) => { /* ... */ });
socket.on("dispute:resolved", ({ dispute }) => { /* ... */ });

socket.on("notification:new", ({ notification }) => { /* badge bump */ });
socket.on("boost:purchased", ({ boost }) => { /* ... */ });
socket.on("discover:campaign_started", ({ campaign }) => { /* ... */ });
```

**Events you'll never need to *emit* from the frontend.** All messages/offers/etc. go through REST; the backend pushes the corresponding socket event. This keeps REST as the source of truth and avoids dual-write bugs.

**Reconnection:** Socket.io reconnects automatically. If the session cookie expires mid-session, the next reconnect will fail with `UNAUTHORIZED` — re-login and reconnect.

---

## 9. Important behavioral details

### Decimal serialization

`Product.price`, `Transaction.amount`, `Boost.spend`, `Campaign.spend` are stored as Postgres `Decimal(12,2)` and serialize as **strings** in JSON (`"15000.00"`, not `15000`). Always coerce with `Number(price)` before arithmetic or formatting.

### Date strings

All timestamps come back as ISO 8601 strings (e.g., `"2026-05-27T22:15:42.000Z"`). The Discover analytics `date` field is a date-only string (`"2026-05-27"`).

### Soft deletes

Deleting a product (`DELETE /products/:id`) sets `deletedAt`; the row stays. Public read endpoints filter out soft-deleted products automatically. If you query a `Transaction` whose product was later deleted, the embedded product object still resolves.

### Image URL re-uploads

If you submit an `image_urls[]` entry that points to an external host (not our Cloudinary cloud), the backend downloads and re-uploads to Cloudinary. The response will contain the **new** Cloudinary URL — don't trust that the URL you sent is preserved.

### Hidden vs deleted products

- Hidden: still accessible by URL, still appears in inbox/transactions, but excluded from feed/search/storefront
- Deleted: soft-deleted; treated as gone everywhere except historical records (transactions, disputes)

### Rate limiting

General routes: 120 req/min/IP. Auth (`/auth/login`, `/auth/signup`): 10 req/min/IP. Webhooks are NOT rate-limited. Exceeding either → `429 RATE_LIMITED`.

### Browse-before-signup

All read paths in §4 work without auth. Any write returns `401 UNAUTHORIZED` — that's your cue to route the user to `/signup` with a `next=` back to where they came from.

---

## 10. Type sharing

The frontend's `src/types/index.ts` is the authoritative shape definition. The backend mirrors these shapes. When you change a type:

1. Update `src/types/index.ts` in the frontend
2. Update the corresponding Prisma model in `prisma/schema.prisma` on the backend
3. Backend runs `npx prisma migrate dev`

We're not auto-syncing yet (no shared `@ahia/types` package). Watch out for drift.

---

## 11. Deferred / not ready in v1

| Feature | Status | What this means for the frontend |
|---|---|---|
| **Apple OAuth** | Stub only (`501 NOT_IMPLEMENTED`) | Keep the button but show a "Coming soon" tooltip, or hide entirely for v1 |
| **Forgot password** | Not implemented | No `POST /auth/forgot-password` exists. If the user clicks "Forgot password", show a "Coming soon — contact support" message |
| **Transactional emails (Resend)** | Integration wired, no API key set | The backend will skip sending in dev (logged as a warn). When `RESEND_API_KEY` is set later, emails (`payment_paid`, `payment_released`, `dispute_*`) auto-start sending — no frontend change needed |
| **Admin UI** | No endpoints | Disputes can only be resolved by users with `role: "admin"` in Postgres. Flip via Prisma Studio in dev. No admin frontend in v1 — internal Slack channel for now |
| **Boost reward payout** | Tracked but not paid | `referralsService` flips status to `completed` and increments `totalEarnedNaira`, but there's no actual wallet credit. Frontend can display "₦X earned" as a status |
| **Apple webhook (form-post)** | Not implemented | N/A until Apple OAuth lands |
| **Payment-request message type** | Reserved in schema | `messages.type = 'payment_request'` is in the enum but no endpoint creates it yet. Skip in UI for v1 — buyers init payment via `POST /transactions` directly |
| **Browse-allowlist middleware** | Not needed | Already implemented per-route via `requireAuth`. No global allowlist exists; the per-route approach is cleaner |
| **Multi-instance Socket.io** | Works | Redis adapter is wired and enabled whenever `REDIS_URL` is set. Single-instance dev = no adapter (works fine) |

---

## 12. Common gotchas

1. **Forgetting `withCredentials`** — every Axios/fetch call must include it, or the cookie won't be sent and you'll get 401 on `/auth/me`.
2. **Posting JSON to multipart endpoints** — `POST /products`, `POST /shops/me`, `POST /discover/posts`, etc. expect `multipart/form-data`. Sending JSON returns 400.
3. **Sending `price` as a number to multipart** — `FormData.append("price", 15000)` works in browsers (it stringifies), but the backend Zod schema also accepts strings, so either is fine. Same for `amount`, `rating`, `cover_index`.
4. **OAuth flow needs the browser** — don't call `/auth/google/start` from Axios; let the browser navigate to it. The redirect dance won't work from XHR.
5. **Stale `me` after OAuth callback** — the callback redirects with a cookie set, but if your `useUser` hook was cached, call `GET /auth/me` to refresh.
6. **Pagination cursors are opaque** — they're product/message IDs but treat them as opaque strings. Don't try to interpret or generate them.
7. **Webhook timing on Paystack** — the user lands on your return URL ~1–3s before/after the webhook fires. Always poll `/transactions/by-reference/:ref`; don't trust query params.

---

## 13. Quick reference — every route at a glance

```
PUBLIC (no auth)
  GET   /health
  GET   /products
  GET   /products/:id
  GET   /products/:id/reviews
  GET   /shops/:id
  GET   /shops/:id/products
  GET   /shops/:id/rating
  GET   /shops/:id/stories
  GET   /discover
  POST  /discover/posts/:id/impression
  POST  /discover/posts/:id/click
  GET   /boosts/plans
  GET   /r/:code

AUTH (email/password)
  POST  /auth/signup
  POST  /auth/login
  POST  /auth/logout
  GET   /auth/me
  GET   /auth/google/start
  GET   /auth/google/callback

SHOPS
  POST  /shops/me
  GET   /shops/me
  PATCH /shops/me

PRODUCTS (write)
  POST   /products
  PATCH  /products/:id
  DELETE /products/:id
  PATCH  /products/:id/visibility

CONVERSATIONS
  POST  /conversations
  GET   /conversations
  GET   /conversations/:id
  GET   /conversations/:id/messages
  POST  /conversations/:id/messages
  POST  /conversations/:id/image
  POST  /conversations/:id/offer
  PATCH /conversations/:id/offer/:messageId

TRANSACTIONS
  POST  /transactions
  GET   /transactions/me
  GET   /transactions/sales
  GET   /transactions/:id
  GET   /transactions/by-reference/:reference
  PATCH /transactions/:id/delivered
  PATCH /transactions/:id/release

DISPUTES
  POST  /disputes
  GET   /disputes/me
  GET   /disputes/:id
  PATCH /disputes/:id/resolve   (admin)

WISHLIST
  GET    /wishlist
  POST   /wishlist
  DELETE /wishlist/:productId

REVIEWS
  POST  /reviews

NOTIFICATIONS
  GET   /notifications
  PATCH /notifications/:id/read
  POST  /notifications/read-all

BOOSTS
  POST  /boosts
  GET   /boosts/me

DISCOVER (write)
  POST  /discover/posts
  POST  /discover/posts/:id/save
  POST  /discover/campaigns
  GET   /discover/campaigns/me
  GET   /discover/campaigns/:id/analytics

STORIES
  POST  /shops/me/stories

REFERRALS
  GET   /referrals/me
  POST  /referrals/claim

WEBHOOKS (backend-internal)
  POST  /webhooks/paystack
```

---

## 14. Where to look in the code

If you need to verify backend behavior:

- Endpoint logic: `src/modules/<name>/<name>.service.ts`
- Request/response shapes: `src/modules/<name>/<name>.controller.ts` + `<name>.schemas.ts` (Zod)
- Database queries: `src/modules/<name>/<name>.repo.ts`
- Socket events emitted: search for `broadcastToUser` / `broadcastToOthers` in `src/modules/`
- Notification triggers: search for `notificationsService.createForUser`

For questions: file a GitHub issue or ping the backend channel.
