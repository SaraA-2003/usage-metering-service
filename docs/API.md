# API reference

[Project overview and installation](../README.md)

Local base URL: `http://localhost:8080` (or the configured API port).
Send JSON bodies with `Content-Type: application/json`.

## Authentication and conventions

All routes require `X-API-Key` except `GET /api/plans/predefined` and
`POST /api/accounts`. An API key identifies its account; request bodies do not
select an account. Requests to other accounts/users are rejected. The API stores
only SHA-256 key hashes and returns the original key once on account creation.
Keep it on calling-application servers or in secret storage.

UUID fields use UUID strings. Timestamps are ISO 8601 strings in JSON. Monthly
periods are returned as `YYYY-MM-01`; optional usage queries take `YYYY-MM`.
All monthly accounting uses UTC. Object schemas reject unexpected fields.

## Endpoint index

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| GET | `/api/plans/predefined` | Public predefined plan discovery | 200 |
| POST | `/api/accounts` | Create account and issue key | 201 |
| GET | `/api/accounts/:id` | Read authenticated account | 200 |
| PATCH | `/api/accounts/:id/plan` | Switch account plan | 200 |
| GET | `/api/accounts/:id/usage` | Current or selected monthly usage | 200 |
| GET | `/api/users` | List authenticated account's users | 200 |
| POST | `/api/users` | Register user under authenticated account | 201 |
| GET | `/api/users/:id` | Read owned user | 200 |
| PATCH | `/api/users/:id/plan` | Switch owned user's plan | 200 |
| GET | `/api/users/:id/usage` | User's current or selected monthly usage | 200 |
| GET | `/api/plans` | Predefined and account-owned plans | 200 |
| POST | `/api/plans` | Create custom plan | 201 |
| PUT | `/api/plans/:id` | Update supplied custom-plan fields | 200 |
| POST | `/api/consumptions` | Evaluate and record consumption | 200 |
| GET | `/api/consumptions/history` | Paginated account/user outcomes | 200 |

## Resource schemas

| Resource | Response fields |
| --- | --- |
| Account | `id`, `name`, `planId`, `createdAt`, `updatedAt` |
| New account | Account fields plus `apiKey` (once only) |
| User | `id`, `accountId`, `planId`, `createdAt`, `updatedAt` |
| Plan | `id`, `name`, `type`, `accountId`, `isPredefined`, `monthlyAllowance`, `maxUnitsPerRequest`, `createdAt`, `updatedAt` |

Account responses exclude `apiKeyHash`. Plan `type` is `account` or `user`.
Predefined plans have `accountId: null`; custom plans have their owning account ID.

### Predefined plans

Startup creates missing plans without modifying existing definitions:

| Name | Type | Monthly allowance | Maximum units/request |
| --- | --- | ---: | ---: |
| Starter | account | 1,000 | 100 |
| Pro | account | 10,000 | 1,000 |
| Basic | user | 100 | 10 |
| Premium | user | 1,000 | 100 |

`GET /api/plans/predefined` returns an array and does not require a key.
`GET /api/plans` requires a key and returns an array of predefined and owned plans.
If no plans are available, the protected list route returns 404.

## Accounts and users

Create account:

```json
{ "name": "My application", "planId": "<predefined-account-plan-uuid>" }
```

`name` is trimmed, nonempty, and at most 255 characters. Initial account plans must
be predefined account plans. Names are labels, not unique identifiers. Save the
returned `apiKey`; it cannot be recovered from its hash.

Register user:

```json
{ "planId": "<user-plan-uuid>" }
```

The key determines the account. User plans can be predefined or owned custom plans.
There is no end-user login, user name field, or client-supplied user ID.
`GET /api/users` returns an array, including an empty array for an account with no users.

Both switch routes accept:

```json
{ "planId": "<replacement-plan-uuid>" }
```

The plan must match the resource type and be predefined or owned by the account.
Switches return the updated resource. Monthly usage is preserved, including when
switching to an allowance below usage already consumed.

## Custom plans

`POST /api/plans` body:

```json
{
  "name": "Team users",
  "type": "user",
  "monthlyAllowance": 500,
  "maxUnitsPerRequest": 25
}
```

| Field | Validation |
| --- | --- |
| `name` | Trimmed nonempty string |
| `type` | `account` or `user` |
| `monthlyAllowance` | Integer from 0 through 2,147,483,647 |
| `maxUnitsPerRequest` | Integer from 1 through 2,147,483,647 |

`isPredefined` and ownership are assigned by the server. A maximum per request
larger than the monthly allowance is allowed; every request must still satisfy both.

`PUT /api/plans/:id` accepts one or more of `name`, `monthlyAllowance`, and
`maxUnitsPerRequest`. Although the route uses PUT, its implemented behavior updates
only supplied fields. Type and ownership cannot be edited. Predefined plans are
read-only. The response is the updated plan, and current assignees use its new limits
for new requests.

Names ignore case and surrounding spaces. Custom names must be unique within an
account and type. Different accounts may use the same custom name. The API forbids
custom names matching predefined names of the same type. Database unique indexes
protect duplicates within each scope; the cross-scope reservation is an API rule.
No plan deletion endpoint is provided.

## Monthly usage

```http
GET /api/accounts/<id>/usage
GET /api/users/<id>/usage?month=2026-09
```

`month` is optional; defaults to the current UTC month. Valid years are `0001`–`9999`,
months `01`–`12`, and future months are rejected. Missing monthly rows mean zero usage.

Account example response (illustrative):

```json
{
  "accountId": "<account-uuid>",
  "month": "2026-09-01",
  "plan": {
    "id": "<plan-uuid>",
    "name": "Starter",
    "monthlyAllowance": 1000,
    "maxUnitsPerRequest": 100
  },
  "consumedUnits": 80,
  "remainingUnits": 920
}
```

User usage has the same shape plus `userId`; its totals are personal, while account
totals include all its users. Remaining is `max(0, monthlyAllowance - consumedUnits)`.
Historical requests use past usage totals but the **current assigned plan and its
current limits**, not historical snapshots. Personal remaining units do not imply
that the account's shared allowance is available.

## Consumption and accounting

`POST /api/consumptions` body:

```json
{ "userId": "<owned-user-uuid>", "units": 10, "requestId": "operation-123" }
```

- `units`: positive integer, maximum 2,147,483,647.
- `requestId`: trimmed nonempty string, maximum 255 characters; generate in the caller.
- The entire amount is accepted or rejected; no partial consumption.
- Accepted usage increments both account and user totals for the UTC processing month.
- Rejection preserves both totals and saves a blocking rule.

New-request response (illustrative):

```json
{
  "outcome": {
    "accountId": "<account-uuid>",
    "requestId": "operation-123",
    "userId": "<user-uuid>",
    "units": 10,
    "decision": "accepted",
    "blockingLevel": null,
    "blockingRule": null,
    "month": "2026-09-01",
    "createdAt": "2026-09-10T12:00:00.000Z"
  },
  "remaining": { "account": 990, "user": 90 },
  "replayed": false
}
```

Quota rejection also uses HTTP **200**, with `decision: "rejected"`, a
`blockingLevel` of `account` or `user`, and `blockingRule` of
`max_units_per_request` or `monthly_allowance`. It is a processed business decision.
Rules are checked in this order; the first failure is returned:

1. Account maximum per request.
2. Account monthly allowance.
3. User maximum per request.
4. User monthly allowance.

### Retries

Request ID scope is `(accountId, requestId)` across users and months. An identical
retry returns the saved outcome without changing totals or creating another record:

```json
{ "outcome": { "requestId": "operation-123", "decision": "accepted" }, "replayed": true }
```

The actual `outcome` includes all stored fields shown above; this example is shortened.
Replays omit `remaining`, since no historical allowance snapshot was saved. Query
usage separately for current totals. Changed user or units returns 409. A saved
rejection remains rejected on replay even after a plan change; use a new request ID
for a genuinely new attempt. Input/authentication failures and ID conflicts do not
create new consumption outcomes.

Account row locks serialize consumption per account inside a transaction. Accepted
usage updates and saved outcomes commit together or roll back together.

## History and pagination

```http
GET /api/consumptions/history?limit=20&offset=0
GET /api/consumptions/history?userId=<uuid>&limit=5&offset=0
```

| Parameter | Default | Validation |
| --- | --- | --- |
| `userId` | All account users | Optional owned user UUID; foreign/missing users return 404 |
| `limit` | 20 | Integer string, 1–100 |
| `offset` | 0 | Integer string, 0–2,147,483,647 |

```json
{
  "requests": [],
  "limit": 20,
  "offset": 0,
  "hasMore": false,
  "nextOffset": null
}
```

`requests` contains full outcome objects, both accepted and rejected. Ordering is
`createdAt DESC`, then `requestId DESC` for ties. If more records exist, `hasMore`
is true and `nextOffset` is `offset + limit`. Use that value for the next request.
Empty pages and offsets beyond the end return 200. Pages can shift while new
requests arrive; offset pagination is not a fixed snapshot.

## Errors

Errors use `{ "error": "description" }`.

| Status | Examples |
| --- | --- |
| 400 | Invalid body/query/UUID/month, wrong plan type, invalid JSON |
| 401 | Missing or invalid API key |
| 403 | Editing predefined plans or assigning/editing another account's custom plan |
| 404 | Missing resource, inaccessible account/user |
| 409 | Duplicate plan name or request ID reused with changed payload |
| 500 | Unexpected database/server failure |

## Curl quick start

Replace bracketed values with IDs from preceding responses. The shell variables
below exist only in your terminal; do not commit real keys.

```bash
# Discover plan IDs without authentication.
BASE_URL=http://localhost:8080
curl -s "$BASE_URL/api/plans/predefined" | python3 -m json.tool

# Choose Starter's UUID, then save the returned account ID and apiKey.
curl -s "$BASE_URL/api/accounts" \
  -H 'Content-Type: application/json' \
  -d '{"name":"My application","planId":"<starter-uuid>"}'

# Supply your newly issued key and create a Basic user.
API_KEY='<returned-api-key>'
curl -s "$BASE_URL/api/users" \
  -H "X-API-Key: $API_KEY" -H 'Content-Type: application/json' \
  -d '{"planId":"<basic-uuid>"}'

# Consume, then inspect history; repeat this exact request to see replayed:true.
curl -s "$BASE_URL/api/consumptions" \
  -H "X-API-Key: $API_KEY" -H 'Content-Type: application/json' \
  -d '{"userId":"<user-uuid>","units":5,"requestId":"first-operation"}'
curl -s "$BASE_URL/api/consumptions/history?limit=2&offset=0" \
  -H "X-API-Key: $API_KEY" | python3 -m json.tool
```

`python3 -m json.tool` is optional formatting and is not required by the API.

## Required demonstration recipe

Use a fresh account and distinct request IDs for every new operation. The same API
key is used for all requests; user IDs are from this account.

1. Create an account with Starter. Create an owned **account** custom plan named
   `Demo shared`, allowance **10**, maximum/request **10**. Assign it with
   `PATCH /api/accounts/:id/plan`.
2. Create owned **user** plans `Demo Basic` (allowance **3**, maximum **3**) and
   `Demo Premium` (allowance **20**, maximum **10**). Register one user on each.
3. Basic user consumes **2**: accepted; account remaining **8**, user remaining **1**.
4. Basic user requests another **2**: rejected by user monthly allowance; totals unchanged.
5. Switch that user to `Demo Premium` using `PATCH /api/users/:id/plan`.
6. The same user requests **2** with a new request ID: accepted, demonstrating the
   new plan without changing request/client code; their consumed total is now **4**.
7. The second user consumes **5**: accepted; shared consumed total becomes **9**.
8. The second user requests **2**: rejected by account monthly allowance; only **1** remains.
9. Read both usage endpoints and history to inspect decisions and totals. Retry an
   earlier request ID unchanged to show no extra consumption.

Custom plan creation/account switching are supported by the API; the web interface
exposes user plan switching but not every management operation. These setup calls
can be made with curl. No client code changes are required between requests.
