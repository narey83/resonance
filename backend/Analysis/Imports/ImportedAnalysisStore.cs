// <copyright file="ImportedAnalysisStore.cs" company="John Narey">
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

namespace resonance.Analysis.Imports
{
    using System;
    using System.Collections.Generic;
    using System.Data.Common;
    using System.Threading;
    using System.Threading.Tasks;

    // Separate immutable source snapshots. Never writes native analysis fields or music tags.
    public interface IImportedAnalysisStore
    {
        Task<IReadOnlyList<ImportedSourceSummary>> List(string relativePath, CancellationToken ct);

        Task<ImportedSnapshot> Get(string collectionSha256, string relativePath, CancellationToken ct);
        Task<bool> Insert(string collectionSha256, string relativePath, ValidatedImport snapshot, double allowance, string sourceXmlSha256, CancellationToken ct);
    }

    public record ImportedSnapshot(string SourceTrackId, string AudioSha256, long AudioBytes, string DocumentSha256, string ExportJson, double AllowedEndOverrunSeconds, string SourceXmlSha256);

    public record ImportedSourceSummary(string CollectionSha256, string SourceTrackId, string DocumentSha256, DateTime ImportedAt, string SourceXmlSha256);

    public class ImportedAnalysisStore : IImportedAnalysisStore
    {
        public ImportedAnalysisStore(Func<DbConnection> connectionFactory, bool usePostgres = true)
        {
            ConnectionFactory = connectionFactory;
            Table = usePostgres ? "analysis.imported_track_analysis" : "imported_track_analysis";
        }
        private string Table { get; }

        private Func<DbConnection> ConnectionFactory { get; }

        public async Task<ImportedSnapshot> Get(string collectionSha256, string relativePath, CancellationToken ct)
        {
            await using var connection = await Open(ct);
            using var command = connection.CreateCommand();
            command.CommandText = $@"SELECT source_track_id,audio_sha256,audio_bytes,document_sha256,export_json,
                allowed_end_overrun_seconds,source_xml_sha256 FROM {Table}
                WHERE collection_sha256=@c AND library_path=@p";
            Parameter(command, "@c", collectionSha256.ToLowerInvariant());
            Parameter(command, "@p", relativePath);
            await using var reader = await command.ExecuteReaderAsync(ct);
            return await reader.ReadAsync(ct)
                ? new ImportedSnapshot(reader.GetString(0), reader.GetString(1), reader.GetInt64(2), reader.GetString(3), reader.GetString(4), reader.GetDouble(5), reader.IsDBNull(6) ? null : reader.GetString(6))
                : null;
        }

        public async Task<IReadOnlyList<ImportedSourceSummary>> List(string relativePath, CancellationToken ct)
        {
            await using var connection = await Open(ct);
            using var command = connection.CreateCommand();
            command.CommandText = $@"SELECT collection_sha256,source_track_id,document_sha256,imported_at,source_xml_sha256
                FROM {Table} WHERE library_path=@p
                ORDER BY imported_at DESC,collection_sha256";
            Parameter(command, "@p", relativePath);
            var rows = new List<ImportedSourceSummary>();
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                rows.Add(new ImportedSourceSummary(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetDateTime(3), reader.IsDBNull(4) ? null : reader.GetString(4)));
            }

            return rows;
        }

        // ON CONFLICT never updates. A changed snapshot requires a different collection identity;
        // native analysis, edits and earlier imported snapshots stay intact even under concurrency.
        public async Task<bool> Insert(string collectionSha256, string relativePath, ValidatedImport snapshot, double allowance, string sourceXmlSha256, CancellationToken ct)
        {
            await using var connection = await Open(ct);
            using var command = connection.CreateCommand();
            command.CommandText = $@"INSERT INTO {Table}
                (collection_sha256,library_path,source_kind,source_track_id,audio_sha256,audio_bytes,
                 document_sha256,export_json,allowed_end_overrun_seconds,source_xml_sha256)
                VALUES(@c,@p,'rekordbox',@t,@a,@b,@d,@j,@o,@x) ON CONFLICT DO NOTHING";
            Parameter(command, "@c", collectionSha256.ToLowerInvariant());
            Parameter(command, "@p", relativePath);
            Parameter(command, "@t", snapshot.TrackId);
            Parameter(command, "@a", snapshot.AudioSha256);
            Parameter(command, "@b", snapshot.AudioBytes);
            Parameter(command, "@d", snapshot.DocumentSha256);
            Parameter(command, "@j", snapshot.Json);
            Parameter(command, "@o", allowance);
            Parameter(command, "@x", sourceXmlSha256.ToLowerInvariant());
            return await command.ExecuteNonQueryAsync(ct) == 1;
        }

        private static void Parameter(DbCommand command, string name, object value)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            parameter.Value = value;
            command.Parameters.Add(parameter);
        }

        private async Task<DbConnection> Open(CancellationToken ct)
        {
            var connection = ConnectionFactory();
            try
            {
                await connection.OpenAsync(ct);
                return connection;
            }
            catch
            {
                await connection.DisposeAsync();
                throw;
            }
        }
    }
}
