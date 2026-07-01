-- Inspect auth.users columns and types
CREATE OR REPLACE FUNCTION public.get_users_columns()
RETURNS TABLE (
    column_name text,
    data_type text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.column_name::text, 
        c.data_type::text
    FROM information_schema.columns c
    WHERE c.table_schema = 'auth' AND c.table_name = 'users';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
