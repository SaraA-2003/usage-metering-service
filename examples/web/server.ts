import { createSessionStore, sessionLifetime } from "./sessions.js";
import express, { type Request } from "express";
import { fileURLToPath } from "node:url";
import { config } from "../../src/config.js";



const app = express();
const publicDirectory = fileURLToPath(
  new URL("./public/", import.meta.url),
);

const sessions = createSessionStore(process.env.SESSION_ENCRYPTION_KEY ?? "");
const apiBaseUrl =
  process.env.API_URL ?? `http://localhost:${config.api.port}`;

//// Uses the session ID to retrieve the account ID and API key stored on the client server.
function getCookie(req: Request, name: string) {
  const sessionCookie = req.headers.cookie
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));

  const sessionId = sessionCookie?.slice(name.length + 1);

  return sessionId;
}

async function getAccountSession(req: Request) {
  const sessionId = getCookie(req, "sessionId");
  return sessionId ? sessions.get(sessionId) : undefined;
}

app.use(express.json());
app.use(express.static(publicDirectory));

//----------------------------------------------
//account creation
app.post("/client/accounts", async (req, res) => {
  const response = await fetch(`${apiBaseUrl}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body),
  });

  const account = await response.json();

  if (!response.ok) {
    res.status(response.status).json(account);
    return;
  }

  const sessionId = crypto.randomUUID();

  const browserId = getCookie(req, "browserId") ?? crypto.randomUUID();
  res.cookie("browserId", browserId, { maxAge: sessionLifetime, httpOnly: true, sameSite: "strict", path: "/" });
  await sessions.set(sessionId, {
    accountId: account.id,
    apiKey: account.apiKey,
  }, browserId);

  res.cookie("sessionId", sessionId, {
    maxAge: sessionLifetime,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });

  const { apiKey, apiKeyHash, ...publicAccount } = account;
  res.status(201).json(publicAccount);
});

//----------------------------------------------
app.get("/client/account/usage", async (req, res) => {
  const session = await getAccountSession(req);

  if (!session) {
    res.status(401).json({ error: "Create or connect an account first" });
    return;
  }

  const response = await fetch(
    `${apiBaseUrl}/api/accounts/${session.accountId}/usage`,
    {
      headers: { "X-API-Key": session.apiKey },
    },
  );

  res.status(response.status).json(await response.json());
});

//----------------------------------------------
app.get("/client/plans", async (req, res) => {
  const session = await getAccountSession(req);

  if (!session) {
    res.status(401).json({ error: "Create or connect an account first" });
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/plans`, {
    headers: { "X-API-Key": session.apiKey },
  });

  res.status(response.status).json(await response.json());
});
//----------------------------------------------
app.get("/client/plans/predefined", async (req, res) => {
  const response = await fetch(`${apiBaseUrl}/api/plans/predefined`);

  res.status(response.status).json(await response.json());
});


app.post("/client/users", async (req, res) => {
  const session = await getAccountSession(req);

  if (!session) {
    res.status(401).json({ error: "Create or connect an account first" });
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": session.apiKey,
    },
    body: JSON.stringify(req.body),
  });

  res.status(response.status).json(await response.json());
});

app.post("/client/consumptions", async (req, res) => {
  const session = await getAccountSession(req);

  if (!session) {
    res.status(401).json({ error: "Create or connect an account first" });
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/consumptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": session.apiKey,
    },
    body: JSON.stringify(req.body),
  });

  res.status(response.status).json(await response.json());
});

app.get("/client/consumptions/history", async (req, res) => {
  const session = await getAccountSession(req);
  if (!session) {
    res.status(401).json({ error: "Create an account first" });
    return;
  }
  const query = new URL(req.originalUrl, "http://localhost").search;
  const response = await fetch(`${apiBaseUrl}/api/consumptions/history${query}`, {
    headers: { "X-API-Key": session.apiKey },
  });
  res.status(response.status).json(await response.json());
});



app.delete("/client/session", async (req, res) => {
  const sessionId = getCookie(req, "sessionId");
  if (sessionId) {
    const browserId = getCookie(req, "browserId") ?? crypto.randomUUID();
    await sessions.adopt(sessionId, browserId);
    res.cookie("browserId", browserId, { maxAge: sessionLifetime, httpOnly: true, sameSite: "strict", path: "/" });
  }
  res.clearCookie("sessionId", { httpOnly: true, sameSite: "strict", path: "/" });
  res.sendStatus(204);
});

app.get("/client/saved-accounts", async (req, res) => {
  const browserId = getCookie(req, "browserId");
  res.json(browserId ? await sessions.list(browserId) : []);
});

app.post("/client/saved-accounts/select", async (req, res) => {
  const browserId = getCookie(req, "browserId");
  const accountId = req.body?.accountId;
  if (!browserId || typeof accountId !== "string" || !/^[a-f0-9-]{36}$/i.test(accountId)) {
    res.status(404).json({ error: "Saved account not found" });
    return;
  }
  const saved = await sessions.find(browserId, accountId);
  const session = saved ? await sessions.get(saved.idHash, true) : undefined;
  if (!session) {
    res.status(404).json({ error: "Saved account not found" });
    return;
  }
  const sessionId = crypto.randomUUID();
  await sessions.set(sessionId, session, browserId);
  res.cookie("sessionId", sessionId, { maxAge: sessionLifetime, httpOnly: true, sameSite: "strict", path: "/" });
  res.sendStatus(204);
});

app.get("/client/session", async (req, res) => {
  const session = await getAccountSession(req);
  if (!session) {
    res.status(401).json({ error: "No active session" });
    return;
  }
  const response = await fetch(`${apiBaseUrl}/api/accounts/${session.accountId}`, {
    headers: { "X-API-Key": session.apiKey },
  });
  res.status(response.status).json(await response.json());
});

app.get("/client/users", async (req, res) => {
  const session = await getAccountSession(req);
  if (!session) {
    res.status(401).json({ error: "No active session" });
    return;
  }
  const response = await fetch(`${apiBaseUrl}/api/users`, {
    headers: { "X-API-Key": session.apiKey },
  });
  res.status(response.status).json(await response.json());
});

app.patch("/client/users/:id/plan", async (req, res) => {
  const session = await getAccountSession(req);
  if (!session) {
    res.status(401).json({ error: "Create an account first" });
    return;
  }
  const response = await fetch(`${apiBaseUrl}/api/users/${encodeURIComponent(req.params.id)}/plan`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-API-Key": session.apiKey },
    body: JSON.stringify(req.body),
  });
  res.status(response.status).json(await response.json());
});

app.use((error: unknown, req: Request, res: express.Response, next: express.NextFunction) => {
  console.error("Client request failed", error instanceof Error ? error.message : "Unknown error");
  res.status(502).json({ error: "Could not complete the API request. Check that the API is running." });
});

app.listen(3000, () => {
  console.log("Example client running at http://localhost:3000");
});


