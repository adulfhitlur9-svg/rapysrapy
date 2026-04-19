ALTER TABLE public.users ADD COLUMN name_lower TEXT GENERATED ALWAYS AS (LOWER(name)) STORED;
DROP INDEX IF EXISTS idx_users_name_lower;
ALTER TABLE public.users ADD CONSTRAINT users_name_lower_unique UNIQUE (name_lower);