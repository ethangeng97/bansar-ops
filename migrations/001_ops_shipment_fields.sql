-- ==========================================================================
-- OPS Phase 1: Add new fields to shipments table for full order management
-- ==========================================================================

-- Basic info
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS order_no text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS business_type text DEFAULT 'sea_export';
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS cargo_type text DEFAULT 'general';
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS service_types text[];

-- Shipping details
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS destination text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS container_owner text;  -- COC/SOC
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS voyage text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS terminal text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS atd date;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS si_cutoff timestamptz;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS cy_cutoff timestamptz;

-- BL info
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS shipper text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS consignee text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS notify_party text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS mbl_no text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS bl_type text;         -- Original/Telex/SWB
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS freight_terms text;   -- Prepaid/Collect/3rd Party
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS transport_terms text; -- CY-CY/SD-SD etc
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS marks text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS seal_no text;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_shipments_order_no ON public.shipments(order_no);
CREATE INDEX IF NOT EXISTS idx_shipments_business_type ON public.shipments(business_type);
CREATE INDEX IF NOT EXISTS idx_shipments_mbl_no ON public.shipments(mbl_no);
