const planSelect = document.querySelector("#account-plan");
const message = document.querySelector("#message");

async function loadAccountPlans() {
    try {
        const response = await fetch("/client/plans/predefined");

        if (!response.ok) {
            throw new Error("Could not load plans");
        }

        const plans = await response.json();

        for (const plan of plans.filter((plan) => plan.type === "account")) {
            const option = document.createElement("option");
            option.value = plan.id;
            option.textContent =
                `${plan.name} — ${plan.monthlyAllowance} units/month, max ${plan.maxUnitsPerRequest} units/request`;
            planSelect.append(option);
        }
    } catch (error) {
        message.textContent = error.message;
    }
}

async function loadAccountUsage() {
    try {
        const response = await fetch("/client/account/usage");
        const usage = await response.json();

        if (!response.ok) {
            throw new Error(usage.error ?? "Could not load usage");
        }

        document.querySelector("#usage-plan").textContent = usage.plan.name;
        document.querySelector("#usage-consumed").textContent = usage.consumedUnits;
        document.querySelector("#usage-remaining").textContent = usage.remainingUnits;
        document.querySelector("#usage-max-per-request").textContent = usage.plan.maxUnitsPerRequest;
        document.querySelector("#account-usage").hidden = false;
    } catch (error) {
        message.textContent = error.message;
    }
}

async function loadUserPlans() {
    const response = await fetch("/client/plans");
    const plans = await response.json();

    if (!response.ok) {
        throw new Error(plans.error ?? "Could not load user plans");
    }

    const select = document.querySelector("#user-plan");
    select.replaceChildren();
    const switchSelect = document.querySelector("#switch-plan-plan");
    switchSelect.replaceChildren();

    for (const plan of plans.filter((plan) => plan.type === "user")) {
        const option = document.createElement("option");
        option.value = plan.id;
        option.textContent =
            `${plan.name} — ${plan.monthlyAllowance} units/month, max ${plan.maxUnitsPerRequest} units/request`;
        select.append(option);
        switchSelect.append(option.cloneNode(true));
    }

    document.querySelector("#user-management").hidden = false;
}

loadAccountPlans();
const accountForm = document.querySelector("#account-form");
const accountName = document.querySelector("#account-name");

accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const response = await fetch("/client/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: accountName.value.trim(),
                planId: planSelect.value,
            }),
        });

        const account = await response.json();

        if (!response.ok) {
            throw new Error(account.error ?? "Could not create account");
        }

        message.textContent = `Account "${account.name}" created`;
        document.querySelector("#user-list").replaceChildren();
        document.querySelector("#consumption-user").replaceChildren();
        document.querySelector("#switch-plan-user").replaceChildren();
        const allUsers = document.createElement("option");
        allUsers.value = "";
        allUsers.textContent = "All users";
        document.querySelector("#history-user").replaceChildren(allUsers);
        document.querySelector("#consumption-result").textContent = "";
        pendingConsumption = undefined;
        sessionStorage.removeItem("pendingConsumption");
        historyUser = "";
        historyOffset = 0;
        nextHistoryOffset = null;
        await loadAccountUsage();
        await loadUserPlans();
        accountForm.hidden = true;
        document.querySelector("#saved-accounts").hidden = true;
        document.querySelector("#use-another-account").hidden = false;
        document.querySelector("#history").hidden = false;
        await loadHistory(0);


    } catch (error) {
        message.textContent = error.message;
    }
});

// Fetches the latest usage data and updates the displayed totals when clicked.
document.querySelector("#refresh-usage").addEventListener(
    "click",
    loadAccountUsage,
);

document.querySelector("#user-form").addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();

        try {
            const select = document.querySelector("#user-plan");

            const response = await fetch("/client/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId: select.value }),
            });

            const user = await response.json();

            if (!response.ok) {
                throw new Error(user.error ?? "Could not register user");
            }

            const item = document.createElement("li");
            item.dataset.userId = user.id;
            item.textContent =
                `${user.id} — ${select.selectedOptions[0].textContent}`;

            document.querySelector("#user-list").append(item);
            const option = document.createElement("option");
            option.value = user.id;
            option.textContent =
                `${user.id} — ${select.selectedOptions[0].textContent}`;

            document.querySelector("#consumption-user").append(option);
            document.querySelector("#switch-plan-user").append(option.cloneNode(true));
            document.querySelector("#history-user").append(option.cloneNode(true));
            message.textContent = "User registered";
        } catch (error) {
            message.textContent = error.message;
        }
    },
);
// Keep the payload after a failed request so retrying uses the same request ID.
let pendingConsumption;
try {
    pendingConsumption = JSON.parse(sessionStorage.getItem("pendingConsumption") ?? "null");
} catch {
    sessionStorage.removeItem("pendingConsumption");
}
const consumptionForm = document.querySelector("#consumption-form");
consumptionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userId = document.querySelector("#consumption-user").value;
    const units = Number(document.querySelector("#consumption-units").value);
    if (!pendingConsumption || pendingConsumption.userId !== userId || pendingConsumption.units !== units) {
        pendingConsumption = { userId, units, requestId: crypto.randomUUID() };
        sessionStorage.setItem("pendingConsumption", JSON.stringify(pendingConsumption));
    }
    const button = consumptionForm.querySelector("button");
    button.disabled = true;
    try {
        const response = await fetch("/client/consumptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pendingConsumption),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not consume units");
        pendingConsumption = undefined;
        sessionStorage.removeItem("pendingConsumption");
        document.querySelector("#consumption-result").textContent = JSON.stringify(result, null, 2);
        await loadAccountUsage();
        await loadHistory(0);
    } catch (error) {
        document.querySelector("#consumption-result").textContent = `${error.message} Submit the same values to retry.`;
    } finally {
        button.disabled = false;
    }
});

let historyOffset = 0;
let nextHistoryOffset = null;
let historyLimit = 20;
let historyUser = "";
let historyLoading = false;
const previousButton = document.querySelector("#history-previous");
const nextButton = document.querySelector("#history-next");

async function loadHistory(offset) {
    if (historyLoading) return;
    historyLoading = true;
    previousButton.disabled = true;
    nextButton.disabled = true;
    try {
        const query = new URLSearchParams({ limit: String(historyLimit), offset: String(offset) });
        if (historyUser) query.set("userId", historyUser);
        const response = await fetch(`/client/consumptions/history?${query}`);
        const page = await response.json();
        if (!response.ok) throw new Error(page.error ?? "Could not load history");
        const rows = document.querySelector("#history-rows");
        rows.replaceChildren();
        for (const request of page.requests) {
            const row = document.createElement("tr");
            for (const value of [request.createdAt, request.userId, request.units, request.decision,
                request.blockingRule ? `${request.blockingLevel}: ${request.blockingRule}` : "—", request.requestId]) {
                const cell = document.createElement("td");
                cell.textContent = String(value);
                row.append(cell);
            }
            rows.append(row);
        }
        historyOffset = page.offset;
        nextHistoryOffset = page.hasMore ? page.nextOffset : null;
        document.querySelector("#history-status").textContent = page.requests.length
            ? `Records ${page.offset + 1}–${page.offset + page.requests.length}${page.hasMore ? "" : " — End of history"}`
            : "No requests found";
    } catch (error) {
        message.textContent = error.message;
    } finally {
        historyLoading = false;
        previousButton.disabled = historyOffset === 0;
        nextButton.disabled = nextHistoryOffset === null;
    }
}

document.querySelector("#history-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    historyLimit = Number(document.querySelector("#history-limit").value);
    historyUser = document.querySelector("#history-user").value;
    await loadHistory(0);
});
previousButton.addEventListener("click", () => loadHistory(Math.max(0, historyOffset - historyLimit)));
nextButton.addEventListener("click", () => {
    if (nextHistoryOffset !== null) loadHistory(nextHistoryOffset);
});


async function restoreSession() {
    const button = accountForm.querySelector("button");
    button.disabled = true;
    try {
        const response = await fetch("/client/session");
        if (response.status === 401 || response.status === 404) return;
        const account = await response.json();
        if (!response.ok) throw new Error(account.error ?? "Could not restore session");
        accountForm.hidden = true;
        document.querySelector("#saved-accounts").hidden = true;
        document.querySelector("#use-another-account").hidden = false;
        await loadUserPlans();
        const usersResponse = await fetch("/client/users");
        const users = await usersResponse.json();
        if (!usersResponse.ok) throw new Error(users.error ?? "Could not load users");
        for (const user of users) {
            const plan = document.querySelector(`#user-plan option[value="${user.planId}"]`);
            const label = `${user.id} — ${plan?.textContent ?? user.planId}`;
            const item = document.createElement("li");
            item.dataset.userId = user.id;
            item.textContent = label;
            document.querySelector("#user-list").append(item);
            const option = document.createElement("option");
            option.value = user.id;
            option.textContent = label;
            document.querySelector("#consumption-user").append(option);
            document.querySelector("#switch-plan-user").append(option.cloneNode(true));
            document.querySelector("#history-user").append(option.cloneNode(true));
        }
        await loadAccountUsage();
        document.querySelector("#history").hidden = false;
        await loadHistory(0);
        if (pendingConsumption) {
            document.querySelector("#consumption-user").value = pendingConsumption.userId;
            document.querySelector("#consumption-units").value = pendingConsumption.units;
        }
        message.textContent = pendingConsumption
            ? "An unfinished request was restored. Submit the same values to retry safely."
            : `Connected to account "${account.name}"`;
    } catch (error) {
        message.textContent = error.message;
    } finally {
        button.disabled = false;
    }
}
restoreSession();

document.querySelector("#switch-plan-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const userId = document.querySelector("#switch-plan-user").value;
    const planSelect = document.querySelector("#switch-plan-plan");
    const planId = planSelect.value;
    const planLabel = planSelect.selectedOptions[0].textContent;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
        const response = await fetch(`/client/users/${encodeURIComponent(userId)}/plan`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planId }),
        });
        const user = await response.json();
        if (!response.ok) throw new Error(user.error ?? "Could not change plan");
        const label = `${user.id} — ${planLabel}`;
        for (const id of ["consumption-user", "history-user", "switch-plan-user"]) {
            for (const option of document.querySelector(`#${id}`).options) {
                if (option.value === user.id) option.textContent = label;
            }
        }
        for (const item of document.querySelector("#user-list").children) {
            if (item.dataset.userId === user.id) item.textContent = label;
        }
        message.textContent = "User plan changed. Existing usage is preserved; new requests use the new limits.";
    } catch (error) {
        message.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

document.querySelector("#use-another-account").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const response = await fetch("/client/session", { method: "DELETE" });
        if (!response.ok) throw new Error("Could not disconnect from this account");
        sessionStorage.removeItem("pendingConsumption");
        window.location.reload();
    } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
    }
});


async function loadSavedAccounts() {
    try {
        const response = await fetch("/client/saved-accounts");
        if (!response.ok) throw new Error("Could not load saved accounts");
        const accounts = await response.json();
        const select = document.querySelector("#saved-account");
        select.replaceChildren();
        for (const account of accounts) {
            const option = document.createElement("option");
            option.value = account.accountId;
            option.textContent = `${account.name} (${account.accountId})`;
            select.append(option);
        }
        document.querySelector("#saved-accounts").hidden = !accounts.length || accountForm.hidden;
    } catch (error) {
        message.textContent = error.message;
    }
}
loadSavedAccounts();

document.querySelector("#saved-account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
        const response = await fetch("/client/saved-accounts/select", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: document.querySelector("#saved-account").value }),
        });
        if (!response.ok) throw new Error("Could not open saved account");
        sessionStorage.removeItem("pendingConsumption");
        window.location.reload();
    } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
    }
});
