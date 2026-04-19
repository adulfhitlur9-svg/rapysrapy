CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  password TEXT,
  first_ip TEXT,
  last_ip TEXT,
  premium BOOLEAN DEFAULT FALSE,
  discord_email TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_name_lower ON public.users (LOWER(name));
CREATE INDEX idx_users_name_trgm ON public.users USING gin (LOWER(name) gin_trgm_ops);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no_public_access" ON public.users FOR SELECT USING (false);