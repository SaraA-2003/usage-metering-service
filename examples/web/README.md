# Example web client

The client server requires `DB_URL`, `PLATFORM`, and `PORT` as before, plus
`SESSION_ENCRYPTION_KEY`: a persistent 32-byte encryption key encoded as 64 hex
characters. Generate it once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
and save it in the git-ignored `.env`. Keep it stable across restarts; changing it
makes existing encrypted sessions unreadable. Do not commit or share the key.

Run `npm run migrate` before starting the API or client after schema changes.
Then run `npm run dev` and, separately, `npx tsx examples/web/server.ts`.
Visit http://localhost:3000.

Session cookies and encrypted database sessions expire after seven days. Only a
hash of the session cookie is stored. API keys are encrypted using AES-256-GCM
and remain on the client server. The database and encryption key must both be
retained for sessions to survive a restart. Expired rows are removed when a new
session is created. Use HTTPS when hosting outside local development.

Unfinished consumption payloads (user, units, request ID; never the API key) are
saved in browser sessionStorage so the same tab can safely retry after refresh.
The regression test exercises a lost response and reload through a simulated DOM;
manual testing in an actual browser remains useful for the complete UI flow.

Saved accounts are scoped to an HttpOnly `browserId` cookie. "Use another account"
clears the active session cookie while retaining the encrypted connection, so the
creation page also offers saved accounts. Other browsers cannot list or select
these accounts. Clearing browser cookies loses access to the saved list. Saved
connections expire after seven days; opening one creates a fresh active session.
Existing sessions can be linked to this browser when "Use another account" is
clicked. Accounts whose session and original key were already lost cannot be
recovered by this selector.
