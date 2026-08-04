-- P2: 邀请二维码发行记录表（多渠道归因 / 单张撤销 / 扫码统计）

CREATE TABLE "store_invite_qr_issues" (
  "id"               SERIAL       PRIMARY KEY,
  "store_id"         INT          NOT NULL,
  "invite_code_id"   INT          NOT NULL,
  "channel"          VARCHAR(24)  NOT NULL,          -- poster / tablecard / staff / other
  "name"             VARCHAR(64),
  "public_token"     VARCHAR(64)  NOT NULL UNIQUE,   -- 不可猜测 token（UUID）
  "protocol_version" VARCHAR(8)   NOT NULL DEFAULT 'v1',
  "status"           VARCHAR(16)  NOT NULL DEFAULT 'active', -- active / revoked
  "scan_count"       INT          NOT NULL DEFAULT 0,
  "joined_count"     INT          NOT NULL DEFAULT 0,
  "issued_at"        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at"       TIMESTAMPTZ,
  "created_by"       INT,
  "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_invite_qr_issues_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE,
  CONSTRAINT "store_invite_qr_issues_invite_code_id_fkey" FOREIGN KEY ("invite_code_id")
    REFERENCES "store_invite_codes"("id") ON DELETE CASCADE
);

CREATE INDEX "store_invite_qr_issues_store_id_status_idx" ON "store_invite_qr_issues"("store_id", "status");
CREATE INDEX "store_invite_qr_issues_store_id_channel_created_at_idx" ON "store_invite_qr_issues"("store_id", "channel", "created_at");
CREATE INDEX "store_invite_qr_issues_invite_code_id_idx" ON "store_invite_qr_issues"("invite_code_id");
