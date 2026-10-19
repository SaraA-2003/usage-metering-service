import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

it("reuses the persisted request ID after a lost response and page reload", async () => {
  const storage = new Map<string, string>();
  const sent: unknown[] = [];
  const script = readFileSync("examples/web/public/app.js", "utf8");
  let loseResponse = true;
  function page() {
    const elements = new Map<string, any>();
    function element(id: string): any {
      if (!elements.has(id)) elements.set(id, {
        value: id === "#consumption-user" ? "user-1" : "2", textContent: "", options: [], children: [],
        listeners: {}, querySelector: () => ({ disabled: false }),
        addEventListener(name: string, callback: unknown) { this.listeners[name] = callback; },
        replaceChildren() {}, append() {},
      });
      return elements.get(id);
    }
    const fetch = async (url: string, options?: any) => {
      if (url === "/client/consumptions") {
        sent.push(JSON.parse(options.body));
        if (loseResponse) { loseResponse = false; throw new Error("Lost response"); }
        return { ok: true, json: async () => ({ outcome: { decision: "accepted" } }) };
      }
      if (url === "/client/session") return { status: 401 };
      if (url === "/client/plans/predefined" || url === "/client/saved-accounts") return { ok: true, json: async () => [] };
      if (url === "/client/account/usage") return { ok: true, json: async () => ({ plan: {} }) };
      return { ok: true, json: async () => ({ requests: [], offset: 0, hasMore: false, nextOffset: null }) };
    };
    vm.runInNewContext(script, {
      document: { querySelector: element, createElement: () => ({}) }, fetch,
      crypto: { randomUUID: () => `id-${Math.random()}` }, URLSearchParams,
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    return () => element("#consumption-form").listeners.submit({ preventDefault() {} });
  }
  await page()();
  expect(storage.has("pendingConsumption")).toBe(true);
  await page()();
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(storage.has("pendingConsumption")).toBe(false);
});
