-- Inspect indexes on auth.identities
CREATE OR REPLACE FUNCTION public.get_identities_indexes()
RETURNS TABLE (
    index_name text,
    index_definition text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.relname::text AS index_name,
        pg_get_indexdef(i.oid)::text AS index_definition
    FROM pg_class t
    JOIN pg_index x ON t.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    WHERE t.relname = 'identities' AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
