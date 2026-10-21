// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/binary"
	"errors"
	"os"
	"unicode/utf16"
)

// Rewrite only PPTH in the private incoming generation; waveform/grid tags are unchanged.
func rewriteAnalysisPath(file, path string) error {
	data, e := os.ReadFile(file)
	if e != nil {
		return e
	}
	if len(data) < 12 || string(data[:4]) != "PMAI" {
		return errors.New("invalid analysis container")
	}
	header := int(binary.BigEndian.Uint32(data[4:8]))
	if header < 12 || header > len(data) {
		return errors.New("invalid analysis header")
	}
	out := append([]byte(nil), data[:header]...)
	found := false
	for at := header; at < len(data); {
		if at+12 > len(data) {
			return errors.New("truncated analysis tag")
		}
		size := int(binary.BigEndian.Uint32(data[at+8 : at+12]))
		if size < 12 || at+size > len(data) {
			return errors.New("invalid analysis tag size")
		}
		if string(data[at:at+4]) == "PPTH" {
			chars := utf16.Encode([]rune(path))
			value := make([]byte, (len(chars)+1)*2)
			for i, c := range chars {
				binary.BigEndian.PutUint16(value[i*2:], c)
			}
			tag := make([]byte, 16)
			copy(tag, "PPTH")
			binary.BigEndian.PutUint32(tag[4:8], 16)
			binary.BigEndian.PutUint32(tag[8:12], uint32(16+len(value)))
			binary.BigEndian.PutUint32(tag[12:16], uint32(len(value)))
			out = append(out, tag...)
			out = append(out, value...)
			found = true
		} else {
			out = append(out, data[at:at+size]...)
		}
		at += size
	}
	if !found {
		return errors.New("analysis audio path missing")
	}
	binary.BigEndian.PutUint32(out[8:12], uint32(len(out)))
	// Atomic replacement also avoids modifying any hard-linked test fixture.
	temporary := file + ".sync"
	if e = os.WriteFile(temporary, out, 0600); e != nil {
		return e
	}
	return os.Rename(temporary, file)
}
