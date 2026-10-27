// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"github.com/vynulldev/vynull/dbserver"
	"github.com/vynulldev/vynull/pdb"
)

type preparedPlaylists []*pdb.FolderNode

func (p preparedPlaylists) Children(parent uint32) []dbserver.PlaylistEntry {
	result := []dbserver.PlaylistEntry{}
	for _, n := range p {
		if n.ParentID == parent {
			result = append(result, dbserver.PlaylistEntry{ID: n.ID, Name: n.Name, IsFolder: n.IsFolder, Seq: uint32(len(result) + 1)})
		}
	}
	return result
}
func (p preparedPlaylists) Tracks(id uint32) []uint32 {
	for _, n := range p {
		if n.ID == id {
			return append([]uint32(nil), n.TrackIDs...)
		}
	}
	return nil
}
func (p preparedPlaylists) HistoryFolderID() uint32 { return 0 }
