-- Admin app Phase 1: separate auth boundary + user/shop/dispute additions

-- ============================================================
-- Enums
-- ============================================================

CREATE TYPE "UserStatus"  AS ENUM ('active', 'suspended');
CREATE TYPE "AdminRole"   AS ENUM ('admin', 'super_admin');
CREATE TYPE "AdminStatus" AS ENUM ('active', 'suspended');

-- ============================================================
-- User additions: suspension surface
-- ============================================================

ALTER TABLE "users"
  ADD COLUMN "status"            "UserStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "suspended_at"      TIMESTAMP(3),
  ADD COLUMN "suspended_reason"  TEXT,
  ADD COLUMN "suspended_by_id"   UUID;

-- ============================================================
-- Shop additions: admin suspension distinct from seller's own pause
-- ============================================================

ALTER TABLE "shops"
  ADD COLUMN "admin_suspended_at"     TIMESTAMP(3),
  ADD COLUMN "admin_suspended_reason" TEXT,
  ADD COLUMN "admin_suspended_by_id"  UUID;

-- ============================================================
-- Dispute: admin attribution + evidence array + resolution note
-- ============================================================

ALTER TABLE "disputes"
  ADD COLUMN "resolved_by_admin_id" UUID,
  ADD COLUMN "resolution_note"      TEXT,
  ADD COLUMN "evidence_urls"        TEXT[] NOT NULL DEFAULT '{}';

-- Migrate the singular evidence_url into the new array. NULL singular -> empty array.
UPDATE "disputes"
   SET "evidence_urls" = ARRAY["evidence_url"]
 WHERE "evidence_url" IS NOT NULL;

ALTER TABLE "disputes" DROP COLUMN "evidence_url";

-- ============================================================
-- Admin tables
-- ============================================================

CREATE TABLE "admin_users" (
  "id"                UUID NOT NULL,
  "email"             TEXT NOT NULL,
  "password_hash"     TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "role"              "AdminRole" NOT NULL DEFAULT 'admin',
  "totp_secret"       TEXT,
  "totp_enabled"      BOOLEAN NOT NULL DEFAULT FALSE,
  "status"            "AdminStatus" NOT NULL DEFAULT 'active',
  "suspended_reason"  TEXT,
  "suspended_by_id"   UUID,
  "suspended_at"      TIMESTAMP(3),
  "last_login_at"     TIMESTAMP(3),
  "created_by_id"     UUID,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");
CREATE INDEX "admin_users_email_idx" ON "admin_users"("email");

ALTER TABLE "admin_users"
  ADD CONSTRAINT "admin_users_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "admin_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "admin_users"
  ADD CONSTRAINT "admin_users_suspended_by_id_fkey"
    FOREIGN KEY ("suspended_by_id") REFERENCES "admin_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "admin_backup_codes" (
  "id"         UUID NOT NULL,
  "admin_id"   UUID NOT NULL,
  "code_hash"  TEXT NOT NULL,
  "used_at"    TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_backup_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_backup_codes_admin_id_used_at_idx"
  ON "admin_backup_codes"("admin_id", "used_at");

ALTER TABLE "admin_backup_codes"
  ADD CONSTRAINT "admin_backup_codes_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "admin_sessions" (
  "id"                 UUID NOT NULL,
  "admin_id"           UUID NOT NULL,
  "expires_at"         TIMESTAMP(3) NOT NULL,
  "last_used_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_ip"         TEXT,
  "created_user_agent" TEXT,
  "revoked_at"         TIMESTAMP(3),
  "revoked_by_id"      UUID,
  "revoked_reason"     TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_sessions_admin_id_revoked_at_idx"
  ON "admin_sessions"("admin_id", "revoked_at");

CREATE INDEX "admin_sessions_expires_at_idx"
  ON "admin_sessions"("expires_at");

ALTER TABLE "admin_sessions"
  ADD CONSTRAINT "admin_sessions_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_sessions"
  ADD CONSTRAINT "admin_sessions_revoked_by_id_fkey"
    FOREIGN KEY ("revoked_by_id") REFERENCES "admin_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "admin_actions" (
  "id"          UUID NOT NULL,
  "admin_id"    UUID,
  "action"      TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id"   UUID NOT NULL,
  "reason"      TEXT,
  "metadata"    JSONB,
  "ip_address"  TEXT,
  "user_agent"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_actions_admin_id_created_at_idx"
  ON "admin_actions"("admin_id", "created_at" DESC);

CREATE INDEX "admin_actions_target_type_target_id_created_at_idx"
  ON "admin_actions"("target_type", "target_id", "created_at" DESC);

CREATE INDEX "admin_actions_action_created_at_idx"
  ON "admin_actions"("action", "created_at" DESC);

ALTER TABLE "admin_actions"
  ADD CONSTRAINT "admin_actions_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Dispute → AdminUser FK
-- ============================================================

ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_resolved_by_admin_id_fkey"
    FOREIGN KEY ("resolved_by_admin_id") REFERENCES "admin_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
