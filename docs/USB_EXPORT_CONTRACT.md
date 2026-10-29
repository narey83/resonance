# USB export source contract

The Export page offers Saved playlist, Create a playlist first, Smart crate and Quick folder export. Creation uses the existing playlist API and Library editor. It does not create an export until tracks have been added and a saved playlist selected.

## Resolve before preparing

`GET /api/v0/analysis/usb-export/sources` returns lightweight playlist, smart-crate and track-folder choices. It excludes the library root. Opening this page does not fetch the entire track catalogue.

`POST /api/v0/analysis/usb-export/resolve` accepts one of:

```json
{"kind":"playlist","id":"saved-playlist-id"}
{"kind":"smart-crate","id":"saved-crate-id"}
{"kind":"folder","folder":"relative/music/folder"}
```

The response contains `selectionId`, `source`, `playlistName`, `paths` and `trackCount`. Source records its kind, ID, name, revision when applicable, resolution time and SHA-256 of the ordered path list.

- Playlists preserve saved `sortOrder`.
- Smart crates apply the signed-in user’s current rules, history and loved-track filters once, ordered by title with deterministic path tie-breaking.
- Folder exports include subfolders and use album/disc/track ordering with a path tie-break. The folder name is the suggested playlist name.
- Empty sources, duplicate paths and sources exceeding 10,000 tracks are rejected. Oversized results are never silently truncated.
- The selected source is fixed during review. To edit membership, edit its Library source and resolve again. Playlist names and player profiles may still be changed for the export.

Previews are bound to the signed-in username, expire after 24 hours and are held in memory. A server restart requires resolving an unprepared selection again. At most 25 previews per user and 100 overall are retained; identical previews are reused. Preparing an export does not re-evaluate smart-crate membership.

## Prepare

Existing `POST /api/v0/analysis/usb-export` accepts an optional `selectionId` alongside `paths`, `playlistName` and `profile`. A supplied selection must belong to the caller, remain valid and match the reviewed paths in exactly the same order. Legacy individual-track and Set Planner exports may omit it.

Prepared jobs retain source provenance in the input and export manifests and database inspection report. Job IDs and exported database track IDs are distinct: a job ID identifies the complete export; database track IDs identify its ordered contents. Database inspection reads generated export files and never decodes audio. Software checks do not certify hardware playback.

All routes require the existing Library permission. Starting a job retains the existing write/admin requirement. Source resolution performs no audio processing or USB writes. USB capacity, destination identity, write confirmation and copy/readback checks remain in Bridge.
