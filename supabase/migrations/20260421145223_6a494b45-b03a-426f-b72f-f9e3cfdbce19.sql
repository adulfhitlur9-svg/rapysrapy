
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE INDEX IF NOT EXISTS users_name_lower_trgm_idx
  ON public.users USING gin (name_lower gin_trgm_ops);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_rank') THEN
    CREATE TYPE public.account_rank AS ENUM ('new', 'moderator', 'administrator', 'ceo');
  END IF;
END $$;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS rank public.account_rank NOT NULL DEFAULT 'new';

UPDATE public.accounts SET rank = 'new' WHERE rank <> 'ceo';
UPDATE public.accounts SET rank = 'ceo' WHERE nick_lower = 'incognito';

CREATE OR REPLACE FUNCTION public.count_decoded_accounts()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM public.users u
  WHERE u.password IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.password_cracks pc WHERE pc.hash = u.password);
$$;

CREATE OR REPLACE FUNCTION public.fuzzy_search_users(q text, max_results int DEFAULT 20)
RETURNS TABLE(name text, premium boolean, match_kind text, score real)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q_lower text := lower(q);
  q_root  text := regexp_replace(lower(q), '[0-9]+$', '');
BEGIN
  RETURN QUERY
  WITH
  substring_matches AS (
    SELECT u.name, u.premium, 'substring'::text AS match_kind,
           (1.0 - (position(q_lower in u.name_lower)::real / GREATEST(length(u.name_lower), 1)))::real AS score
    FROM public.users u
    WHERE u.name_lower ILIKE '%' || q_lower || '%'
    LIMIT max_results * 2
  ),
  digit_matches AS (
    SELECT u.name, u.premium, 'digit_variant'::text AS match_kind, 0.95::real AS score
    FROM public.users u
    WHERE q_root <> ''
      AND length(q_root) >= 3
      AND regexp_replace(u.name_lower, '[0-9]+$', '') = q_root
      AND u.name_lower <> q_lower
    LIMIT max_results * 2
  ),
  typo_matches AS (
    SELECT u.name, u.premium, 'typo'::text AS match_kind,
           (1.0 - (levenshtein(u.name_lower, q_lower)::real / GREATEST(length(q_lower), 1)))::real AS score
    FROM public.users u
    WHERE length(q_lower) BETWEEN 3 AND 24
      AND length(u.name_lower) BETWEEN GREATEST(length(q_lower) - 2, 1) AND length(q_lower) + 2
      AND levenshtein(u.name_lower, q_lower) BETWEEN 1 AND 2
    LIMIT max_results * 2
  ),
  phonetic_matches AS (
    SELECT u.name, u.premium, 'phonetic'::text AS match_kind, 0.7::real AS score
    FROM public.users u
    WHERE length(q_lower) >= 3
      AND soundex(u.name_lower) = soundex(q_lower)
      AND u.name_lower <> q_lower
    LIMIT max_results
  ),
  candidates AS (
    SELECT * FROM substring_matches
    UNION ALL SELECT * FROM digit_matches
    UNION ALL SELECT * FROM typo_matches
    UNION ALL SELECT * FROM phonetic_matches
  )
  SELECT DISTINCT ON (c.name) c.name, c.premium, c.match_kind, c.score
  FROM candidates c
  ORDER BY c.name, c.score DESC
  LIMIT max_results;
END;
$$;
