// SPDX-License-Identifier: GPL-3.0-or-later
package nfs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCanonicalConfinement(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "export")
	os.Mkdir(root, 0700)
	outside := filepath.Join(base, "export-other")
	os.Mkdir(outside, 0700)
	os.WriteFile(filepath.Join(outside, "secret"), []byte("private"), 0600)
	os.Symlink(outside, filepath.Join(root, "escape"))
	s := NewServer(root)
	if s.safePath(filepath.Join(root, "escape/secret")) {
		t.Fatal("symlink escape")
	}
	if s.safePath(filepath.Join(outside, "secret")) {
		t.Fatal("sibling prefix escape")
	}
	if !s.safePath(root) {
		t.Fatal("root rejected")
	}
}

func TestReadOnlyAndRevoked(t *testing.T) {
	s := NewServer(t.TempDir())
	linked := true
	s.LinkedFn = func() bool { return linked }
	for _, proc := range []uint32{nfsWrite, nfsCreate, nfsRemove, nfsMkdir, nfsSetAttr} {
		reply := s.handleNFS(&rpcHeader{XID: 1, Proc: proc})
		status, err := newXDRReader(reply[24:]).u32()
		if err != nil || status != nfsROFS {
			t.Fatalf("write proc %d allowed: %d %v", proc, status, err)
		}
	}
	linked = false
	reply := s.handleNFS(&rpcHeader{XID: 2, Proc: nfsRead})
	status, err := newXDRReader(reply[24:]).u32()
	if err != nil || status != nfsNoEnt {
		t.Fatalf("unlinked read allowed %d %v", status, err)
	}
}
