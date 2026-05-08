-- 005_charge_templates.sql
-- 客户/供应商费用模板：保存每个客户/供应商常用的一组费用项 + 单价
-- 在录费用时一键套用

CREATE TABLE IF NOT EXISTS charge_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  direction   text        NOT NULL CHECK (direction IN ('AR','AP')),
  notes       text,
  active      boolean     DEFAULT true,
  created_by  uuid        REFERENCES user_profiles(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (partner_id, name, direction)
);

CREATE TABLE IF NOT EXISTS charge_template_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid        NOT NULL REFERENCES charge_templates(id) ON DELETE CASCADE,
  charge_item_id  uuid        NOT NULL REFERENCES charge_items(id),
  unit            text,
  quantity        numeric     DEFAULT 1,
  unit_price      numeric     DEFAULT 0,
  currency        text        DEFAULT 'CNY',
  tax_rate        numeric     DEFAULT 0,
  remark          text,
  sort_order      int         DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charge_template_items_tpl
  ON charge_template_items (template_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_charge_templates_partner
  ON charge_templates (partner_id, direction)
  WHERE active;
