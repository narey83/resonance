// SPDX-License-Identifier: GPL-3.0-or-later
package dbserver

import (
	"github.com/vynulldev/vynull/analysis"
	"github.com/vynulldev/vynull/library"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestPreparedAnalysisOnlyServesCachedMetadata(t *testing.T) {
	store := analysis.NewStore()
	prepared := &analysis.Result{BPM: 123}
	store.Set(1, prepared)
	h := &Handler{analysis: store, preparedAnalysisOnly: true}
	if got := h.lazyAnalyze(1); got != prepared {
		t.Fatal("prepared metadata was not served")
	}
}

func TestPreparedAnalysisOnlyImportsPreparedMetadata(t *testing.T) {
	store := analysis.NewStore()
	prepared := &analysis.Result{BPM: 123}
	store.Importer = func(uint32, string) *analysis.Result { return prepared }
	h := newTestHandler(&library.Track{ID: 1, FilePath: filepath.Join(t.TempDir(), "missing.wav")})
	h.analysis, h.preparedAnalysisOnly = store, true
	if got := h.lazyAnalyze(1); got != prepared {
		t.Fatal("prepared import was not served")
	}
}

func TestPreparedAnalysisOnlyNeverSchedulesAudioAnalysis(t *testing.T) {
	for _, preparedOnly := range []bool{false, true} {
		t.Run(map[bool]string{false: "standalone fallback", true: "Bridge prepared only"}[preparedOnly], func(t *testing.T) {
			store := analysis.NewStore()
			var calls atomic.Int32
			background := make(chan struct{}, 1)
			store.Importer = func(uint32, string) *analysis.Result {
				if calls.Add(1) > 1 {
					background <- struct{}{}
					return &analysis.Result{BPM: 123}
				}
				return nil
			}
			h := newTestHandler(&library.Track{ID: 1, FilePath: filepath.Join(t.TempDir(), "missing.wav")})
			h.analysis, h.preparedAnalysisOnly = store, preparedOnly
			if h.lazyAnalyze(1) != nil {
				t.Fatal("missing metadata should return nil")
			}
			if preparedOnly {
				select {
				case <-background:
					t.Fatal("Bridge scheduled local audio analysis")
				case <-time.After(100 * time.Millisecond):
				}
				if calls.Load() != 1 {
					t.Fatal("only the synchronous metadata import is allowed")
				}
			} else {
				select {
				case <-background:
				case <-time.After(5 * time.Second):
					t.Fatal("standalone fallback did not run; test cannot detect scheduling")
				}
			}
		})
	}
}
