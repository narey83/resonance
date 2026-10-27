// SPDX-License-Identifier: AGPL-3.0-only
import Cocoa

final class LinkApplication: NSObject, NSApplicationDelegate {
    private var engine: Process?
    private var receivedDocument = false
    private var statusItem: NSStatusItem?
    private var statusMenu: NSMenuItem!
    private var updateMenu: NSMenuItem!
    private var startupMenu: NSMenuItem!
    private var statusTimer: Timer?
    private let dashboard = URL(string: "http://127.0.0.1:55460/")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "Resonance Bridge")
        let menu = NSMenu()
        statusMenu = menu.addItem(withTitle: "Resonance Bridge", action: nil, keyEquivalent: "")
        menu.addItem(withTitle: "Open dashboard", action: #selector(showDashboard), keyEquivalent: "")
        menu.addItem(withTitle: "USB export", action: #selector(showUSB), keyEquivalent: "")
        menu.addItem(withTitle: "Bridge settings…", action: #selector(showSettings), keyEquivalent: ",")
        menu.addItem(NSMenuItem.separator())
        updateMenu = menu.addItem(withTitle: "Checking update status…", action: nil, keyEquivalent: "")
        menu.addItem(withTitle: "Check for updates", action: #selector(checkUpdates), keyEquivalent: "")
        startupMenu = menu.addItem(withTitle: "Start at sign-in", action: #selector(toggleStartup), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Quit Resonance Bridge", action: #selector(quitHelper), keyEquivalent: "q")
        for entry in menu.items { entry.target = self }
        item.menu = menu; statusItem = item
        statusTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in self.refreshStatus() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            if !self.receivedDocument {
                self.ensureEngine {
                    self.refreshStatus()
                    if !CommandLine.arguments.contains("--no-open") { self.openDashboard() }
                }
            }
        }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        ensureEngine { self.openDashboard() }
        return false
    }
    func applicationWillTerminate(_ notification: Notification) {
        statusTimer?.invalidate()
        if let engine = engine, engine.isRunning { engine.terminate() }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func application(_ application: NSApplication, open urls: [URL]) {
        receivedDocument = true
        guard urls.count == 1, let file = urls.first else { return }
        do {
            let data = try Data(contentsOf: file)
            guard data.count <= 65536, (try JSONSerialization.jsonObject(with: data)) is [String:Any] else {
                throw NSError(domain: "Resonance", code: 1, userInfo: [NSLocalizedDescriptionKey:"Choose a Bridge pairing or export action file."])
            }
            ensureEngine {
                var request = URLRequest(url: self.dashboard.appendingPathComponent("api/handoff"))
                request.httpMethod = "POST"; request.httpBody = data
                request.setValue("application/json", forHTTPHeaderField:"Content-Type")
                request.setValue("1", forHTTPHeaderField:"X-Resonance-Link")
                URLSession.shared.dataTask(with: request) { body, response, error in
                    DispatchQueue.main.async {
                        if let error = error { self.showError(error.localizedDescription); return }
                        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                            let message = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String:Any] }?["error"] as? String
                            self.showError(message ?? "Could not open this Bridge file. Check pairing in Bridge Settings."); return
                        }
                        let result = body.flatMap { try? JSONSerialization.jsonObject(with:$0) as? [String:Any] }
                        let path = result?["openPath"] as? String
                        let destination = ["/usb", "/settings"].contains(path ?? "") ? self.dashboard.appendingPathComponent(String(path!.dropFirst())) : self.dashboard
                        NSWorkspace.shared.open(destination)
                    }
                }.resume()
            }
        } catch { showError(error.localizedDescription) }
    }
    private func ensureEngine(attempt: Int = 0, completion: @escaping () -> Void) {
        var request = URLRequest(url: dashboard.appendingPathComponent("api/status")); request.timeoutInterval = 0.5
        URLSession.shared.dataTask(with: request) { body, response, _ in
            DispatchQueue.main.async {
                if let body = body, let status = try? JSONSerialization.jsonObject(with:body) as? [String:Any], status["application"] as? String == "resonance-pioneer-link" { completion(); return }
                if self.engine == nil {
                    let process = Process()
                    process.executableURL = Bundle.main.executableURL!.deletingLastPathComponent().appendingPathComponent("resonance-bridge-engine")
                    process.arguments = ["--no-open"]
                    var environment = ProcessInfo.processInfo.environment
                    environment["RESONANCE_HELPER_APP"] = Bundle.main.bundleURL.path
                    process.environment = environment
                    process.terminationHandler = { _ in DispatchQueue.main.async { NSApplication.shared.terminate(nil) } }
                    do { try process.run(); self.engine = process } catch { self.showError("Could not start the helper: " + error.localizedDescription); return }
                }
                if attempt >= 30 { self.showError("The helper could not start. Check whether another program is using port 55460."); return }
                DispatchQueue.main.asyncAfter(deadline:.now() + 0.2) { self.ensureEngine(attempt:attempt+1,completion:completion) }
            }
        }.resume()
    }
    @objc private func showDashboard() { ensureEngine { self.openDashboard() } }
    @objc private func showSettings() { ensureEngine { NSWorkspace.shared.open(self.dashboard.appendingPathComponent("settings")) } }
    @objc private func showUSB() { ensureEngine { NSWorkspace.shared.open(self.dashboard.appendingPathComponent("usb")) } }
    @objc private func checkUpdates() { action("api/desktop/check-update") }
    @objc private func toggleStartup() {
        let enabled = startupMenu.state != .on
        action("api/desktop/startup", body: ["enabled": enabled])
    }
    @objc private func quitHelper() {
        action("api/quit") { NSApplication.shared.terminate(nil) }
    }
    private func action(_ path: String, body: [String: Any]? = nil, completion: (() -> Void)? = nil) {
        var request = URLRequest(url: dashboard.appendingPathComponent(path)); request.httpMethod = "POST"; request.timeoutInterval = 5
        request.setValue("1", forHTTPHeaderField: "X-Resonance-Link")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body = body { request.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                guard error == nil, let code = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(code) else {
                    self.showError(error?.localizedDescription ?? "The helper could not complete that action."); return
                }
                self.refreshStatus(); completion?()
            }
        }.resume()
    }
    private func refreshStatus() {
        var request = URLRequest(url: dashboard.appendingPathComponent("api/desktop")); request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data = data, let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            DispatchQueue.main.async {
                let update = value["update"] as? [String: Any]
                let state = value["running"] as? Bool == true ? "Network Link active" : (value["busy"] as? Bool == true ? "Busy" : "Idle")
                self.statusMenu.title = "Resonance Bridge · " + state
                self.statusMenu.toolTip = "Version " + (update?["version"] as? String ?? "")
                let status = update?["status"] as? String ?? "Update status unavailable"
                let error = update?["error"] as? String
                self.updateMenu.title = status
                self.updateMenu.toolTip = error
                self.startupMenu.state = value["startup"] as? Bool == true ? .on : .off
                self.startupMenu.toolTip = value["startupError"] as? String
            }
        }.resume()
    }
    private func openDashboard() { NSWorkspace.shared.open(dashboard) }
    private func showError(_ message: String) {
        NSApplication.shared.activate(ignoringOtherApps:true)
        let alert = NSAlert();alert.messageText="Resonance Bridge";alert.informativeText=message;alert.alertStyle = .warning;alert.runModal()
    }
}
let application = NSApplication.shared
let delegate = LinkApplication()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
