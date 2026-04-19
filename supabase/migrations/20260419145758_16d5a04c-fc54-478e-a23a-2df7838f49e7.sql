-- Role enum
CREATE TYPE public.account_role AS ENUM ('user', 'admin');

-- Konta
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nick TEXT NOT NULL UNIQUE,
  nick_lower TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_lower TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  registration_ip TEXT,
  last_login_ip TEXT,
  last_login_at TIMESTAMPTZ,
  role public.account_role NOT NULL DEFAULT 'user',
  banned BOOLEAN NOT NULL DEFAULT false,
  ban_reason TEXT,
  banned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_nick_lower ON public.accounts(nick_lower);
CREATE INDEX idx_accounts_email_lower ON public.accounts(email_lower);
CREATE INDEX idx_accounts_created_at ON public.accounts(created_at DESC);

-- Sesje (token w cookie -> wiersz tu)
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_token ON public.sessions(token);
CREATE INDEX idx_sessions_account ON public.sessions(account_id);

-- Logi logowań (audit)
CREATE TABLE public.login_logs (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  nick_attempted TEXT,
  ip TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_logs_account ON public.login_logs(account_id);
CREATE INDEX idx_login_logs_created ON public.login_logs(created_at DESC);
CREATE INDEX idx_login_logs_ip ON public.login_logs(ip);

-- Rate limit rejestracji
CREATE TABLE public.registration_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reg_attempts_ip_created ON public.registration_attempts(ip, created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_accounts_updated_at
BEFORE UPDATE ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- nick_lower / email_lower trigger
CREATE OR REPLACE FUNCTION public.normalize_account_fields()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.nick_lower = lower(NEW.nick);
  NEW.email_lower = lower(NEW.email);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_accounts_normalize
BEFORE INSERT OR UPDATE OF nick, email ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.normalize_account_fields();

-- RLS — wszystko zablokowane, dostęp tylko przez serwer (service role)
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY no_public_accounts ON public.accounts FOR SELECT USING (false);
CREATE POLICY no_public_sessions ON public.sessions FOR SELECT USING (false);
CREATE POLICY no_public_login_logs ON public.login_logs FOR SELECT USING (false);
CREATE POLICY no_public_reg_attempts ON public.registration_attempts FOR SELECT USING (false);