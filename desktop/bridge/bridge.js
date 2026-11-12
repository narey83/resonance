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
  driveReport = null,
  reportPage = 0,
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
    if (feedback) message("#feedback", typeof feedback === "function" ? feedback() : feedback);
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
  const downloadPercent = transfer?.totalBytes
    ? Math.min(100, Math.floor((100 * (transfer.downloadedBytes || 0)) / transfer.totalBytes))
    : 0;
  const drive = drives.find((item) => item.id === $("#drive").value);
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
      downloading: "Loading export details from Resonance…",
      ready: "Export ready. Choose a USB drive to stream your set directly from Resonance.",
      writing: transfer.phase === "checking"
        ? "Checking existing playlists and USB tracks before writing…"
        : transfer.phase === "backing-up"
        ? "Backing up and verifying the player databases before writing to USB…"
        : `Streaming to USB: ${downloadPercent}% downloaded · ${transfer.prepared || 0} / ${transfer.total || 0} files verified`,
      completed: transfer.databaseBackup
        ? "Transfer complete. Original player databases backed up and verified. Safely eject USB before unplugging."
        : "Transfer complete. Choose Safely eject USB before unplugging.",
      ejected: "USB safely ejected. You can unplug the drive.",
      failed: transfer.error || "The transfer could not finish.",
    };
    $("#export-status").textContent =
      labels[transfer.status] || transfer.status;
    $("#export-progress").hidden = !["downloading", "writing"].includes(transfer.status);
    if (transfer.status === "downloading" || ["checking", "backing-up"].includes(transfer.phase)) {
      $("#export-progress").removeAttribute("value");
    } else {
      $("#export-progress").max = Math.max(1, transfer.totalBytes || 0);
      $("#export-progress").value = transfer.downloadedBytes || 0;
    }
  }
  $("#write").disabled =
    busy ||
    !paired() ||
    !transfer?.tracks ||
    !["ready", "completed", "failed", "ejected"].includes(transfer.status) ||
    !drive ||
    !(drive.contents === "empty" ||
      (drive.contents === "dual-library" && status?.platform === "darwin" && transfer.profile === "dual")) ||
    !$("#confirm").checked;
  $("#eject").disabled = busy || !paired() || !!active || !$("#drive").value;
  $("#format-drive").hidden = status?.platform !== "darwin";
  $("#format-drive").disabled = busy || !!active || !drive;
  $("#recover-drive").hidden = drive?.contents !== "recovery-needed";
  $("#recover-drive").disabled = busy || !!active || !drive;
  $("#cancel-transfer").hidden = !active;
  $("#cancel-transfer").disabled = busy;
  const saved = !!transfer && !active;
  $("#defer-export").hidden = !saved;
  $("#defer-export").disabled = busy;
  $("#cancel-export").hidden = !saved;
  $("#cancel-export").disabled = busy;
  for (const id of ["drive", "refresh-drives", "confirm", "handoff"])
    $("#" + id).disabled = busy || !!active;
  $("#drive-trigger").disabled = busy || !!active || !drives.length;
  if ($("#drive-trigger").disabled) closeDriveOptions();
  $("#receive").disabled = busy || !!active || !$("#handoff").files.length;
  const contents = {
    empty: "Empty drive, ready for a new export.",
    "classic-library": "Existing classic rekordbox library detected. Adding to a single-database drive is not yet supported.",
    "one-library": "Existing OneLibrary detected. Adding to a single-database drive is not yet supported.",
    "dual-library": status?.platform === "darwin" ? "Existing classic and OneLibrary databases detected. Bridge can add this dual-library set while preserving existing tracks and playlists." : "Existing classic and OneLibrary databases detected. Adding to them is currently available on Mac.",
    "recovery-needed": "An earlier export was interrupted. Recover the existing player databases before writing another set.",
    unsupported: "This USB filesystem cannot be used by Bridge. On Mac, format the disk as FAT32 to prepare it for export.",
    other: "Existing files detected. Bridge will not replace them.",
    unreadable: "Drive contents could not be checked. Writing is blocked.",
  };
  $("#destination").textContent = drive
    ? drive.path + " · " + drive.filesystem + " · " + (contents[drive.contents] || contents.unreadable)
    : "Mounted FAT32 and exFAT drives appear here.";
  const reportDrives = drives.filter((item) => ["classic-library", "dual-library"].includes(item.contents));
  const reportDrive = drive && reportDrives.some((item) => item.id === drive.id)
    ? drive
    : !drive && reportDrives.length === 1 ? reportDrives[0] : null;
  $("#inspect-drive").disabled = busy || !!active || !reportDrive;
  $("#inspect-hint").textContent = reportDrive
    ? "Read playlists, tracks and file checks from " + reportDrive.label + ". No export needed."
    : drive
      ? "This drive has no classic export database to inspect."
      : reportDrives.length > 1
        ? "Select a USB drive above to inspect its library."
        : "Connect a USB with a classic export database to view its report.";
  $("#confirmation").textContent = drive
    ? "I have checked " +
      drive.label +
      " at " +
      drive.path +
      (drive.contents === "dual-library" ? " and want to add this set to its player libraries." : " and want to copy this export.")
    : "I have checked the destination and want to copy this export.";
  $("#transfer-progress").textContent =
    transfer?.status === "writing"
      ? transfer.phase === "checking"
        ? "Resonance is checking existing playlists while Bridge checks that USB tracks are present."
        : transfer.phase === "backing-up"
        ? "The player databases are being copied off the USB and verified before any new files are written."
        : `${downloadPercent}% downloaded to USB · ${transfer.prepared || 0} / ${transfer.total || 0} files verified`
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
  driveReport = null;
  $("#usb-report").hidden = true;
  const select = $("#drive");
  select.replaceChildren(
    new Option(
      drives.length ? "Choose a USB drive" : "No supported USB drives found",
      "",
    ),
  );
  for (const drive of drives)
    select.append(new Option(drive.label + " · " + drive.filesystem, drive.id));
  const options = $("#drive-options");
  options.replaceChildren();
  for (const drive of drives) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "drive-option";
    option.setAttribute("role", "option");
    option.dataset.driveId = drive.id;
    option.textContent = drive.label + " · " + drive.filesystem;
    option.onclick = () => {
      select.value = drive.id;
      select.dispatchEvent(new Event("change"));
      closeDriveOptions();
      $("#drive-trigger").focus();
    };
    options.append(option);
  }
  closeDriveOptions();
  updateDrivePicker();
  $("#confirm").checked = false;
  renderUSB();
}
function updateDrivePicker() {
  const select = $("#drive");
  $("#drive-value").textContent = select.selectedOptions[0]?.textContent || "Choose a USB drive";
  for (const option of $("#drive-options").children)
    option.setAttribute("aria-selected", String(option.dataset.driveId === select.value));
}
function closeDriveOptions() {
  $("#drive-options").hidden = true;
  $("#drive-trigger").setAttribute("aria-expanded", "false");
}
function openDriveOptions() {
  if ($("#drive-trigger").disabled) return;
  $("#drive-options").hidden = false;
  $("#drive-trigger").setAttribute("aria-expanded", "true");
}
function renderDriveReport() {
  const report = driveReport;
  $("#usb-report").hidden = !report;
  if (!report) return;
  $("#report-title").textContent = report.label + " · USB library report";
  $("#report-subtitle").textContent =
    report.filesystem + " · Read from attached USB at " +
    new Date(report.generatedAt).toLocaleString();
  const playlists = report.playlists.filter((item) => !item.isFolder);
  $("#report-summary").textContent =
    report.tracks.length.toLocaleString() + (report.tracks.length === 1 ? " track" : " tracks") + " · " +
    playlists.length.toLocaleString() + (playlists.length === 1 ? " playlist" : " playlists") + " · " +
    report.audioIssues + " audio file issues · " +
    report.analysisIssues + " analysis file issues";
  const databases = $("#report-databases");
  databases.replaceChildren();
  for (const file of report.databases) {
    const item = document.createElement("span");
    item.className = "report-chip";
    item.textContent = file.name + " · " + (file.bytes / 1048576).toFixed(1) + " MiB";
    databases.append(item);
  }
  const notes = $("#report-notes");
  notes.replaceChildren();
  for (const note of report.notes) {
    const p = document.createElement("p");
    p.className = "field-hint";
    p.textContent = note;
    notes.append(p);
  }
  const list = $("#report-playlists");
  list.replaceChildren();
  const selector = $("#report-playlist");
  const current = selector.value;
  selector.replaceChildren(new Option("All tracks", ""));
  const names = new Map(report.playlists.map((item) => [item.id, item.name]));
  for (const item of report.playlists) {
    const label = (item.parentId && names.has(item.parentId) ? names.get(item.parentId) + " / " : "") + item.name;
    const row = document.createElement("div");
    row.textContent = label + (item.isFolder ? " · folder" : " · " + item.trackIds.length + " tracks");
    list.append(row);
    if (!item.isFolder) selector.append(new Option(label, String(item.id)));
  }
  selector.value = current;
  if (selector.selectedIndex < 0) selector.value = "";
  renderReportTracks();
}
function renderReportTracks() {
  if (!driveReport) return;
  const query = $("#report-search").value.trim().toLocaleLowerCase();
  const selected = driveReport.playlists.find((item) => String(item.id) === $("#report-playlist").value);
  const ids = selected ? new Set(selected.trackIds) : null;
  const tracks = driveReport.tracks.filter((track) =>
    (!ids || ids.has(track.id)) &&
    (!query || [track.id, track.title, track.artist, track.album, track.genre, track.key, track.audioPath]
      .some((value) => String(value).toLocaleLowerCase().includes(query))));
  const pages = Math.max(1, Math.ceil(tracks.length / 50));
  reportPage = Math.min(reportPage, pages - 1);
  $("#report-count").textContent = tracks.length.toLocaleString() +
    (tracks.length === 1 ? " matching track" : " matching tracks");
  $("#report-page").textContent = "Page " + (reportPage + 1) + " of " + pages;
  $("#report-prev").disabled = reportPage === 0;
  $("#report-next").disabled = reportPage + 1 >= pages;
  const body = $("#report-tracks");
  body.replaceChildren();
  for (const track of tracks.slice(reportPage * 50, (reportPage + 1) * 50)) {
    const row = document.createElement("tr");
    const cell = (value) => { const td = document.createElement("td"); td.textContent = String(value); row.append(td); return td; };
    cell(track.id);
    const title = cell(track.title || "Untitled");
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Full metadata";
    const metadata = document.createElement("p");
    metadata.textContent = [
      "Genre: " + track.genre, "Label: " + track.label, "Year: " + track.year,
      "Track/disc: " + track.trackNumber + "/" + track.discNumber,
      "Rating: " + track.rating, "Plays: " + track.playCount,
      "Bitrate: " + track.bitrate, "Sample: " + track.sampleDepth + " bit / " + track.sampleRate + " Hz",
      "Database size: " + track.databaseFileBytes + " bytes", "Comment: " + track.comment,
      "Audio: " + track.audioPath, "Analysis: " + track.analysisPath,
    ].join(" · ");
    details.append(summary, metadata);
    title.append(details);
    cell([track.artist, track.album].filter(Boolean).join(" · "));
    cell(track.bpm + " · " + track.key);
    cell(Math.floor(track.durationSeconds / 60) + ":" + String(track.durationSeconds % 60).padStart(2, "0"));
    const files = cell("Audio: " + track.audioStatus + " · Analysis: " + track.analysisStatus);
    if (track.audioStatus !== "present" || track.analysisStatus !== "present") files.className = "report-issue";
    body.append(row);
  }
}
$("#inspect-drive").onclick = async () => {
  const selected = $("#drive");
  const eligible = drives.filter((item) => ["classic-library", "dual-library"].includes(item.contents));
  if (!selected.value && eligible.length === 1) {
    selected.value = eligible[0].id;
    updateDrivePicker();
    renderUSB();
  }
  const id = selected.value;
  if (!id) return;
  $("#inspect-drive").disabled = true;
  $("#inspect-drive").textContent = "Reading USB library…";
  error("");
  try {
    const report = await request("usb/report?id=" + encodeURIComponent(id));
    if ($("#drive").value !== id) return;
    driveReport = report;
    reportPage = 0;
    $("#report-search").value = "";
    $("#report-playlist").value = "";
    renderDriveReport();
    $("#usb-report").scrollIntoView?.({ block: "start" });
  } catch (failure) { error(failure); }
  finally {
    $("#inspect-drive").textContent = "View USB library report";
    renderUSB();
  }
};
$("#report-refresh").onclick = () => $("#inspect-drive").click();
$("#report-search").oninput = () => { reportPage = 0; renderReportTracks(); };
$("#report-playlist").onchange = () => { reportPage = 0; renderReportTracks(); };
$("#report-prev").onclick = () => { reportPage--; renderReportTracks(); };
$("#report-next").onclick = () => { reportPage++; renderReportTracks(); };
$("#report-download").onclick = () => {
  if (!driveReport) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(driveReport, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "usb-library-" + driveReport.label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") + ".json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
$("#drive-trigger").onclick = () => {
  if ($("#drive-options").hidden) openDriveOptions();
  else closeDriveOptions();
};
$("#drive-trigger").onkeydown = (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  openDriveOptions();
  const options = $("#drive-options").children;
  if (options.length) options[event.key === "ArrowUp" || event.key === "End" ? options.length - 1 : 0].focus();
};
$("#drive-options").onkeydown = (event) => {
  if (event.key === "Escape") {
    closeDriveOptions();
    $("#drive-trigger").focus();
    return;
  }
  const options = [...$("#drive-options").children];
  const current = options.indexOf(document.activeElement);
  const next = event.key === "ArrowDown" ? current + 1 : event.key === "ArrowUp" ? current - 1 : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : -1;
  if (next < 0 && event.key !== "ArrowUp") return;
  event.preventDefault();
  options[Math.max(0, Math.min(options.length - 1, next))]?.focus();
};
document.addEventListener("click", (event) => {
  if (!event.target.closest(".drive-picker")) closeDriveOptions();
});
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
  updateDrivePicker();
  $("#confirm").checked = false;
  driveReport = null;
  $("#usb-report").hidden = true;
  renderUSB();
};
$("#confirm").onchange = renderUSB;
$("#refresh-drives").onclick = () => action(refreshDrives);
$("#format-drive").onclick = async () => {
  const drive = drives.find((item) => item.id === $("#drive").value);
  if (!drive) return;
  const phrase = "ERASE " + drive.label;
  const confirmation = window.prompt(
    "This will erase the USB disk containing “" + drive.label +
      "”. Bridge requires one partition and backs up player databases before erasing. Type " + phrase +
      " to confirm:",
  );
  if (confirmation === null) return;
  let databaseBackup = "";
  await action(async () => {
    const result = await request("usb/format", { id: drive.id, confirmation });
    databaseBackup = result.databaseBackup || "";
    await refreshDrives();
  }, () => databaseBackup
    ? "USB disk formatted as FAT32. Player database backup: " + databaseBackup
    : "USB disk formatted as FAT32. Choose the new volume to export.");
};
$("#recover-drive").onclick = () =>
  action(async () => {
    await request("usb/recover", { id: $("#drive").value });
    await refreshDrives();
  }, "Existing player databases recovered. Refresh and review the USB before exporting again.");
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
$("#defer-export").onclick = () =>
  action(() => request("usb/defer", {}), "Export saved in Resonance for later. Bridge released its copy.");
$("#cancel-export").onclick = () =>
  action(() => request("usb/cancel-job", {}), "Export cancelled in Resonance.");
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
  const handoff = page === "usb"
    ? new URLSearchParams(location.hash.slice(1)).get("handoff")
    : null;
  if (handoff) history.replaceState(null, "", location.pathname + location.search);
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
    if (handoff) {
      await action(async () => {
        if (handoff.length > 65536) throw Error("Invalid export handoff.");
        await request("usb/receive", JSON.parse(handoff));
      });
    }
    if (location.hash === "#eject") {
      $("#usb-drive-card").scrollIntoView?.({ block: "start" });
      $("#drive-trigger").focus();
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
