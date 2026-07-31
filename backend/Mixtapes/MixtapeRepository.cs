// <copyright file="MixtapeRepository.cs" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
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
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.Mixtapes
{
    using System;
    using System.Collections.Generic;
    using System.Data;
    using System.Data.Common;
    using Npgsql;
    using resonance.Common;

    public class MixtapeRepository
    {
        public MixtapeRepository(string connectionString, bool usePostgres = false)
        {
            ConnectionString = connectionString;
            UsePostgres = usePostgres;
        }

        private string ConnectionString { get; }
        private bool UsePostgres { get; }

        // Schema-qualified table prefixes
        private string M => UsePostgres ? "mixtapes.mixtapes" : "mixtapes";
        private string MT => UsePostgres ? "mixtapes.mixtape_tracks" : "mixtape_tracks";

        public void Initialize()
        {
            using var conn = OpenConnection();

            if (!UsePostgres)
            {
                using var pragmaCmd = conn.CreateCommand();
                pragmaCmd.CommandText = "PRAGMA journal_mode=WAL;";
                pragmaCmd.ExecuteNonQuery();
            }
            else
            {
                using var schemaCmd = conn.CreateCommand();
                schemaCmd.CommandText = "CREATE SCHEMA IF NOT EXISTS mixtapes";
                schemaCmd.ExecuteNonQuery();
            }

            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                CREATE TABLE IF NOT EXISTS {M} (
                    id                 TEXT PRIMARY KEY,
                    name               TEXT NOT NULL,
                    description        TEXT,
                    is_published       INTEGER NOT NULL DEFAULT 0,
                    public_token       TEXT,
                    created_at         {(UsePostgres ? "BIGINT" : "INTEGER")} NOT NULL,
                    updated_at         {(UsePostgres ? "BIGINT" : "INTEGER")} NOT NULL,
                    is_soulseek_shared INTEGER NOT NULL DEFAULT 0
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_mixtapes_token ON {M}(public_token)
                    WHERE public_token IS NOT NULL;
                CREATE TABLE IF NOT EXISTS {MT} (
                    id         TEXT PRIMARY KEY,
                    mixtape_id TEXT NOT NULL REFERENCES {M}(id) ON DELETE CASCADE,
                    file_path  TEXT NOT NULL,
                    title      TEXT,
                    artist     TEXT,
                    album      TEXT,
                    duration   {(UsePostgres ? "DOUBLE PRECISION" : "REAL")},
                    sort_order INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_mixtape_tracks_mixtape ON {MT}(mixtape_id);";
            cmd.ExecuteNonQuery();

            // Migration: add is_soulseek_shared if not present. IF NOT EXISTS rather than catching
            // the failure, which the server logs as an ERROR on every startup either way.
            using var alter = conn.CreateCommand();
            alter.CommandText = $"ALTER TABLE {M} ADD COLUMN IF NOT EXISTS is_soulseek_shared INTEGER NOT NULL DEFAULT 0";
            alter.ExecuteNonQuery();
        }

        // ── Mixtape CRUD ──────────────────────────────────────────────────────
        public void InsertMixtape(Mixtape m)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                INSERT INTO {M} (id, name, description, is_published, public_token, created_at, updated_at, is_soulseek_shared)
                VALUES (@id, @name, @desc, @pub, @token, @created, @updated, @slsk)";
            BindMixtape(cmd, m);
            cmd.ExecuteNonQuery();
        }

        public void UpdateMixtape(Mixtape m)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                UPDATE {M}
                SET name=@name, description=@desc, is_published=@pub, public_token=@token, updated_at=@updated, is_soulseek_shared=@slsk
                WHERE id=@id";
            BindMixtape(cmd, m);
            cmd.ExecuteNonQuery();
        }

        public void DeleteMixtape(string id)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DELETE FROM {M} WHERE id=@id";
            AddParam(cmd, "@id", id);
            cmd.ExecuteNonQuery();
        }

        public IReadOnlyList<Mixtape> GetAll()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT id,name,description,is_published,public_token,created_at,updated_at,is_soulseek_shared FROM {M} ORDER BY created_at DESC";
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
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT id,name,description,is_published,public_token,created_at,updated_at,is_soulseek_shared FROM {M} WHERE id=@id";
            AddParam(cmd, "@id", id);
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadMixtape(r) : null;
        }

        public Mixtape? GetByToken(string token)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT id,name,description,is_published,public_token,created_at,updated_at,is_soulseek_shared FROM {M} WHERE public_token=@token AND is_published=1";
            AddParam(cmd, "@token", token);
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadMixtape(r) : null;
        }

        public bool HasAny()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT 1 FROM {M} LIMIT 1";
            return cmd.ExecuteScalar() != null;
        }

        // ── Track CRUD ────────────────────────────────────────────────────────
        public void InsertTrack(MixtapeTrack t)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                INSERT INTO {MT} (id, mixtape_id, file_path, title, artist, album, duration, sort_order)
                VALUES (@id, @mid, @path, @title, @artist, @album, @dur, @ord)";
            BindTrack(cmd, t);
            cmd.ExecuteNonQuery();
        }

        public void DeleteTrack(string trackId)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DELETE FROM {MT} WHERE id=@id";
            AddParam(cmd, "@id", trackId);
            cmd.ExecuteNonQuery();
        }

        public IReadOnlyList<MixtapeTrack> GetTracks(string mixtapeId)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT id,mixtape_id,file_path,title,artist,album,duration,sort_order FROM {MT} WHERE mixtape_id=@mid ORDER BY sort_order";
            AddParam(cmd, "@mid", mixtapeId);
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
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DELETE FROM {MT} WHERE mixtape_id=@mid";
            AddParam(cmd, "@mid", mixtapeId);
            cmd.ExecuteNonQuery();
        }

        public void UpdateTrackOrder(string trackId, int sortOrder)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"UPDATE {MT} SET sort_order=@ord WHERE id=@id";
            AddParam(cmd, "@ord", sortOrder);
            AddParam(cmd, "@id", trackId);
            cmd.ExecuteNonQuery();
        }

        public IReadOnlyList<string> GetMixtapeIdsByTrackPrefix(string oldPrefix)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = UsePostgres
                ? $"SELECT DISTINCT mixtape_id FROM {MT} WHERE file_path LIKE @p"
                : $"SELECT DISTINCT mixtape_id FROM {MT} WHERE file_path LIKE @p ESCAPE '\\'";
            AddParam(cmd, "@p", EscapeLike(MusicPath.ToRelative(oldPrefix)) + "%");
            using var r = cmd.ExecuteReader();
            var ids = new List<string>();
            while (r.Read())
            {
                ids.Add(r.GetString(0));
            }

            return ids;
        }

        public int UpdateTrackPaths(string oldPrefix, string newPrefix)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = UsePostgres
                ? $@"UPDATE {MT}
                     SET file_path = @new || SUBSTRING(file_path FROM LENGTH(@old) + 1)
                     WHERE file_path LIKE @pattern"
                : $@"UPDATE {MT}
                     SET file_path = @new || SUBSTR(file_path, LENGTH(@old) + 1)
                     WHERE file_path LIKE @pattern ESCAPE '\'";
            var relOld = MusicPath.ToRelative(oldPrefix);
            AddParam(cmd, "@old", relOld);
            AddParam(cmd, "@new", MusicPath.ToRelative(newPrefix));
            AddParam(cmd, "@pattern", EscapeLike(relOld) + "%");
            return cmd.ExecuteNonQuery();
        }

        private static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

        // ── Helpers ───────────────────────────────────────────────────────────
        private static void AddParam(DbCommand cmd, string name, object value)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = name;
            p.Value = value;
            cmd.Parameters.Add(p);
        }

        private static void BindMixtape(DbCommand cmd, Mixtape m)
        {
            AddParam(cmd, "@id", m.Id);
            AddParam(cmd, "@name", m.Name);
            AddParam(cmd, "@desc", (object?)m.Description ?? DBNull.Value);
            AddParam(cmd, "@pub", m.IsPublished ? 1 : 0);
            AddParam(cmd, "@token", (object?)m.PublicToken ?? DBNull.Value);
            AddParam(cmd, "@created", m.CreatedAt);
            AddParam(cmd, "@updated", m.UpdatedAt);
            AddParam(cmd, "@slsk", m.IsSoulseekShared ? 1 : 0);
        }

        private static void BindTrack(DbCommand cmd, MixtapeTrack t)
        {
            AddParam(cmd, "@id", t.Id);
            AddParam(cmd, "@mid", t.MixtapeId);
            AddParam(cmd, "@path", MusicPath.ToRelative(t.FilePath));
            AddParam(cmd, "@title", (object?)t.Title ?? DBNull.Value);
            AddParam(cmd, "@artist", (object?)t.Artist ?? DBNull.Value);
            AddParam(cmd, "@album", (object?)t.Album ?? DBNull.Value);
            AddParam(cmd, "@dur", (object?)t.Duration ?? DBNull.Value);
            AddParam(cmd, "@ord", t.SortOrder);
        }

        private static Mixtape ReadMixtape(DbDataReader r) => new(
            r.GetString(0),
            r.GetString(1),
            r.IsDBNull(2) ? null : r.GetString(2),
            r.GetInt64(3) != 0,
            r.IsDBNull(4) ? null : r.GetString(4),
            r.GetInt64(5),
            r.GetInt64(6),
            IsSoulseekShared: r.GetInt64(7) != 0);

        private static MixtapeTrack ReadTrack(DbDataReader r) => new(
            r.GetString(0),
            r.GetString(1),
            MusicPath.ToAbsolute(r.GetString(2)),
            r.IsDBNull(3) ? null : r.GetString(3),
            r.IsDBNull(4) ? null : r.GetString(4),
            r.IsDBNull(5) ? null : r.GetString(5),
            r.IsDBNull(6) ? null : r.GetDouble(6),
            r.GetInt32(7));

        private DbConnection OpenConnection()
        {
            DbConnection conn = new NpgsqlConnection(ConnectionString);
            conn.Open();
            return conn;
        }
    }
}
