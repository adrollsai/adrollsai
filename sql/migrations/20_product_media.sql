-- P-media — attach a business's own files to an offering.
--
-- The catalogue (the `properties` table, whatever the industry calls it) describes what a
-- business sells. The `assets` table holds the files. Nothing joined them, so the agent
-- could see a product and could see 200 loose files, and could not tell which belonged to
-- what — which is exactly the context that makes a creative look like the business rather
-- than like a stock photo.
--
-- Additive only: a nullable column and an index. Existing rows are unaffected (product_id
-- stays NULL, meaning "in the library, not on a product"), so the current file manager keeps
-- working unchanged.

alter table public.assets
  add column if not exists product_id uuid;

comment on column public.assets.product_id is
  'The offering this file belongs to. NULL = an unattached library file.';

-- The agent's query: "what media does this product have?"
create index if not exists assets_product_idx
  on public.assets (product_id, type)
  where product_id is not null;

-- A business may attach many files to an offering; the cap is enforced in application code
-- (see lib/catalog/product-media.ts) rather than here, because the limit differs by kind and
-- a constraint that disagrees with the UI is worse than no constraint.
