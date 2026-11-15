-- Migration 21: give every new auth user a profile row, at the database.
--
-- THE BUG THIS FIXES
-- Onboarding never completed for a brand-new account, and the reason was that no `profiles` row
-- existed at all. The login page tried to create one from the BROWSER, immediately after
-- `signUp()`. With email confirmation switched on, `signUp()` returns no session, so that write
-- ran unauthenticated, row-level security refused it, and the failure was swallowed by a
-- `try { ... } catch { console.warn }`. Everything downstream — onboarding saves, the agent's
-- business context, the dashboard greeting — then had no profile to read or update.
--
-- Walked end to end on a fresh account: signup OK, confirmation OK, sign-in OK, onboarding
-- reached step 3 of 4, then sat on "SAVING PREFERENCES…" forever and `profiles` was still empty.
--
-- A trigger on `auth.users` is the one place that cannot be skipped: every signup path (email,
-- Google, admin API, invitation) starts there, it runs with definer rights so RLS cannot block
-- it, and it lands before the client ever asks for a profile.
--
-- Written as LANGUAGE sql with no internal semicolons on purpose: the migration runner applies a
-- file statement by statement, and a plpgsql body full of semicolons is shredded by that split.

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$ INSERT INTO public.profiles (id, email, created_at) VALUES (NEW.id, NEW.email, now()) ON CONFLICT (id) DO NOTHING $fn$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
