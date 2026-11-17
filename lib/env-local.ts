/**
 * Import FIRST in any script. esbuild hoists imports, so a module-level SDK (the Gemini client, for example) is
 * constructed before the script body runs — if the environment is not loaded by then, it is constructed with no key
 * and every call fails with "API key not valid" while the app itself works fine.
 */
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });
