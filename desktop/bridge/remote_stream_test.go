// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestResonanceStreamReaderUsesAuthenticatedRangesWithoutFiles(t *testing.T) {
	secret := strings.Repeat("a", 64)
	source := strings.Repeat("b", 64)
	audio := []byte("0123456789abcdef")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v0/bridge/sync/audio/"+source || r.Header.Get("X-Resonance-Link-Token") != secret || r.Header.Get("Range") != "bytes=0-15" {
			t.Fatalf("unexpected stream request: %s %q", r.URL.Path, r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-15/%d", len(audio)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(audio)
	}))
	defer server.Close()

	virtual := filepath.Join(t.TempDir(), "Contents", "track.mp3")
	reader := newResonanceStreamReader(connection{ServerURL: server.URL + "/api/v0/bridge/sync", Token: secret}, map[string]remoteFile{
		virtual: {SourceKey: source, SHA256: strings.Repeat("c", 64), Bytes: int64(len(audio))},
	})
	data, err := reader.ReadAt(virtual, 4, 6)
	if err != nil || string(data) != "456789" {
		t.Fatal(string(data), err)
	}
	if size, _, ok := reader.Stat(virtual); !ok || size != int64(len(audio)) {
		t.Fatal("virtual stream stat unavailable")
	}
}

func TestResonanceStreamReaderReusesRangesAndCrossesBoundaries(t *testing.T) {
	audio := make([]byte, 2*relayBlockSize+123)
	for i := range audio {
		audio[i] = byte(i % 251)
	}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var start, end int64
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil || start < 0 || end >= int64(len(audio)) || end < start {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		requests.Add(1)
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(audio)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(audio[start : end+1])
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "Contents", "track.mp3")
	reader := newResonanceStreamReader(connection{ServerURL: server.URL}, map[string]remoteFile{
		path: {SourceKey: "source", Bytes: int64(len(audio))},
	})
	for offset := 0; offset < len(audio); offset += 8192 {
		data, err := reader.ReadAt(path, uint32(offset), 8192)
		if err != nil || !bytes.Equal(data, audio[offset:min(offset+8192, len(audio))]) {
			t.Fatal("relay returned wrong audio", offset, err)
		}
	}
	if requests.Load() != 3 {
		t.Fatalf("wanted three upstream ranges for %d player reads, got %d", (len(audio)+8191)/8192, requests.Load())
	}
}

func TestResonanceStreamReaderCoalescesConcurrentReads(t *testing.T) {
	audio := []byte(strings.Repeat("music", 1000))
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		time.Sleep(10 * time.Millisecond)
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-%d/%d", len(audio)-1, len(audio)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(audio)
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "Contents", "track.mp3")
	reader := newResonanceStreamReader(connection{ServerURL: server.URL}, map[string]remoteFile{
		path: {SourceKey: "source", Bytes: int64(len(audio))},
	})
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			data, err := reader.ReadAt(path, 0, 100)
			if err != nil || !bytes.Equal(data, audio[:100]) {
				t.Errorf("concurrent read failed: %v", err)
			}
		}()
	}
	wg.Wait()
	if requests.Load() != 1 {
		t.Fatalf("concurrent player reads made %d upstream requests", requests.Load())
	}
}

func TestResonanceStreamReaderRetriesUnexpectedRange(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			w.Header().Set("Content-Range", "bytes 1-4/4")
		} else {
			w.Header().Set("Content-Range", "bytes 0-3/4")
		}
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("data"))
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "Contents", "track.mp3")
	reader := newResonanceStreamReader(connection{ServerURL: server.URL}, map[string]remoteFile{
		path: {SourceKey: "source", Bytes: 4},
	})
	if _, err := reader.ReadAt(path, 0, 4); err == nil {
		t.Fatal("wrong upstream range was accepted")
	}
	if data, err := reader.ReadAt(path, 0, 4); err != nil || string(data) != "data" || requests.Load() != 2 {
		t.Fatal("failed range was retained in cache", err)
	}
}

func BenchmarkRelaySequentialRanges(b *testing.B) {
	audio := make([]byte, 1<<20)
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var start, end int64
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		requests.Add(1)
		time.Sleep(2 * time.Millisecond)
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(audio)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(audio[start : end+1])
	}))
	defer server.Close()
	path := filepath.Join(b.TempDir(), "Contents", "track.mp3")
	b.ResetTimer()
	for range b.N {
		reader := newResonanceStreamReader(connection{ServerURL: server.URL}, map[string]remoteFile{
			path: {SourceKey: "source", Bytes: int64(len(audio))},
		})
		for offset := 0; offset < len(audio); offset += 8192 {
			if _, err := reader.ReadAt(path, uint32(offset), 8192); err != nil {
				b.Fatal(err)
			}
		}
	}
	b.ReportMetric(float64(requests.Load())/float64(b.N), "upstream-req/op")
	b.SetBytes(int64(len(audio)))
}
