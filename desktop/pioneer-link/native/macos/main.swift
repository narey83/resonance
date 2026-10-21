// SPDX-License-Identifier: AGPL-3.0-only
import Cocoa

final class LinkApplication: NSObject, NSApplicationDelegate {
    private var engine: Process?
    private var receivedDocument = false
    private let dashboard = URL(string: "http://127.0.0.1:55460/")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            if !self.receivedDocument { self.ensureEngine { self.openDashboard() } }
        }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        ensureEngine { self.openDashboard() }
        return false
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func application(_ application: NSApplication, open urls: [URL]) {
        receivedDocument = true
        guard urls.count == 1, let file = urls.first else { return }
        do {
            let data = try Data(contentsOf: file)
            guard data.count <= 65536, (try JSONSerialization.jsonObject(with: data)) is [String:Any] else {
                throw NSError(domain: "Resonance", code: 1, userInfo: [NSLocalizedDescriptionKey:"Choose a Resonance connection file."])
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
                            self.showError(message ?? "Could not connect this library. Download a new connection file in Resonance."); return
                        }
                        let result = body.flatMap { try? JSONSerialization.jsonObject(with:$0) as? [String:Any] }
                        let path = result?["openPath"] as? String
                        NSWorkspace.shared.open(path == "/usb" ? self.dashboard.appendingPathComponent("usb") : self.dashboard)
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
                    process.executableURL = Bundle.main.executableURL!.deletingLastPathComponent().appendingPathComponent("resonance-pioneer-link-engine")
                    process.arguments = ["--no-open"]
                    process.terminationHandler = { _ in DispatchQueue.main.async { NSApplication.shared.terminate(nil) } }
                    do { try process.run(); self.engine = process } catch { self.showError("Could not start the helper: " + error.localizedDescription); return }
                }
                if attempt >= 30 { self.showError("The helper could not start. Check whether another program is using port 55460."); return }
                DispatchQueue.main.asyncAfter(deadline:.now() + 0.2) { self.ensureEngine(attempt:attempt+1,completion:completion) }
            }
        }.resume()
    }
    private func openDashboard() { NSWorkspace.shared.open(dashboard) }
    private func showError(_ message: String) {
        NSApplication.shared.activate(ignoringOtherApps:true)
        let alert = NSAlert();alert.messageText="Resonance Pioneer Link";alert.informativeText=message;alert.alertStyle = .warning;alert.runModal()
    }
}
let application = NSApplication.shared
let delegate = LinkApplication()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
