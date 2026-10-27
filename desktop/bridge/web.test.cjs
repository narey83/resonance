// SPDX-License-Identifier: AGPL-3.0-only
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(path.join(__dirname, "ui.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "bridge.js"), "utf8");
const pairing = {
  schemaVersion: 1,
  serverUrl: "https://music.example.test/resonance/api/v0/bridge/sync",
  token: "a".repeat(64),
  expires: "2030-01-01T00:00:00Z",
};
async function until(predicate) {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(predicate(), "UI did not reach the expected state");
}
function launch(t, page, options = {}) {
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:55460" + page,
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const w = dom.window,
    calls = [];
  let connected = options.paired ?? true,
    startup = false;
  const state = {
    version: "0.3.2",
    paired: connected,
    sync: connected
      ? {
          server: pairing.serverUrl,
          expires: pairing.expires,
          status: "Connected. Waiting for fully analysed tracks.",
          error: "",
        }
      : null,
    running: false,
    bundle: options.tracks
      ? { name: "Resonance Library", tracks: options.tracks }
      : null,
    devices: [],
    error: "",
  };
  const transfer = options.transfer || null;
  w.fetch = async (url, request = {}) => {
    const body = request.body ? JSON.parse(request.body) : null;
    calls.push({ url, method: request.method || "GET", body });
    let data;
    if (url === "/api/connect") {
      connected = true;
      state.paired = true;
      state.sync = {
        server: pairing.serverUrl,
        expires: pairing.expires,
        status: "Connected",
        error: "",
      };
      data = state;
    } else if (url === "/api/disconnect") {
      connected = false;
      state.paired = false;
      state.sync = null;
      data = state;
    } else if (url === "/api/status") data = state;
    else if (url === "/api/desktop")
      data = { startup, update: { version: "0.3.2", status: "Up to date" } };
    else if (url === "/api/desktop/startup") {
      startup = body.enabled;
      data = { enabled: startup };
    } else if (url === "/api/interfaces")
      data = [{ name: "Ethernet", ip: "192.168.1.2" }];
    else if (url === "/api/usb/status") data = { transfer };
    else if (url === "/api/usb/drives")
      data = [
        {
          id: "test-drive",
          path: "/media/Test USB",
          label: "Test USB",
          filesystem: "exfat",
        },
      ];
    else if (url === "/api/start") data = state;
    else if (url === "/api/usb/write") data = { writing: true };
    else throw Error("Unexpected endpoint " + url);
    return { ok: true, json: async () => JSON.parse(JSON.stringify(data)) };
  };
  w.eval(script);
  return { w, document: w.document, calls };
}
test("Settings owns pairing and locked navigation guides an unpaired user there", async (t) => {
  const { document: d, calls } = launch(t, "/settings", { paired: false });
  await until(() => d.querySelector("#version").textContent === "Bridge 0.3.2");
  assert.equal(
    d.querySelector("#connection").closest("[data-page]").dataset.page,
    "settings",
  );
  assert.equal(d.querySelector('[data-page="network"]').hidden, true);
  assert.equal(
    d.querySelector('[data-nav="usb"]').getAttribute("aria-disabled"),
    "true",
  );
  assert.equal(d.querySelector("#connect").disabled, true);
  assert.ok(
    !calls.some(
      (c) => c.url.startsWith("/api/usb") || c.url === "/api/interfaces",
    ),
  );
});
test("Importing one pairing unlocks both pages without exposing the credential", async (t) => {
  const { w, document: d } = launch(t, "/settings", { paired: false });
  await until(() => d.querySelector("#version").textContent === "Bridge 0.3.2");
  const input = d.querySelector("#connection");
  Object.defineProperty(input, "files", {
    value: [
      {
        name: "bridge.resonance",
        size: 200,
        text: async () => JSON.stringify(pairing),
      },
    ],
  });
  input.dispatchEvent(new w.Event("change"));
  assert.equal(d.querySelector("#connect").disabled, false);
  d.querySelector("#connect").click();
  await until(() => !d.querySelector("#paired-details").hidden);
  assert.equal(
    d.querySelector("#paired-host").textContent,
    "music.example.test",
  );
  assert.equal(
    d.querySelector('[data-nav="usb"]').getAttribute("href"),
    "/usb",
  );
  assert.equal(
    d.querySelector('[data-nav="network"]').getAttribute("href"),
    "/",
  );
  assert.ok(!d.body.textContent.includes(pairing.token));
  assert.match(d.querySelector("#feedback").textContent, /Pairing saved/);
});
test("Sign-in preference uses the newly selected value and is never changed just by opening Settings", async (t) => {
  const { w, document: d, calls } = launch(t, "/settings");
  await until(
    () => d.querySelector("#update-version").textContent === "v0.3.2",
  );
  assert.ok(!calls.some((c) => c.url === "/api/desktop/startup"));
  const toggle = d.querySelector("#startup");
  toggle.checked = true;
  toggle.dispatchEvent(new w.Event("change"));
  await until(() => calls.some((c) => c.url === "/api/desktop/startup"));
  assert.equal(
    calls.find((c) => c.url === "/api/desktop/startup").body.enabled,
    true,
  );
  await until(() => !toggle.disabled);
  assert.equal(toggle.checked, true);
});
test("Network Link waits for analysed tracks and a selected adapter", async (t) => {
  const empty = launch(t, "/");
  await until(
    () => empty.document.querySelector("#adapter").options.length === 2,
  );
  assert.equal(empty.document.querySelector("#start").disabled, true);
  const { w, document: d, calls } = launch(t, "/", { tracks: 15 });
  await until(() => d.querySelector("#adapter").options.length === 2);
  assert.equal(d.querySelector("#start").disabled, true);
  const adapter = d.querySelector("#adapter");
  adapter.selectedIndex = 1;
  adapter.dispatchEvent(new w.Event("change"));
  assert.equal(d.querySelector("#start").disabled, false);
  d.querySelector("#start").click();
  await until(() => calls.some((c) => c.url === "/api/start"));
  assert.deepEqual(calls.find((c) => c.url === "/api/start").body, {
    interface: "Ethernet",
    ip: "192.168.1.2",
  });
  await until(() => !d.querySelector("#start").disabled);
});
test("USB Export uses the paired instance and requires destination confirmation", async (t) => {
  const {
    w,
    document: d,
    calls,
  } = launch(t, "/usb", {
    transfer: { name: "Test set", tracks: 15, status: "ready" },
  });
  await until(() => d.querySelector("#drive").options.length === 2);
  assert.equal(
    d.querySelector("#open-resonance").href,
    "https://music.example.test/resonance/export",
  );
  assert.equal(d.querySelector("#write").disabled, true);
  const drive = d.querySelector("#drive");
  drive.value = "test-drive";
  drive.dispatchEvent(new w.Event("change"));
  assert.equal(d.querySelector("#write").disabled, true);
  const confirm = d.querySelector("#confirm");
  confirm.checked = true;
  confirm.dispatchEvent(new w.Event("change"));
  assert.equal(d.querySelector("#write").disabled, false);
  d.querySelector("#write").click();
  await until(() => calls.some((c) => c.url === "/api/usb/write"));
  assert.deepEqual(calls.find((c) => c.url === "/api/usb/write").body, {
    id: "test-drive",
    confirm: true,
  });
  await until(() => !d.querySelector("#write").disabled);
});
