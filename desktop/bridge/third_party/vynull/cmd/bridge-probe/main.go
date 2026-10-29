// SPDX-License-Identifier: GPL-3.0-or-later
package main

import (
	_ "embed"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/vynulldev/vynull/analysis"
	"github.com/vynulldev/vynull/dbclient"
	"github.com/vynulldev/vynull/nfs"
	"github.com/vynulldev/vynull/pdb"
)

//go:embed index.html
var indexHTML []byte

type result struct {
	Stage      string `json:"stage"`
	OK         bool   `json:"ok"`
	Detail     string `json:"detail"`
	DurationMS int64  `json:"durationMs"`
}
type report struct {
	Target     string   `json:"target"`
	OK         bool     `json:"ok"`
	StartedAt  string   `json:"startedAt"`
	DurationMS int64    `json:"durationMs"`
	Results    []result `json:"results"`
	Delivery   delivery `json:"delivery"`
}

type deliveryItem struct {
	Name     string `json:"name"`
	Standard string `json:"standard"`
	Coverage int    `json:"coverage"`
	Detail   string `json:"detail"`
}

type delivery struct {
	Tracks       int            `json:"tracks"`
	Metadata     []deliveryItem `json:"metadata"`
	Analysis     []deliveryItem `json:"analysis"`
	AudioFormats []deliveryItem `json:"audioFormats"`
}

func addCoverage(items *[]deliveryItem, name, standard, detail string, coverage int) {
	if coverage > 0 {
		*items = append(*items, deliveryItem{Name: name, Standard: standard, Coverage: coverage, Detail: detail})
	}
}

func catalogDelivery(db *pdb.Database) delivery {
	d := delivery{Tracks: len(db.Tracks)}
	counts := map[string]int{}
	formats := map[string]int{}
	for _, t := range db.Tracks {
		if t.Title != "" {
			counts["Title"]++
		}
		if t.Artist != "" {
			counts["Artist"]++
		}
		if t.Album != "" {
			counts["Album"]++
		}
		if t.Genre != "" {
			counts["Genre"]++
		}
		if t.Key != "" {
			counts["Key"]++
		}
		if t.Label != "" {
			counts["Label"]++
		}
		if t.Comment != "" {
			counts["Comment"]++
		}
		if t.Tempo > 0 {
			counts["BPM"]++
		}
		if t.Duration > 0 {
			counts["Duration"]++
		}
		if t.ArtworkID > 0 {
			counts["Artwork"]++
		}
		if t.Rating > 0 {
			counts["Rating"]++
		}
		if t.Year > 0 {
			counts["Year"]++
		}
		if t.Bitrate > 0 {
			counts["Bitrate"]++
		}
		if t.SampleRate > 0 {
			counts["Sample rate/depth"]++
		}
		ext := strings.TrimPrefix(strings.ToUpper(filepath.Ext(t.FilePath)), ".")
		if ext == "" {
			ext = "UNKNOWN"
		}
		formats[ext]++
	}
	order := []string{"Title", "Artist", "Album", "Genre", "Key", "BPM", "Duration", "Artwork", "Label", "Comment", "Rating", "Year", "Bitrate", "Sample rate/depth"}
	for _, name := range order {
		addCoverage(&d.Metadata, name, "export.pdb", "Browse/load metadata", counts[name])
	}
	keys := make([]string, 0, len(formats))
	for name := range formats {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	for _, name := range keys {
		addCoverage(&d.AudioFormats, name, "Range-streamed audio", "Read on demand; not copied to the dev system", formats[name])
	}
	return d
}

func inspectAnalysis(client *nfs.Client, export string, db *pdb.Database, d *delivery) error {
	counts := map[string]int{}
	for _, t := range db.Tracks {
		if t.AnalyzePath == "" {
			continue
		}
		base := strings.TrimSuffix(t.AnalyzePath, ".DAT")
		dat, _ := client.ReadFile(export, t.AnalyzePath)
		ext, _ := client.ReadFile(export, base+".EXT")
		twoEX, _ := client.ReadFile(export, base+".2EX")
		if len(dat) > 0 {
			counts["ANLZ .DAT"]++
		}
		if len(ext) > 0 {
			counts["ANLZ .EXT"]++
		}
		if len(twoEX) > 0 {
			counts["ANLZ .2EX"]++
		}
		a := analysis.ParseANLZBytes(dat, ext, twoEX, float64(t.Tempo)/100, int(t.Duration))
		if a == nil {
			continue
		}
		if len(a.WavePreviewANLZ) > 0 {
			counts["PWAV"]++
		}
		if len(a.WaveTinyANLZ) > 0 {
			counts["PWV2"]++
		}
		if len(a.WaveDetailMono) > 0 {
			counts["PWV3"]++
		}
		if len(a.WaveColorPreview) > 0 {
			counts["PWV4"]++
		}
		if len(a.WaveDetail) > 0 {
			counts["PWV5"]++
		}
		if len(a.WavePreview3Band) > 0 {
			counts["PWV6"]++
		}
		if len(a.WaveDetail3Band) > 0 {
			counts["PWV7"]++
		}
		if len(a.Beats) > 0 {
			counts["PQTZ"]++
		}
		if len(a.BeatGridPQT2) > 0 {
			counts["PQT2"]++
		}
		if len(a.SongStructure) > 0 {
			counts["PSSI"]++
		}
	}
	items := []deliveryItem{
		{Name: "Analysis container", Standard: "ANLZ .DAT", Coverage: counts["ANLZ .DAT"], Detail: "Legacy waveform preview and beat grid"},
		{Name: "Extended analysis", Standard: "ANLZ .EXT", Coverage: counts["ANLZ .EXT"], Detail: "Detailed waveforms, enhanced grid and phrases"},
		{Name: "Modern analysis", Standard: "ANLZ .2EX", Coverage: counts["ANLZ .2EX"], Detail: "Three-band waveform data"},
		{Name: "Monochrome overview", Standard: "PWAV", Coverage: counts["PWAV"], Detail: "Legacy waveform overview"},
		{Name: "Compact overview", Standard: "PWV2", Coverage: counts["PWV2"], Detail: "Small legacy waveform"},
		{Name: "Monochrome detail", Standard: "PWV3", Coverage: counts["PWV3"], Detail: "Scrolling monochrome waveform"},
		{Name: "Colour overview", Standard: "PWV4", Coverage: counts["PWV4"], Detail: "Full-track colour waveform"},
		{Name: "Colour detail", Standard: "PWV5", Coverage: counts["PWV5"], Detail: "Scrolling colour waveform, 2 bytes per point"},
		{Name: "Three-band overview", Standard: "PWV6", Coverage: counts["PWV6"], Detail: "Bass, mid and treble overview"},
		{Name: "Three-band detail", Standard: "PWV7", Coverage: counts["PWV7"], Detail: "Scrolling bass, mid and treble waveform"},
		{Name: "Beat grid", Standard: "PQTZ", Coverage: counts["PQTZ"], Detail: "Beat positions and downbeat"},
		{Name: "Enhanced beat grid", Standard: "PQT2", Coverage: counts["PQT2"], Detail: "Extended grid representation"},
		{Name: "Phrase structure", Standard: "PSSI", Coverage: counts["PSSI"], Detail: "Intro, build, chorus and outro regions"},
	}
	for _, item := range items {
		if item.Coverage > 0 {
			d.Analysis = append(d.Analysis, item)
		}
	}
	if len(d.Analysis) == 0 {
		return fmt.Errorf("no player-analysis assets found")
	}
	return nil
}

func probe(target string, timeout time.Duration) report {
	started := time.Now()
	out := report{Target: target, OK: true, StartedAt: started.UTC().Format(time.RFC3339)}
	ip := net.ParseIP(target).To4()
	if ip == nil || (!ip.IsPrivate() && !ip.IsLoopback()) {
		out.OK = false
		out.Results = append(out.Results, result{Stage: "Target validation", Detail: "Use a private IPv4 address"})
		return out
	}
	step := func(stage string, fn func() (string, error)) bool {
		at := time.Now()
		detail, err := fn()
		r := result{Stage: stage, OK: err == nil, Detail: detail, DurationMS: time.Since(at).Milliseconds()}
		if err != nil {
			r.Detail = err.Error()
			out.OK = false
		}
		out.Results = append(out.Results, r)
		return r.OK
	}
	finish := func() report { out.DurationMS = time.Since(started).Milliseconds(); return out }

	var port int
	if !step("Database discovery", func() (string, error) {
		var err error
		port, err = dbclient.DBServerPort(ip)
		return fmt.Sprintf("Query service returned TCP %d", port), err
	}) {
		return finish()
	}
	if !step("Database handshake", func() (string, error) {
		client, err := dbclient.Dial(ip, port, 4)
		if err == nil {
			client.Close()
		}
		return "Session setup accepted", err
	}) {
		return finish()
	}

	var client *nfs.Client
	if !step("File-service RPC", func() (string, error) {
		var err error
		client, err = nfs.Dial(ip, timeout)
		return "Port mapping, mount and NFS services responded", err
	}) {
		return finish()
	}
	defer client.Close()
	step("Media exports", func() (string, error) { exports, err := client.Exports(); return strings.Join(exports, ", "), err })

	var catalog *pdb.Database
	var export string
	if !step("Catalog read", func() (string, error) {
		data, selected, err := client.FetchExportPDB("")
		if err != nil {
			return "", err
		}
		export = selected
		catalog, err = pdb.OpenBytes(data, "")
		if err != nil {
			return "", err
		}
		if len(catalog.Tracks) == 0 {
			return "", fmt.Errorf("catalog contains no tracks")
		}
		return fmt.Sprintf("%d bytes, %d tracks", len(data), len(catalog.Tracks)), nil
	}) {
		return finish()
	}
	out.Delivery = catalogDelivery(catalog)
	step("Player analysis", func() (string, error) {
		err := inspectAnalysis(client, export, catalog, &out.Delivery)
		return fmt.Sprintf("%d compatible analysis payload types inspected", len(out.Delivery.Analysis)), err
	})
	step("Streamed range read", func() (string, error) {
		track := catalog.Tracks[0]
		chunk, err := client.ReadRange(export, track.FilePath, 0, 4096)
		if err == nil && len(chunk) == 0 {
			err = fmt.Errorf("empty response")
		}
		return fmt.Sprintf("%d bytes from track %d; nothing stored", len(chunk), track.ID), err
	})
	return finish()
}

func main() {
	target := flag.String("target", "", "Bridge IPv4 address")
	timeout := flag.Duration("timeout", 3*time.Second, "per-operation timeout")
	listen := flag.String("listen", "", "serve the internal web UI on this address")
	flag.Parse()
	if *listen == "" {
		r := probe(*target, *timeout)
		for _, item := range r.Results {
			status := "PASS"
			if !item.OK {
				status = "FAIL"
			}
			fmt.Printf("%s %-20s %s (%dms)\n", status, item.Stage, item.Detail, item.DurationMS)
		}
		if !r.OK {
			os.Exit(1)
		}
		return
	}
	var gate sync.Mutex
	http.HandleFunc("/", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/" {
			http.NotFound(w, req)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(indexHTML)
	})
	http.HandleFunc("/api/probe", func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var input struct {
			Target string `json:"target"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, req.Body, 1024)).Decode(&input) != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		gate.Lock()
		r := probe(input.Target, *timeout)
		gate.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(r)
	})
	fmt.Printf("Bridge probe UI listening on http://%s\n", *listen)
	if err := http.ListenAndServe(*listen, nil); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
