CREATE TABLE public.hash_failures (
  hash text PRIMARY KEY,
  marked_at timestamptz NOT NULL DEFAULT now(),
  marked_by uuid REFERENCES public.accounts(id) ON DELETE SET NULL
);

ALTER TABLE public.hash_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no_public_hash_failures" ON public.hash_failures FOR SELECT USING (false);