// <copyright file="MixtapeRepository.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.Mixtapes
{
    using System;
    using System.Collections.Generic;
    using Microsoft.Data.Sqlite;

    public class MixtapeRepository
    {
        public MixtapeRepository(string connectionString)
        {
            ConnectionString = connectionString;
        }

        private string ConnectionString { get; }

        public void Initialize()
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS mixtapes (
                    id                  TEXT PRIMARY KEY,
                    name                TEXT NOT NULL,
                    description         TEXT,
                    is_published        INTEGER NOT NULL DEFAULT 0,
                    public_token        TEXT,
                    created_at          INTEGER NOT NULL,
                    updated_at          INTEGER NOT NULL,
                    is_soulseek_shared  INTEGER NOT NULL DEFAULT 0
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_mixtapes_token ON mixtapes(public_token)
                    WHERE public_token IS NOT NULL;
                CREATE TABLE IF NOT EXISTS mixtape_tracks (
                    id         TEXT PRIMARY KEY,
                    mixtape_id TEXT NOT NULL REFERENCES mixtapes(id) ON DELETE CASCADE,
                    file_path  TEXT NOT NULL,
                    title      TEXT,
                    artist     TEXT,
                    album      TEXT,
                    duration   REAL,
                    sort_order INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_mixtape_tracks_mixtape ON mixtape_tracks(mixtape_id);", conn);
            cmd.ExecuteNonQuery();

            // Migrations
            TryAlter(conn, "ALTER TABLE mixtapes ADD COLUMN is_soulseek_shared INTEGER NOT NULL DEFAULT 0");
        }

        private static void TryAlter(SqliteConnection conn, string sql)
        {
            try
            {
                using var cmd = new SqliteCommand(sql, conn);
                cmd.ExecuteNonQuery();
            }
            catch (SqliteException)
            { /* column already exists */
            }
        }

        // ── Mixtape CRUD ──────────────────────────────────────────────────────
        public void InsertMixtape(Mixtape m)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                INSERT INTO mixtapes (id, name, description, is_published, public_token, created_at, updated_at, is_soulseek_shared)
                VALUES (@id, @name, @desc, @pub, @token, @created, @updated, @slsk)", conn);
            BindMixtape(cmd, m);
            cmd.ExecuteNonQuery();
        }

        public void UpdateMixtape(Mixtape m)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                UPDATE mixtapes
                SET name=@name, description=@desc, is_published=@pub, public_token=@token, updated_at=@updated, is_soulseek_shared=@slsk
                WHERE id=@id", conn);
            BindMixtape(cmd, m);
            cmd.ExecuteNonQuery();
        }

        public void DeleteMixtape(string id)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("DELETE FROM mixtapes WHERE id=@id", conn);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.ExecuteNonQuery();
        }

        public IReadOnlyList<Mixtape> GetAll()
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(
                "SELECT id,name,description,is_published,public_token,created_at,updated_at,is_soulseek_shared FROM mixtapes ORDER BY created_at DESC", conn);
            using var r = cmd.ExecuteReader();
            var list = new List<Mixtape>();
            while (r.Read())
            {
                list.Add(ReadMixtape(r));
            }

            return list;
        }

        public Mixtape? GetById(string id)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(
                "SELECT id,name,description,is_published,public_token,created_at,updated_at,is_soulseek_shared FROM mixtapes WHERE id=@id", conn);
            cmd.Parameters.AddWithValue("@id", id);
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadMixtape(r) : null;
        }

        public Mixtape? GetByToken(string token)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(
                "SELECT id,name,description,is_published,public_token,created_at,updated_at,is_soulseek_shared FROM mixtapes WHERE public_token=@token AND is_published=1", conn);
            cmd.Parameters.AddWithValue("@token", token);
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadMixtape(r) : null;
        }

        public bool HasAny()
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("SELECT 1 FROM mixtapes LIMIT 1", conn);
            return cmd.ExecuteScalar() != null;
        }

        // ── Track CRUD ────────────────────────────────────────────────────────
        public void InsertTrack(MixtapeTrack t)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                INSERT INTO mixtape_tracks (id, mixtape_id, file_path, title, artist, album, duration, sort_order)
                VALUES (@id, @mid, @path, @title, @artist, @album, @dur, @ord)", conn);
            BindTrack(cmd, t);
            cmd.ExecuteNonQuery();
        }

        public void DeleteTrack(string trackId)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("DELETE FROM mixtape_tracks WHERE id=@id", conn);
            cmd.Parameters.AddWithValue("@id", trackId);
            cmd.ExecuteNonQuery();
        }

        public IReadOnlyList<MixtapeTrack> GetTracks(string mixtapeId)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(
                "SELECT id,mixtape_id,file_path,title,artist,album,duration,sort_order FROM mixtape_tracks WHERE mixtape_id=@mid ORDER BY sort_order", conn);
            cmd.Parameters.AddWithValue("@mid", mixtapeId);
            using var r = cmd.ExecuteReader();
            var list = new List<MixtapeTrack>();
            while (r.Read())
            {
                list.Add(ReadTrack(r));
            }

            return list;
        }

        public void ClearTracks(string mixtapeId)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("DELETE FROM mixtape_tracks WHERE mixtape_id=@mid", conn);
            cmd.Parameters.AddWithValue("@mid", mixtapeId);
            cmd.ExecuteNonQuery();
        }

        public void UpdateTrackOrder(string trackId, int sortOrder)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("UPDATE mixtape_tracks SET sort_order=@ord WHERE id=@id", conn);
            cmd.Parameters.AddWithValue("@ord", sortOrder);
            cmd.Parameters.AddWithValue("@id", trackId);
            cmd.ExecuteNonQuery();
        }

        /// <summary>Returns the distinct mixtape IDs that have any track whose file_path starts with <paramref name="oldPrefix"/>.</summary>
        /// <returns></returns>
        public IReadOnlyList<string> GetMixtapeIdsByTrackPrefix(string oldPrefix)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(
                "SELECT DISTINCT mixtape_id FROM mixtape_tracks WHERE file_path LIKE @p ESCAPE '\\'", conn);
            cmd.Parameters.AddWithValue("@p", EscapeLike(oldPrefix) + "%");
            using var r = cmd.ExecuteReader();
            var ids = new List<string>();
            while (r.Read())
            {
                ids.Add(r.GetString(0));
            }

            return ids;
        }

        /// <summary>
        /// Rewrites all mixtape track file_paths that begin with <paramref name="oldPrefix"/> to begin
        /// with <paramref name="newPrefix"/> instead.  For a folder rename pass paths with a trailing
        /// separator; for a single-file rename pass the exact paths.
        /// </summary>
        /// <returns></returns>
        public int UpdateTrackPaths(string oldPrefix, string newPrefix)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                UPDATE mixtape_tracks
                SET file_path = @new || SUBSTR(file_path, LENGTH(@old) + 1)
                WHERE file_path LIKE @pattern ESCAPE '\'", conn);
            cmd.Parameters.AddWithValue("@old", oldPrefix);
            cmd.Parameters.AddWithValue("@new", newPrefix);
            cmd.Parameters.AddWithValue("@pattern", EscapeLike(oldPrefix) + "%");
            return cmd.ExecuteNonQuery();
        }

        private static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

        // ── Helpers ───────────────────────────────────────────────────────────
        private SqliteConnection GetConnection()
        {
            var conn = new SqliteConnection(ConnectionString);
            conn.Open();
            return conn;
        }

        private static void BindMixtape(SqliteCommand cmd, Mixtape m)
        {
            cmd.Parameters.AddWithValue("@id", m.Id);
            cmd.Parameters.AddWithValue("@name", m.Name);
            cmd.Parameters.AddWithValue("@desc", (object?)m.Description ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@pub", m.IsPublished ? 1 : 0);
            cmd.Parameters.AddWithValue("@token", (object?)m.PublicToken ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@created", m.CreatedAt);
            cmd.Parameters.AddWithValue("@updated", m.UpdatedAt);
            cmd.Parameters.AddWithValue("@slsk", m.IsSoulseekShared ? 1 : 0);
        }

        private static void BindTrack(SqliteCommand cmd, MixtapeTrack t)
        {
            cmd.Parameters.AddWithValue("@id", t.Id);
            cmd.Parameters.AddWithValue("@mid", t.MixtapeId);
            cmd.Parameters.AddWithValue("@path", t.FilePath);
            cmd.Parameters.AddWithValue("@title", (object?)t.Title ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@artist", (object?)t.Artist ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@album", (object?)t.Album ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@dur", (object?)t.Duration ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@ord", t.SortOrder);
        }

        private static Mixtape ReadMixtape(SqliteDataReader r) => new(
            r.GetString(0),
            r.GetString(1),
            r.IsDBNull(2) ? null : r.GetString(2),
            r.GetInt64(3) != 0,
            r.IsDBNull(4) ? null : r.GetString(4),
            r.GetInt64(5),
            r.GetInt64(6),
            IsSoulseekShared: r.GetInt64(7) != 0);

        private static MixtapeTrack ReadTrack(SqliteDataReader r) => new(
            r.GetString(0),
            r.GetString(1),
            r.GetString(2),
            r.IsDBNull(3) ? null : r.GetString(3),
            r.IsDBNull(4) ? null : r.GetString(4),
            r.IsDBNull(5) ? null : r.GetString(5),
            r.IsDBNull(6) ? null : r.GetDouble(6),
            r.GetInt32(7));
    }
}
