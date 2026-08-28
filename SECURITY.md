# Security Notes

## Provider API keys

Keep all provider API keys in Supabase Edge Function secrets. Do not put provider keys in Vite environment variables or browser local storage.

Recommended secrets:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `GROQ_API_KEY`
- `DEEPSEEK_API_KEY`

## Browser configuration

Only the Supabase project URL and public anonymous key belong in the Vite client configuration.

## Production checklist

- Keep the repository free of `.env` files and provider keys.
- Set `APP_ORIGIN` to the exact production frontend origin.
- Keep Supabase RLS enabled for every user-owned table.
- Rotate any provider key immediately if it is ever exposed.
- Test authentication and RLS with both authenticated and unauthenticated requests before making the deployment public.
