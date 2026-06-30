-- Drop the temporary SQL executor helper RPC function to secure the database
DROP FUNCTION IF EXISTS public.exec_sql(text);
