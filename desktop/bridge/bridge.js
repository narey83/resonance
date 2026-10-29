// SPDX-License-Identifier: AGPL-3.0-only
"use strict";
const $ = (selector) => document.querySelector(selector);
const page =
  location.pathname === "/settings"
    ? "settings"
    : location.pathname === "/usb"
      ? "usb"
      : "network";
const titles = {
  network: [
    "Network Link",
    "Your analysed library, ready for the players beside you.",
  ],
  usb: ["USB Export", "Take a prepared set from Resonance to your USB drive."],
  settings: ["Bridge settings", "One connection for your desktop workspace."],
};
let status = null,
  desktop = null,
  transfer = null,
  drives = [],
  busy = false,
  refreshing = false,
  pollFailed = false,
  previousPairing = null;
const themeLabels = {
  light: "Daylight",
  amoled: "AMOLED",
  midnight: "Midnight",
  violet: "Ultraviolet",
  ember: "Ember",
};
const knownTheme = (value) =>
  Object.prototype.hasOwnProperty.call(themeLabels, value);
const themeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
let themeChoice = "resonance";
try {
  const saved = localStorage.getItem("resonance-bridge-appearance");
  if (saved === "system" || saved === "resonance" || knownTheme(saved))
    themeChoice = saved;
} catch {
  /* Storage may be unavailable in private browser sessions. */
}
function applyAppearance() {
  const remoteTheme = status?.paired ? status.sync?.theme : null;
  const remote =
    knownTheme(remoteTheme) || remoteTheme === "system" ? remoteTheme : null;
  const selected = themeChoice === "resonance" ? remote : themeChoice;
  const effective = knownTheme(selected)
    ? selected
    : themeQuery?.matches
      ? "amoled"
      : "light";
  document.documentElement.dataset.theme = effective;
  for (const button of document.querySelectorAll("[data-theme-choice]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.themeChoice === themeChoice),
    );
  const label = themeLabels[effective];
  $("#theme-status").textContent =
    themeChoice === "resonance"
      ? remote
        ? "Following Resonance · " +
          label +
          ". Remembers this look while offline."
        : "Following your system · " +
          label +
          ". Pair to match Resonance automatically."
      : (themeChoice === "system"
          ? "Following your system · "
          : "Just for Bridge · ") + label;
}
for (const button of document.querySelectorAll("[data-theme-choice]"))
  button.onclick = () => {
    themeChoice = button.dataset.themeChoice;
    try {
      localStorage.setItem("resonance-bridge-appearance", themeChoice);
    } catch {
      /* Optional cache. */
    }
    applyAppearance();
  };
themeQuery?.addEventListener?.("change", applyAppearance);
window.addEventListener("storage", (event) => {
  if (event.key !== "resonance-bridge-appearance") return;
  const choice = event.newValue;
  themeChoice =
    choice === "system" || knownTheme(choice) ? choice : "resonance";
  applyAppearance();
});
applyAppearance();
const paths = {
  network: [
    "M8 16a6 6 0 0 1 0-8",
    "M5 19a10 10 0 0 1 0-14",
    "M16 8a6 6 0 0 1 0 8",
    "M19 5a10 10 0 0 1 0 14",
    "M12 12h.01",
  ],
  usb: [
    "M12 3v13a4 4 0 0 1-4 4",
    "m9 6 3-3 3 3",
    "M12 13h5V8",
    "M8 20H5v-3h3z",
    "M15 5h4v3h-4z",
  ],
  settings: [
    "M9 4h6l1 3 3 1 1 4-2 3 0 3-4 2-3-2-3 0-2-4 2-3 0-3 3-1z",
    "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  ],
  library: ["M4 4h4v16H4z", "M11 4h3v16h-3z", "m17 4 3-1 4 16-3 1z"],
  link: [
    "m9 15 6-6",
    "M8 16H6a4 4 0 0 1-3-7l4-4a4 4 0 0 1 6 0",
    "M16 8h2a4 4 0 0 1 3 7l-4 4a4 4 0 0 1-6 0",
  ],
  server: [
    "M4 4h16v6H4z",
    "M4 14h16v6H4z",
    "M7 7h.01",
    "M7 17h.01",
    "M16 7h2",
    "M16 17h2",
  ],
  file: ["M14 3H5v18h14V8z", "M14 3v6h5", "M8 13h8", "M8 17h5"],
  refresh: [
    "M20 7v5h-5",
    "M4 17v-5h5",
    "M6 7a7 7 0 0 1 12-1l2 3",
    "M18 17a7 7 0 0 1-12 1l-2-3",
  ],
  play: ["m9 5 11 7-11 7z"],
  music: [
    "M9 18V5l11-2v13",
    "M9 5v4l11-2",
    "M9 18a3 2 0 1 1-6 0 3 2 0 0 1 6 0",
    "M20 16a3 2 0 1 1-6 0 3 2 0 0 1 6 0",
  ],
  power: ["M12 3v9", "M6 5a9 9 0 1 0 12 0"],
  shield: ["m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z", "m8 12 3 3 5-6"],
  info: ["M12 10v7", "M12 7h.01", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M4 16v5h16v-5"],
};
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const value of paths[name] || paths.info) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", value);
    svg.append(path);
  }
  return svg;
}
for (const item of document.querySelectorAll("[data-icon]"))
  item.append(icon(item.dataset.icon));
$('[data-page="' + page + '"]').hidden = false;
$("#page-title").textContent = titles[page][0];
$("#page-description").textContent = titles[page][1];
document.title = "Resonance Bridge · " + titles[page][0];
$('[data-nav="' + page + '"]').setAttribute("aria-current", "page");
function message(selector, text) {
  const element = $(selector);
  element.textContent = text || "";
  element.hidden = !text;
}
function error(failure) {
  message("#error", failure?.message || failure || "");
}
async function request(path, body) {
  const options =
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "X-Resonance-Link": "1",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        };
  const response = await fetch("/api/" + path, options);
  const data = await response.json().catch(() => ({
    error: "Bridge is temporarily unavailable. Please retry.",
  }));
  if (!response.ok)
    throw Error(data.error || "Bridge could not complete this request.");
  return data;
}
async function action(operation, feedback) {
  busy = true;
  render();
  error("");
  message("#feedback", "");
  try {
    await operation();
    await refresh();
    if (feedback) message("#feedback", feedback);
  } catch (failure) {
    error(failure);
  } finally {
    busy = false;
    render();
  }
}
function instanceURL() {
  if (!status?.sync?.server) return null;
  const url = new URL(status.sync.server);
  const at = url.pathname.lastIndexOf("/api/");
  return url.origin + (at < 0 ? "" : url.pathname.slice(0, at));
}
function paired() {
  return !!status?.paired;
}
function renderCommon() {
  const connected = paired();
  const url = instanceURL();
  $("#instance-name").textContent =
    connected && url ? new URL(url).host : "Not paired";
  $("#instance-caption").textContent = connected
    ? "Pairing saved on this device"
    : "Set up in Settings";
  $("#instance-dot").classList.toggle("connected", connected);
  const badge = $("#connection-badge");
  badge.classList.toggle("connected", connected);
  badge.replaceChildren();
  const dot = document.createElement("span");
  dot.className = "status-dot" + (connected ? " connected" : "");
  badge.append(
    dot,
    document.createTextNode(connected ? "Paired" : "Not paired"),
  );
  $("#version").textContent = "Bridge " + (status?.version || "");
  for (const link of document.querySelectorAll(
    '[data-nav]:not([data-nav="settings"])',
  )) {
    const target = link.dataset.nav === "usb" ? "/usb" : "/";
    link.href = connected
      ? target
      : "/settings?next=" + encodeURIComponent(target);
    link.setAttribute("aria-disabled", String(!connected));
    link.querySelector(".nav-lock").textContent = connected ? "" : "·";
  }
  if (page !== "settings" && status && !connected) {
    location.replace("/settings?next=" + encodeURIComponent(location.pathname));
    return;
  }
}
function renderSettings() {
  const connected = paired();
  if (previousPairing !== connected) {
    $("#pairing-upload").open = !connected;
    previousPairing = connected;
  }
  $("#pairing-upload-label").hidden = !connected;
  const changingBlocked =
    !!status?.running || ["downloading", "writing"].includes(status?.usbStatus);
  $("#pairing-empty").hidden = connected;
  $("#paired-details").hidden = !connected;
  if (status?.sync && !connected) {
    $("#pairing-empty p").textContent =
      status.sync.error ||
      "This pairing has expired. Choose a new Bridge pairing file from Resonance.";
  }
  $("#pairing-label").textContent = connected ? "CONNECTED" : "SETUP";
  $("#disconnect").hidden = !status?.sync;
  $("#disconnect").disabled =
    busy ||
    !!status?.running ||
    ["downloading", "writing"].includes(status?.usbStatus);
  $("#connect").textContent = connected
    ? "Replace pairing"
    : "Pair this device";
  $("#connect").disabled =
    busy || !$("#connection").files.length || changingBlocked;
  $("#connection").disabled = busy || changingBlocked;
  if (connected) {
    const url = instanceURL();
    $("#paired-host").textContent = new URL(url).host;
    $("#paired-address").textContent = url;
    const expires = new Date(status.sync.expires);
    $("#pairing-expiry").textContent = Number.isNaN(expires.getTime())
      ? "Pairing saved"
      : "Paired until " +
        expires.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
    $("#pairing-health").textContent = status.sync.error || status.sync.status;
  }
  if (desktop) {
    $("#startup").checked = desktop.startup;
    $("#startup").disabled = busy;
    $("#startup-error").textContent = desktop.startupError || "";
    $("#update-version").textContent = "v" + desktop.update.version;
    $("#update-status").textContent = desktop.update.status;
    $("#update-error").textContent = desktop.update.error || "";
  }
  $("#check-update").disabled = busy || !connected;
  $("#diagnostics").disabled = busy;
}
function renderNetwork() {
  if (!status) return;
  const running = status.running;
  $("#collection-title").textContent = status.bundle
    ? status.bundle.tracks.toLocaleString() +
      " fully analysed tracks on this device"
    : "Your analysed library";
  $("#sync-state").textContent =
    status.sync?.error ||
    status.sync?.status ||
    "Pair Bridge in Settings to sync your library.";
  $("#adapter").disabled = busy || running;
  $("#start").disabled =
    busy ||
    running ||
    !paired() ||
    !status.bundle?.tracks ||
    !$("#adapter").value;
  $("#start").hidden = running;
  $("#stop").hidden = !running;
  $("#stop").disabled = busy;
  $("#sharing-dot").classList.toggle("connected", running);
  $("#network-state").textContent = running
    ? "Sharing on " + status.adapter.name + " · " + status.adapter.ip
    : "Sharing is off · only start when you’re ready";
  const list = $("#devices");
  list.replaceChildren();
  for (const device of status.devices || []) {
    const row = document.createElement("div");
    row.className = "device";
    const mark = document.createElement("span");
    mark.className = "icon";
    mark.append(icon("network"));
    const text = document.createElement("div"),
      name = document.createElement("strong"),
      detail = document.createElement("p");
    name.textContent = device.name;
    detail.textContent =
      device.kind + " · " + device.ip + " · Player " + device.number;
    text.append(name, detail);
    const dot = document.createElement("span");
    dot.className = "status-dot connected";
    row.append(mark, text, dot);
    list.append(row);
  }
  if (!status.devices?.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const mark = document.createElement("span");
    mark.className = "empty-icon icon";
    mark.append(icon("network"));
    const heading = document.createElement("h3"),
      text = document.createElement("p");
    heading.textContent = running
      ? "Listening for your players"
      : "Ready when your decks are";
    text.textContent = running
      ? "No players detected yet. Check the network adapter, cables and firewall."
      : "Start Network Link to discover compatible players on the selected network.";
    empty.append(mark, heading, text);
    list.append(empty);
  }
}
function renderUSB() {
  const active =
    transfer && ["downloading", "writing"].includes(transfer.status);
  $("#export-empty").hidden = !!transfer;
  $("#export-summary").hidden = !transfer;
  const url = instanceURL();
  if (url) $("#open-resonance").href = url + "/export";
  if (transfer) {
    $("#export-name").textContent = transfer.name || "Preparing your export";
    $("#export-tracks").textContent = transfer.tracks
      ? transfer.tracks.toLocaleString() + " fully analysed tracks"
      : "";
    const labels = {
      downloading: "Downloading and verifying your export…",
      ready: "Export verified. Choose a destination to copy your set.",
      writing: "Writing and verifying files on your USB drive…",
      completed:
        "Transfer complete. Choose Safely eject USB before unplugging.",
      ejected: "USB safely ejected. You can unplug the drive.",
      failed: transfer.error || "The transfer could not finish.",
    };
    $("#export-status").textContent =
      labels[transfer.status] || transfer.status;
    $("#export-progress").hidden = transfer.status !== "writing";
    $("#export-progress").max = Math.max(1, transfer.total || 0);
    $("#export-progress").value = transfer.prepared || 0;
  }
  $("#write").disabled =
    busy ||
    !paired() ||
    !transfer?.tracks ||
    !["ready", "completed", "failed", "ejected"].includes(transfer.status) ||
    !$("#drive").value ||
    !$("#confirm").checked;
  $("#eject").disabled = busy || !paired() || !!active || !$("#drive").value;
  $("#cancel-transfer").hidden = !active;
  $("#cancel-transfer").disabled = busy;
  for (const id of ["drive", "refresh-drives", "confirm", "handoff"])
    $("#" + id).disabled = busy || !!active;
  $("#receive").disabled = busy || !!active || !$("#handoff").files.length;
  const drive = drives.find((item) => item.id === $("#drive").value);
  $("#destination").textContent = drive
    ? drive.path + " · " + drive.filesystem
    : "Mounted FAT32 and exFAT drives appear here.";
  $("#confirmation").textContent = drive
    ? "I have checked " +
      drive.label +
      " at " +
      drive.path +
      " and want to copy this export."
    : "I have checked the destination and want to copy this export.";
  $("#transfer-progress").textContent =
    transfer?.status === "writing"
      ? transfer.prepared + " / " + transfer.total + " files verified"
      : transfer?.status === "ejected"
        ? "USB safely ejected. You can unplug the drive."
        : "After verification, safely eject the selected USB drive before unplugging it.";
}
function render() {
  applyAppearance();
  renderCommon();
  if (page === "settings") renderSettings();
  if (page === "network") renderNetwork();
  if (page === "usb") renderUSB();
}
async function refresh() {
  status = await request("status");
  if (page === "settings") desktop = await request("desktop");
  if (page === "usb" && paired())
    transfer = (await request("usb/status")).transfer;
  render();
}
async function refreshDrives() {
  drives = await request("usb/drives");
  const select = $("#drive");
  select.replaceChildren(
    new Option(
      drives.length ? "Choose a USB drive" : "No supported USB drives found",
      "",
    ),
  );
  for (const drive of drives)
    select.append(new Option(drive.label + " · " + drive.filesystem, drive.id));
  $("#confirm").checked = false;
  renderUSB();
}
$("#connection").onchange = () => {
  $("#connection-file-name").textContent =
    $("#connection").files[0]?.name || "Choose pairing file";
  renderSettings();
};
$("#connect").onclick = () =>
  action(async () => {
    const file = $("#connection").files[0];
    if (!file || file.size > 65536)
      throw Error("Choose a valid Bridge pairing file.");
    await request("connect", JSON.parse(await file.text()));
    $("#pairing-upload").open = false;
    $("#connection").value = "";
    $("#connection-file-name").textContent = "Choose pairing file";
  }, "Pairing saved. Network Link and USB Export are now available.");
$("#disconnect").onclick = () =>
  action(
    () => request("disconnect", {}),
    "Pairing forgotten on this device. You can pair again whenever you’re ready.",
  );
$("#startup").onchange = () => {
  const enabled = $("#startup").checked;
  return action(() => request("desktop/startup", { enabled }));
};
$("#check-update").onclick = () =>
  action(
    () => request("desktop/check-update", {}),
    "Checking for verified updates. Installation waits until Bridge is idle.",
  );
$("#adapter").onchange = renderNetwork;
$("#start").onclick = () =>
  action(() => {
    const adapter = JSON.parse($("#adapter").value);
    return request("start", { interface: adapter.name, ip: adapter.ip });
  });
$("#stop").onclick = () => action(() => request("stop", {}));
$("#drive").onchange = () => {
  $("#confirm").checked = false;
  renderUSB();
};
$("#confirm").onchange = renderUSB;
$("#refresh-drives").onclick = () => action(refreshDrives);
$("#handoff").onchange = () => {
  $("#handoff-name").textContent =
    $("#handoff").files[0]?.name || "Choose export file";
  renderUSB();
};
$("#receive").onclick = () =>
  action(async () => {
    const file = $("#handoff").files[0];
    if (!file || file.size > 65536)
      throw Error("Choose a valid USB export action file.");
    await request("usb/receive", JSON.parse(await file.text()));
    $("#handoff").value = "";
    $("#handoff-name").textContent = "Choose export file";
  });
$("#write").onclick = () =>
  action(() =>
    request("usb/write", {
      id: $("#drive").value,
      confirm: $("#confirm").checked,
    }),
  );
$("#eject").onclick = () =>
  action(async () => {
    const id = $("#drive").value;
    if (!id) throw Error("Choose a USB drive to eject.");
    try {
      await request("usb/eject", { id });
    } catch (failure) {
      try {
        await refreshDrives();
      } catch {
        /* Preserve the eject failure. */
      }
      throw failure;
    }
    await refreshDrives();
  }, "USB safely ejected. You can unplug the drive.");
$("#cancel-transfer").onclick = () => action(() => request("usb/cancel", {}));
$("#quit").onclick = () => action(() => request("quit", {}));
$("#diagnostics").onclick = () =>
  action(async () => {
    const response = await fetch("/api/diagnostics", {
      method: "POST",
      headers: { "X-Resonance-Link": "1" },
    });
    if (!response.ok) throw Error("Could not save the diagnostic report.");
    const url = URL.createObjectURL(await response.blob()),
      link = document.createElement("a");
    link.href = url;
    link.download = "resonance-bridge-diagnostics.zip";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
(async () => {
  await refresh();
  if (page === "network" && paired()) {
    const adapters = await request("interfaces");
    $("#adapter").replaceChildren(new Option("Choose a network adapter", ""));
    for (const adapter of adapters)
      $("#adapter").append(
        new Option(
          adapter.name +
            " · " +
            adapter.ip +
            (adapter.testOnly ? " · Test only" : ""),
          JSON.stringify(adapter),
        ),
      );
    renderNetwork();
  }
  if (page === "usb" && paired()) {
    await refreshDrives();
    if (location.hash === "#eject") {
      $("#usb-drive-card").scrollIntoView?.({ block: "start" });
      $("#drive").focus();
    }
  }
  if (status.error) error(status.error);
})().catch(error);
setInterval(async () => {
  if (busy || refreshing) return;
  refreshing = true;
  try {
    await refresh();
    if (pollFailed) {
      error("");
      pollFailed = false;
    }
  } catch (failure) {
    pollFailed = true;
    error("Bridge is temporarily unavailable. Reconnecting…");
  } finally {
    refreshing = false;
  }
}, 3000);
