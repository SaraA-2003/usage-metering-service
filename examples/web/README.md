# Example web client

[Project overview](../../README.md) · [API reference](../../docs/API.md) · [Docker guide](../../DOCKER.md)

## Setup

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


## Using the page

1. Choose a predefined account plan and create an account. Its API key stays on
   the client server; the browser receives an HttpOnly session cookie.
2. Register users with different user plans. The page shows monthly and per-request
   limits in the dropdowns and account usage summary.
3. Select a user, enter positive units, and submit consumption. The response shows
   the decision, blocking reason when rejected, and remaining allowances for new requests.
4. Use the Change plan form to assign a different user plan. Existing consumed
   usage remains; a new consumption operation receives a new request ID.
5. Browse history with a selected page size, optional user filter, and Previous/Next.
6. Refresh to restore the current account. Use another account opens the saved-account
   selector or allows creating a new account without deleting previous account data.

## Architecture and limitations

The browser calls `/client/...` routes on port 3000. The Express client server
adds X-API-Key and forwards to the metering API. Browser JavaScript never receives
account API keys. `client_sessions` stores encrypted keys and session/browser hashes;
this persistence is part of the example client, separate from account API-key hashes.

The page covers account creation, user registration, user plan switching, consumption,
account usage, and filtered history. Custom-plan creation/editing, account plan
switching, and historical-month selection are available through the API but do not
have page controls. There is no end-user login or API-key recovery interface.
The API is the source of truth for users and usage when an account is restored.

For a complete two-user quota and plan-change walkthrough, see the
[demonstration recipe](../../docs/API.md#required-demonstration-recipe).
