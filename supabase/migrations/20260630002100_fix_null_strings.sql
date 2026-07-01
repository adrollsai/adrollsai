-- Set default empty strings for token columns to prevent GoTrue scanning crashes
UPDATE auth.users
SET 
  email_change = COALESCE(email_change, ''),
  recovery_token = COALESCE(recovery_token, ''),
  confirmation_token = COALESCE(confirmation_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, ''),
  email_change_token_current = COALESCE(email_change_token_current, '')
WHERE 
  email_change IS NULL OR 
  recovery_token IS NULL OR 
  confirmation_token IS NULL OR 
  email_change_token_new IS NULL OR
  phone_change IS NULL OR
  phone_change_token IS NULL OR
  reauthentication_token IS NULL OR
  email_change_token_current IS NULL;
