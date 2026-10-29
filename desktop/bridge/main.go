// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/vynulldev/vynull/dbserver"
	"github.com/vynulldev/vynull/device"
	"github.com/vynulldev/vynull/nfs"
	"github.com/vynulldev/vynull/pdb"
	"github.com/vynulldev/vynull/proto"
)

//go:embed ui.html
var dashboard []byte

//go:embed bridge.css
var bridgeStyles []byte

//go:embed assets/favicon.svg
var bridgeFavicon []byte

//go:embed themes.css
var bridgeThemeStyles []byte

//go:embed bridge.js
var bridgeScript []byte

type adapter struct {
	Name      string `json:"name"`
	IP        string `json:"ip"`
	Network   string `json:"network"`
	Broadcast string `json:"broadcast"`
	MAC       string `json:"mac"`
	TestOnly  bool   `json:"testOnly"`
}

func adapters(allowLoopback bool) []adapter {
	result := []adapter{}
	list, _ := net.Interfaces()
	for _, i := range list {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagPointToPoint != 0 {
			continue
		}
		loop := i.Flags&net.FlagLoopback != 0
		if loop && !allowLoopback {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			ip, n, e := net.ParseCIDR(a.String())
			if e != nil || ip.To4() == nil {
				continue
			}
			v := ip.To4()
			broadcast := make(net.IP, 4)
			for j := 0; j < 4; j++ {
				broadcast[j] = v[j] | ^n.Mask[j]
			}
			if loop {
				broadcast = net.IPv4(127, 0, 0, 2)
			}
			result = append(result, adapter{Name: i.Name, IP: v.String(), Network: n.String(), Broadcast: broadcast.String(), MAC: i.HardwareAddr.String(), TestOnly: loop})
		}
	}
	return result
}

type session struct {
	Adapter adapter
	Device  *device.VirtualDevice
	DB      *dbserver.Server
	Cancel  context.CancelFunc
	Done    chan struct{}
}
type helper struct {
	usbDevices       usbDeviceManager
	USB              *usbTransfer
	Sync             *synchronization
	mu               sync.Mutex
	operation        sync.Mutex
	Library          *bundle
	Session          *session
	Error            string
	PairingDirectory string
	Cache            string
	AllowLoopback    bool
	Diagnostics      *bridgeDiagnostics
	Updates          *updater
	SyncActive       int
	Updating         bool
	RestartForUpdate bool
	StartupError     string
	Shutdown         context.CancelFunc
}

func (h *helper) snapshot() any {
	h.mu.Lock()
	defer h.mu.Unlock()
	peers := []map[string]any{}
	var a *adapter
	running := h.Session != nil
	if running {
		a = &h.Session.Adapter
		for _, p := range h.Session.Device.Peers.Peers() {
			peers = append(peers, map[string]any{"name": p.Name, "ip": p.IP.String(), "number": p.DeviceNumber, "kind": p.DeviceType.String(), "lastSeen": p.LastSeen})
		}
	}
	var syncView any
	if h.Sync != nil {
		syncView = map[string]any{"server": h.Sync.Connection.ServerURL, "status": h.Sync.Status, "error": h.Sync.Error, "updated": h.Sync.Updated, "expires": h.Sync.Connection.Expires, "theme": h.Sync.Theme}
	}
	usbStatus := ""
	if h.USB != nil {
		usbStatus = h.USB.Status
	}
	return map[string]any{"paired": h.pairedLocked(), "usbStatus": usbStatus, "name": "Resonance Bridge", "version": helperVersion, "application": "resonance-bridge", "sync": syncView, "running": running, "bundle": h.Library, "adapter": a, "devices": peers, "error": h.Error, "experimental": true, "hardwareValidated": false}
}
func (h *helper) stop() error {
	h.mu.Lock()
	s := h.Session
	if s == nil {
		h.mu.Unlock()
		return nil
	}
	h.mu.Unlock()
	s.Device.SetLinked(false)
	s.DB.Unlink()
	s.Cancel()
	select {
	case <-s.Done:
	case <-time.After(4 * time.Second):
		return errors.New("network session is still closing; try again shortly")
	}
	h.mu.Lock()
	if h.Session == s {
		h.Session = nil
	}
	h.mu.Unlock()
	return nil
}
func probePorts(host, discoveryHost string) error {
	var closers []io.Closer
	defer func() {
		for _, c := range closers {
			c.Close()
		}
	}()
	for _, p := range []int{50111, 38251, 2049, 50000, 50001, 50002} {
		bind := host
		if p >= 50000 && p <= 50002 {
			bind = discoveryHost
		}
		c, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP(bind), Port: p})
		if e != nil {
			return fmt.Errorf("UDP port %d is unavailable; close rekordbox Link Export or the conflicting service: %w", p, e)
		}
		closers = append(closers, c)
	}
	for _, p := range []int{12523, 2049} {
		c, e := net.Listen("tcp4", net.JoinHostPort(host, fmt.Sprint(p)))
		if e != nil {
			return fmt.Errorf("TCP port %d is unavailable: %w", p, e)
		}
		closers = append(closers, c)
	}
	return nil
}
func (h *helper) start(interfaceName, ipText string) (result error) {
	defer func() {
		level := "info"
		detail := ""
		if result != nil {
			level = "warning"
			detail = result.Error()
		}
		h.Diagnostics.event(level, "network.start", map[string]any{"interface": interfaceName, "ip": ipText, "error": detail})
	}()
	h.mu.Lock()
	if h.Updating {
		h.mu.Unlock()
		return errors.New("helper update is restarting")
	}
	b := h.Library
	var streamConnection connection
	if h.Sync != nil {
		streamConnection = h.Sync.Connection
	}
	already := h.Session != nil
	h.mu.Unlock()
	if b == nil {
		return errors.New("import a prepared Resonance bundle first")
	}
	if already {
		return errors.New("stop the current session before starting another")
	}
	var a *adapter
	for _, v := range adapters(h.AllowLoopback) {
		if v.Name == interfaceName && v.IP == ipText {
			x := v
			a = &x
			break
		}
	}
	if a == nil {
		return errors.New("select an available IPv4 network interface")
	}
	ip := net.ParseIP(a.IP)
	_, subnet, _ := net.ParseCIDR(a.Network)
	allow := func(v net.IP) bool { return v != nil && subnet.Contains(v) }
	discoveryHost := ""
	if a.TestOnly {
		discoveryHost = a.IP
	}
	if e := probePorts(a.IP, discoveryHost); e != nil {
		return e
	}
	mac, _ := net.ParseMAC(a.MAC)
	if len(mac) == 0 {
		mac = net.HardwareAddr{2, 0, 0, 0, 0, 1}
	}
	ctx, cancel := context.WithCancel(context.Background())
	errs := make(chan error, 8)
	var wg sync.WaitGroup
	dev := &device.VirtualDevice{Name: "Resonance", DeviceNumber: 17, DeviceType: proto.DeviceRekordbox, MediaSlot: proto.SlotRekordbox, IP: ip, MAC: mac, Broadcast: net.ParseIP(a.Broadcast), TrackCount: uint16(b.Tracks), BindHost: discoveryHost, AllowPeer: allow, Peers: device.NewPeerTracker(ip, proto.DeviceRekordbox), Ready: make(chan struct{})}
	db := &dbserver.Server{Library: b.Library, PDB: b.DB, ExportRoot: b.Root, DeviceNumber: 17, Analysis: b.Analysis, PreparedAnalysisOnly: true, Folders: pdb.BuildFolderLookup(b.DB.Tracks), Playlists: preparedPlaylists(b.DB.PlaylistTree), BindHost: a.IP, AllowPeer: allow, Ready: make(chan struct{}), LinkedFn: dev.Linked}
	fs := nfs.NewServer(b.Root)
	if len(b.Remote) > 0 {
		fs.Remote = newResonanceStreamReader(streamConnection, b.Remote)
	}
	fs.IP = ip
	fs.BindHost = a.IP
	fs.AllowPeer = allow
	fs.Errors = errs
	fs.LinkedFn = dev.Linked
	s := &session{Adapter: *a, Device: dev, DB: db, Cancel: cancel, Done: make(chan struct{})}
	run := func(fn func(context.Context) error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if e := fn(ctx); e != nil && ctx.Err() == nil {
				select {
				case errs <- e:
				default:
				}
			}
		}()
	}
	run(db.Start)
	run(fs.Start)
	run(dev.Start)
	go func() { wg.Wait(); close(s.Done) }()
	startup := time.NewTimer(4 * time.Second)
	defer startup.Stop()
	for _, ready := range []<-chan struct{}{db.Ready, dev.Ready} {
		select {
		case <-ready:
		case e := <-errs:
			cancel()
			<-s.Done
			return e
		case <-startup.C:
			cancel()
			<-s.Done
			return errors.New("network services did not become ready")
		}
	}
	// All NFS bind attempts surface errors; do not advertise a partial service.
	select {
	case e := <-errs:
		cancel()
		<-s.Done
		return e
	case <-time.After(250 * time.Millisecond):
	}
	h.mu.Lock()
	h.Session = s
	h.Error = ""
	h.mu.Unlock()
	dev.SetLinked(true)
	go func() {
		select {
		case e := <-errs:
			h.mu.Lock()
			h.Error = e.Error()
			h.Diagnostics.event("warning", "network.failed", map[string]any{"error": e.Error()})
			h.mu.Unlock()
			cancel()
		case <-ctx.Done():
		}
		<-s.Done
		h.mu.Lock()
		if h.Session == s {
			h.Session = nil
		}
		h.mu.Unlock()
	}()
	return nil
}
func jsonReply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func (h *helper) routes(address string) http.Handler {
	mux := http.NewServeMux()
	h.syncRoutes(mux)
	h.usbRoutes(mux)
	h.handoffRoutes(mux)
	h.desktopRoutes(mux)
	h.diagnosticRoutes(mux)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/usb" && r.URL.Path != "/settings" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(dashboard)
	})
	mux.HandleFunc("GET /assets/favicon.svg", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Write(bridgeFavicon)
	})
	mux.HandleFunc("GET /assets/bridge.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Write(bridgeStyles)
		w.Write(bridgeThemeStyles)
	})
	mux.HandleFunc("GET /assets/bridge.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Write(bridgeScript)
	})
	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) { jsonReply(w, 200, h.snapshot()) })
	mux.HandleFunc("GET /api/interfaces", func(w http.ResponseWriter, r *http.Request) { jsonReply(w, 200, adapters(h.AllowLoopback)) })
	mux.HandleFunc("POST /api/start", func(w http.ResponseWriter, r *http.Request) {
		h.operation.Lock()
		defer h.operation.Unlock()
		var v struct {
			Interface string `json:"interface"`
			IP        string `json:"ip"`
		}
		if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&v); e != nil {
			jsonReply(w, 400, map[string]string{"error": "invalid start request"})
			return
		}
		if e := h.start(v.Interface, v.IP); e != nil {
			jsonReply(w, 409, map[string]string{"error": e.Error()})
			return
		}
		jsonReply(w, 200, h.snapshot())
	})
	mux.HandleFunc("POST /api/stop", func(w http.ResponseWriter, r *http.Request) {
		h.operation.Lock()
		defer h.operation.Unlock()
		if e := h.stop(); e != nil {
			jsonReply(w, 409, map[string]string{"error": e.Error()})
			return
		}
		jsonReply(w, 200, h.snapshot())
	})
	mux.HandleFunc("POST /api/import", func(w http.ResponseWriter, r *http.Request) {
		h.operation.Lock()
		defer h.operation.Unlock()
		h.mu.Lock()
		running := h.Session != nil
		h.mu.Unlock()
		if running {
			jsonReply(w, 409, map[string]string{"error": "stop sharing before replacing the library"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBundleBytes)
		reader, e := r.MultipartReader()
		if e != nil {
			jsonReply(w, 400, map[string]string{"error": "select a prepared bundle ZIP"})
			return
		}
		part, e := reader.NextPart()
		if e != nil || part.FormName() != "bundle" {
			jsonReply(w, 400, map[string]string{"error": "bundle upload is required"})
			return
		}
		f, e := os.CreateTemp(h.Cache, "upload-*.zip")
		if e != nil {
			jsonReply(w, 500, map[string]string{"error": e.Error()})
			return
		}
		defer os.Remove(f.Name())
		_, e = io.Copy(f, part)
		f.Close()
		if e != nil {
			jsonReply(w, 400, map[string]string{"error": e.Error()})
			return
		}
		b, e := importBundle(f.Name(), h.Cache)
		if e != nil {
			jsonReply(w, 400, map[string]string{"error": e.Error()})
			return
		}
		h.mu.Lock()
		old := h.Library
		h.Library = b
		h.Error = ""
		h.mu.Unlock()
		if old != nil && !old.Persistent {
			os.RemoveAll(old.Root)
		}
		jsonReply(w, 200, h.snapshot())
	})
	mux.HandleFunc("POST /api/quit", func(w http.ResponseWriter, r *http.Request) {
		jsonReply(w, 200, map[string]bool{"closing": true})
		go h.Shutdown()
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'")
		if r.Host != address {
			http.Error(w, "invalid helper host", 403)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+address {
			http.Error(w, "untrusted origin", 403)
			return
		}
		if r.Method != "GET" && r.Header.Get("X-Resonance-Link") != "1" {
			http.Error(w, "helper action header required", 403)
			return
		}
		if r.Method != "GET" {
			h.mu.Lock()
			updating := h.Updating
			h.mu.Unlock()
			if updating {
				http.Error(w, "helper update is restarting", 503)
				return
			}
		}
		if !h.isPaired() {
			if r.Method == "GET" && (r.URL.Path == "/" || r.URL.Path == "/usb") {
				http.Redirect(w, r, "/settings?next="+url.QueryEscape(r.URL.Path), http.StatusSeeOther)
				return
			}
			switch r.URL.Path {
			case "/api/start", "/api/interfaces", "/api/usb/drives", "/api/usb/write", "/api/usb/receive", "/api/usb/eject":
				jsonReply(w, 409, map[string]string{"error": "Pair Bridge in Settings before using Network Link or USB Export.", "settingsPath": "/settings"})
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func openDashboard(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if e := cmd.Start(); e == nil {
		go cmd.Wait()
	}
}
func main() {
	engine := flag.Bool("engine", false, "internal supervised engine")
	headless := flag.Bool("headless", false, "run without tray or sign-in registration")
	noOpen := flag.Bool("no-open", false, "do not open the local dashboard")
	loopback := flag.Bool("allow-loopback", false, "enable isolated protocol testing on loopback")
	port := flag.Int("port", 55460, "local helper dashboard port")
	cache := flag.String("cache", "", "private bundle cache directory")
	flag.Parse()
	var document *connection
	if args := flag.Args(); len(args) > 0 {
		data, e := os.ReadFile(args[0])
		if e != nil || len(data) > 65536 {
			log.Fatal("Unable to read Resonance connection file")
		}
		var c connection
		if json.Unmarshal(data, &c) != nil {
			log.Fatal("Invalid connection file")
		}
		if e := validateConnection(c); e != nil {
			log.Fatal(e)
		}
		document = &c
	}

	customCache := *cache != ""
	if *cache == "" {
		root, e := os.UserCacheDir()
		if e != nil {
			log.Fatal(e)
		}
		*cache = filepath.Join(root, "Resonance", "Bridge")
		legacy := filepath.Join(root, "Resonance", "PioneerLink")
		if _, currentErr := os.Stat(*cache); errors.Is(currentErr, os.ErrNotExist) {
			_ = os.Rename(legacy, *cache)
		} else if _, legacyErr := os.Stat(legacy); legacyErr == nil {
			_ = os.RemoveAll(legacy)
		}
	}
	purgeLegacyAudio(*cache)
	if e := os.MkdirAll(*cache, 0700); e != nil {
		log.Fatal(e)
	}
	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	if !*engine {
		diagnostics, _ := openBridgeDiagnostics(*cache, "supervisor")
		installBridgeLog(diagnostics)
		diagnostics.event("info", "supervisor.start", map[string]any{"os": runtime.GOOS, "arch": runtime.GOARCH})
		code := supervise(*cache, addr, os.Args[1:])
		diagnostics.event("info", "supervisor.exit", map[string]any{"code": code})
		if diagnostics != nil {
			diagnostics.close()
		}
		os.Exit(code)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	diagnostics, diagnosticError := openBridgeDiagnostics(*cache, "engine")
	installBridgeLog(diagnostics)
	if diagnosticError != nil {
		log.Print("Bridge diagnostic log unavailable: ", diagnosticError)
	}
	if diagnostics != nil {
		defer diagnostics.close()
		diagnostics.event("info", "engine.start", map[string]any{"os": runtime.GOOS, "arch": runtime.GOARCH})
	}
	h := &helper{Diagnostics: diagnostics, Cache: *cache, AllowLoopback: *loopback, Shutdown: cancel, Updates: newUpdater()}
	h.Updates.diagnostics = diagnostics
	if customCache {
		h.PairingDirectory = filepath.Join(*cache, "state")
	} else {
		configRoot, configError := os.UserConfigDir()
		if configError != nil {
			log.Fatal(configError)
		}
		h.PairingDirectory = filepath.Join(configRoot, "Resonance", "Bridge")
	}
	ln, e := net.Listen("tcp4", addr)
	if e != nil {
		client := &http.Client{Timeout: time.Second}
		if response, err := client.Get("http://" + addr + "/api/status"); err == nil {
			var status struct {
				Application string `json:"application"`
			}
			json.NewDecoder(io.LimitReader(response.Body, 65536)).Decode(&status)
			response.Body.Close()
			if status.Application == "resonance-bridge" || status.Application == "resonance-pioneer-link" {
				if document != nil {
					data, _ := json.Marshal(document)
					endpoint := "/api/handoff"
					req, _ := http.NewRequest("POST", "http://"+addr+endpoint, bytes.NewReader(data))
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set("X-Resonance-Link", "1")
					response, err := client.Do(req)
					if err != nil {
						log.Fatal("Unable to connect to the running helper")
					}
					response.Body.Close()
					if response.StatusCode != 200 {
						log.Fatal("The helper rejected this connection file")
					}
				}
				if !*noOpen {
					openDashboard("http://" + addr + documentView(document))
				}
				return
			}
		}
		log.Fatal(e)
	}
	if document != nil {
		var e error
		if isUSB(*document) {
			e = h.receiveUSB(*document)
		} else {
			e = h.connect(*document)
		}
		if e != nil {
			log.Fatal(e)
		}
	} else {
		h.restorePairing()
	}
	srv := &http.Server{Handler: h.routes(addr), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second}
	go func() {
		if e := srv.Serve(ln); e != nil && !errors.Is(e, http.ErrServerClosed) {
			log.Print(e)
			cancel()
		}
	}()
	fmt.Printf("Resonance Bridge: http://%s\n", addr)
	if !*noOpen {
		openDashboard("http://" + addr + documentView(document))
	}
	if !*headless {
		if err := configureStartup(h.Cache, startupEnabled(h.Cache)); err != nil {
			h.mu.Lock()
			h.StartupError = err.Error()
			h.mu.Unlock()
			log.Print(err)
		}
	}
	go h.updateLoop(ctx)
	if *headless {
		<-ctx.Done()
	} else {
		runDesktop(ctx, h, addr)
	}
	h.operation.Lock()
	h.stop()
	h.mu.Lock()
	var usbDone <-chan struct{}
	var usbRoot string
	if h.USB != nil {
		usbDone = h.USB.Done
		if h.USB.Bundle != nil {
			usbRoot = h.USB.Bundle.Root
		}
	}
	if h.USB != nil && h.USB.Cancel != nil {
		h.USB.Cancel()
	}
	if h.Sync != nil {
		h.Sync.Cancel()
	}
	if h.Library != nil && !h.Library.Persistent {
		os.RemoveAll(h.Library.Root)
	}
	h.mu.Unlock()
	h.operation.Unlock()
	if usbDone != nil {
		select {
		case <-usbDone:
			if usbRoot != "" {
				os.RemoveAll(usbRoot)
			}
		case <-time.After(5 * time.Second):
		}
	}
	shutdown, c := context.WithTimeout(context.Background(), 5*time.Second)
	defer c()
	srv.Shutdown(shutdown)
	if diagnostics != nil {
		diagnostics.event("info", "engine.stop", map[string]any{"softwareUpdate": h.RestartForUpdate})
	}
	if h.RestartForUpdate {
		os.Exit(updateRestartCode)
	}
}
