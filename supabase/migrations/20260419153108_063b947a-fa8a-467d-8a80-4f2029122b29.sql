CREATE TABLE public.password_cracks (
  hash text PRIMARY KEY,
  plaintext text NOT NULL,
  cracked_by uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  cracked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.password_cracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no_public_cracks" ON public.password_cracks FOR SELECT USING (false);

CREATE TRIGGER password_cracks_updated_at
  BEFORE UPDATE ON public.password_cracks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Index na users.password żeby GROUP BY był szybki
CREATE INDEX IF NOT EXISTS users_password_idx ON public.users(password) WHERE password IS NOT NULL;