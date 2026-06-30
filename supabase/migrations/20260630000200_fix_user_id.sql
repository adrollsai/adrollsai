-- Define temporary SECURITY DEFINER function to update user ID safely using temp table copy (excluding generated columns)
CREATE OR REPLACE FUNCTION public.temp_fix_user_id() RETURNS void AS $$
BEGIN
    -- Create a temp table to hold the identity row verbatim
    CREATE TEMP TABLE temp_ident AS 
    SELECT * FROM auth.identities WHERE user_id = 'f26fcabf-2464-4382-bb9b-a66327e4a0cf';
    
    -- Update the user_id in the temp table to the target old profile ID
    UPDATE temp_ident SET user_id = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    
    -- Delete referencing rows from auth.refresh_tokens, auth.sessions, auth.identities
    DELETE FROM auth.refresh_tokens WHERE session_id IN (SELECT id FROM auth.sessions WHERE user_id = 'f26fcabf-2464-4382-bb9b-a66327e4a0cf');
    DELETE FROM auth.sessions WHERE user_id = 'f26fcabf-2464-4382-bb9b-a66327e4a0cf';
    DELETE FROM auth.identities WHERE user_id = 'f26fcabf-2464-4382-bb9b-a66327e4a0cf';
    
    -- Now update the user ID in auth.users
    UPDATE auth.users SET id = 'bc63c065-9bcc-4793-bedc-f0960406425b' WHERE id = 'f26fcabf-2464-4382-bb9b-a66327e4a0cf';
    
    -- Re-insert the identity row from the temp table, excluding generated email column
    INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, provider_id)
    SELECT id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, provider_id FROM temp_ident;
    
    -- Drop the temp table
    DROP TABLE temp_ident;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Execute the fix
SELECT public.temp_fix_user_id();

-- Clean up the temporary function
DROP FUNCTION IF EXISTS public.temp_fix_user_id();
