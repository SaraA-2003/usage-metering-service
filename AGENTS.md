# Usage Metering Service — Codex Instructions

## Project overview
Build a backend API that lets calling applications track and enforce usage quotas for one resource: **units**. Each calling application is an **account** with a shared account plan; each registered user belongs to one account and has an individual user plan. Every consumption request must satisfy both plans. The service records decisions and accepted usage.

## Stack and environment
- TypeScript, Node.js 22, Express, PostgreSQL, and Drizzle ORM.
- Develop in WSL Ubuntu using VS Code.
- Use `.nvmrc` for the Node.js major version, `src/` for TypeScript sources, and `dist/` for compiled output.
- Use `tsx` for development and `tsc` for production builds.
- Prefer ES modules (`"type": "module"`, TypeScript `NodeNext`); use `.js` extensions for relative imports that compile to JavaScript.
- Use Zod for runtime validation if appropriate.
- The full stack must eventually start with `docker compose up --build`.
- Follow the repository's actual configuration and installed dependencies; do not assume a tool is installed.

## Required behavior
### Accounts, users, and authentication
- Create accounts and issue an API key for each account.
- Require an API key in a request header for account/user operations. The key identifies the account and restricts access to its own users, custom plans, usage, and history.
- Reject missing/invalid API keys and users not belonging to the authenticated account.
- Register users under accounts; assign and switch account and user plans.

### Plans and rules
- Seed read-only predefined account plans (e.g., Starter and Pro) and user plans (e.g., Basic and Premium) at startup.
- Allow an account to create, view, update, and assign its own custom plans.
- Support **monthly allowance** (UTC calendar month) and **maximum units per request** on both account and user plans.
- Shared plan definitions do not imply shared user usage totals.
- Custom plan edits take effect for new requests after a successful update, including all current assignees.
- Switching plans preserves usage already consumed in the current month.
- If a reduced allowance is below existing usage, remaining allowance is zero and further consumption at that level is rejected.

### Consumption and accounting
- A consumption request includes an account-authenticated user identifier, positive integer units, and a request identifier.
- Accept the entire amount only when all account and user rules pass; otherwise reject without consuming units.
- On acceptance, increment both the user's monthly usage and the account's shared monthly usage by the same amount.
- Explain rejection with a blocking rule and whether it belongs to the account or user.
- Preserve accepted and rejected request outcomes in history.
- Use UTC processing month; new months start at zero, with past months queryable.
- Handle retries safely and enforce correctness under concurrent requests using PostgreSQL transactions and appropriate locking or equivalent atomic mechanisms.
- Return current plans, limits, consumed and remaining units, historical monthly usage, and paginated request outcomes.

### Example client and deployment
- Include a small working web or CLI client that calls the service using an account API key. For a browser-based client, keep the API key on its server, not in browser code.
- Demonstrate two users on different plans, accepted consumption, rejection by user quota, rejection by shared account quota, and a plan change affecting subsequent requests without client-code changes.
- Display decisions and remaining allowances.
- Provide Docker Compose for the API, PostgreSQL, example client, and any necessary dependencies; automate schema initialization and plan seeding.

### Testing and documentation
- Add automated tests for rule enforcement, plan updates/switches, idempotent retries, concurrent requests, API key validation, account isolation, and historical usage.
- Include reproducible load tests, scripts/configuration, measured results, and observations about performance and bottlenecks.
- Document setup, API examples, key handling, rules, product assumptions, retry behavior, design tradeoffs, and limitations in README.
- Keep billing, payments, refunds, multiple resources, end-user login, RBAC, and distributed infrastructure out of scope.

## Product decisions to document
Where the assignment leaves behavior unspecified, choose sensible consistent defaults, explain why, and record them in the README. Candidate decisions include idempotency key scope and payload conflicts, failure-rule precedence, plan validation and deletion policy, and account bootstrap/key issuance. Do not treat suggestions here as final decisions without discussing them with the developer.

## How to help me learn
- **Act as a coding tutor and reviewer, not an autonomous implementer.** I want to write the code myself.
- Explain concepts clearly in simple English, one step at a time, including the *why* behind design choices.
- When I ask how to implement something, start with a concise explanation, small hints, pseudocode, or a focused example rather than complete files.
- Ask me to try the next step, then review my attempt and explain mistakes.
- Do **not** edit, create, delete, or refactor project files or run commands that change state unless I explicitly ask you to do so.
- You may read project files to answer questions. Before proposing major architecture changes, explain the tradeoffs.
- When I explicitly request implementation or edits, keep changes minimal and explain what changed.
- Do not invent completed features or test results; distinguish requirements, plans, and verified implementation.
- Prefer continuing from the existing code and project conventions instead of rebuilding from scratch.
