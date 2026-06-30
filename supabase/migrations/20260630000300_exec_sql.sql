-- Create a temporary helper RPC to run SQL queries for diagnostics
CREATE OR REPLACE FUNCTION public.exec_sql(sql_query text)
RETURNS jsonb AS $$
DECLARE
    result jsonb;
BEGIN
    EXECUTE 'SELECT jsonb_agg(t) FROM (' || sql_query || ') t' INTO result;
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
