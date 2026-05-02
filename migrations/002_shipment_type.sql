-- ==========================================================================
-- OPS: Add shipment_type field (FCL / LCL / Console)
-- ==========================================================================

ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS shipment_type text DEFAULT 'FCL';

COMMENT ON COLUMN public.shipments.shipment_type IS 'FCL=整箱, LCL=拼箱, Console=自拼柜';
