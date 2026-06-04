-- Track upload intent on every Discover post so the free-cap check is
-- accurate even before a Paystack webhook lands. Existing rows are
-- treated as free (default TRUE) which matches the historical behavior
-- where every upload was uncapped.

ALTER TABLE "discover_posts"
  ADD COLUMN "intent_free" BOOLEAN NOT NULL DEFAULT TRUE;
