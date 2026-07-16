// <copyright file="UploadService.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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

using Microsoft.Extensions.Options;
using resonance.Files;
using resonance.Transfers;
using Soulseek;

namespace resonance.Transfers.Uploads
{
    using System;
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using System.Linq.Expressions;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.EntityFrameworkCore;
    using resonance.Events;
    using resonance.Relay;
    using resonance.Shares;
    using resonance.Users;
    using Serilog;

    /// <summary>
    ///     Manages uploads.
    /// </summary>
    public interface IUploadService
    {
        /// <summary>
        ///     Gets the upload governor.
        /// </summary>
        IUploadGovernor Governor { get; }

        /// <summary>
        ///     Gets the upload queue.
        /// </summary>
        IUploadQueue Queue { get; }

        /// <summary>
        ///     Adds the specified <paramref name="transfer"/>. Supersedes any existing record for the same file and username.
        /// </summary>
        /// <remarks>This should generally not be called; use <see cref="EnqueueAsync(string, string)"/> instead.</remarks>
        /// <param name="transfer"></param>
        void AddOrSupersede(Transfer transfer);

        /// <summary>
        ///     Enqueues the requested file.
        /// </summary>
        /// <param name="username">The username of the requesting user.</param>
        /// <param name="filename">The local filename of the requested file.</param>
        /// <returns>The operation context.</returns>
        Task<Transfer> EnqueueAsync(string username, string filename);

        /// <summary>
        ///     Uploads the specified enqueued <paramref name="transfer"/> to the requesting user.
        /// </summary>
        /// <param name="transfer">The Transfer to upload.</param>
        /// <returns>The operation context.</returns>
        /// <exception cref="ArgumentNullException">Thrown if the specified Transfer is null.</exception>
        /// <exception cref="TransferNotFoundException">Thrown if the specified Transfer ID can't be found in the database.</exception>
        /// <exception cref="InvalidOperationException">Thrown if the specified Transfer is not in the Queued | Locally state.</exception>
        /// <exception cref="DuplicateTransferException">Thrown if an upload matching the username and filename is already tracked by Soulseek.NET.</exception>
        /// <exception cref="NotFoundException">Thrown if the specified file can't be found on disk.</exception>
        Task<Transfer> UploadAsync(Transfer transfer);

        /// <summary>
        ///     Finds a single upload matching the specified <paramref name="expression"/>.
        /// </summary>
        /// <param name="expression">The expression to use to match uploads.</param>
        /// <returns>The found transfer, or default if not found.</returns>
        Transfer Find(Expression<Func<Transfer, bool>> expression);

        /// <summary>
        ///     Returns a summary of the uploads matching the specified <paramref name="expression"/>. This can be expensive;
        ///     consider caching.
        /// </summary>
        /// <param name="expression">The expression used to select uploads for summarization.</param>
        /// <returns>
        ///     The generated summary, including the number of files and total size in bytes.
        /// </returns>
        (int Files, long Bytes) Summarize(Expression<Func<Transfer, bool>> expression);

        /// <summary>
        ///     Gets upload statistics for the specified <paramref name="username"/>.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <param name="utcNow">An optional timestamp representing the current time in UTC.</param>
        /// <returns>The gathered statistics.</returns>
        UserUploadStatistics GetUserStatistics(string username, DateTime? utcNow = null);

        /// <summary>
        ///     Returns a list of all uploads matching the optional <paramref name="expression"/>.
        /// </summary>
        /// <param name="expression">An optional expression used to match uploads.</param>
        /// <param name="includeRemoved">A value indicating whether to include uploads that have been removed previously.</param>
        /// <returns>The list of uploads matching the specified expression, or all uploads if no expression is specified.</returns>
        List<Transfer> List(Expression<Func<Transfer, bool>> expression, bool includeRemoved);

        /// <summary>
        ///     Removes <see cref="TransferStates.Completed"/> uploads older than the specified <paramref name="age"/>.
        /// </summary>
        /// <param name="age">The age after which uploads are eligible for pruning, in minutes.</param>
        /// <param name="states">One or more states by which uploads are filtered for pruning.</param>
        /// <returns>The number of pruned uploads.</returns>
        int Prune(int age, params TransferStates[] states);

        /// <summary>
        ///     Removes the completed upload matching the specified <paramref name="id"/>.
        /// </summary>
        /// <remarks>This is a soft delete; the record is retained for historical retrieval.</remarks>
        /// <param name="id">The unique identifier of the upload.</param>
        /// <returns>A value indicating whether the record was removed.</returns>
        bool Remove(Guid id);

        /// <summary>
        ///     Removes all completed uploads matching the specified <paramref name="expression"/>.
        /// </summary>
        /// <remarks>This is a soft delete; the record is retained for historical retrieval.</remarks>
        /// <param name="expression">The expression used to match uploads.</param>
        /// <returns>The number of records removed.</returns>
        int Remove(Expression<Func<Transfer, bool>> expression);

        /// <summary>
        ///     Cancels the upload matching the specified <paramref name="id"/>, if it is in progress.
        /// </summary>
        /// <param name="id">The unique identifier for the upload.</param>
        /// <returns>A value indicating whether the upload was successfully cancelled.</returns>
        bool TryCancel(Guid id);

        /// <summary>
        ///     Fails the upload matching the specified <paramref name="id"/> with the specified <paramref name="exception"/>,
        ///     and sets the final state accordingly.
        /// </summary>
        /// <remarks>
        ///     This method is designed to be idempotent, meaning subsequent calls for a given transfer shouldn't change
        ///     the EndedAt or Exception properties if they have already been set. If the transfer State already includes
        ///     the terminal Completed flag, it is unchanged.
        /// </remarks>
        /// <param name="id">The unique identifier for the upload.</param>
        /// <param name="exception">The exception that caused the failure.</param>
        /// <returns>A value indicating whether the upload was successfully failed.</returns>
        bool TryFail(Guid id, Exception exception);

        /// <summary>
        ///     Gets the last known peer address for the specified <paramref name="username"/>.
        /// </summary>
        /// <param name="username">The username of the peer.</param>
        /// <returns>The IP address string, or null if unknown.</returns>
        string GetPeerAddress(string username);

        /// <summary>
        ///     Synchronously updates the specified <paramref name="transfer"/>.
        /// </summary>
        /// <param name="transfer">The transfer to update.</param>
        void Update(Transfer transfer);
    }

    /// <summary>
    ///     Manages uploads.
    /// </summary>
    public class UploadService : IUploadService
    {
        // how long a user stays in the offline cooldown after a failed upload; see OfflineCooldowns.
        private static readonly TimeSpan OfflineCooldownDuration = TimeSpan.FromSeconds(60);

        public UploadService(
            FileService fileService,
            IUserService userService,
            ISoulseekClient soulseekClient,
            IOptionsMonitor<Options> optionsMonitor,
            IShareService shareService,
            IRelayService relayService,
            IDbContextFactory<TransfersDbContext> contextFactory,
            EventBus eventBus,
            ITransferErrorNotificationService errorNotifications)
        {
            Files = fileService;
            Users = userService;
            Client = soulseekClient;
            Shares = shareService;
            Relay = relayService;
            ContextFactory = contextFactory;
            OptionsMonitor = optionsMonitor;
            EventBus = eventBus;
            ErrorNotifications = errorNotifications;

            Governor = new UploadGovernor(userService, optionsMonitor);
            Queue = new UploadQueue(userService, optionsMonitor);
        }

        /// <summary>
        ///     Gets the upload governor.
        /// </summary>
        public IUploadGovernor Governor { get; init; }

        /// <summary>
        ///     Gets the upload queue.
        /// </summary>
        public IUploadQueue Queue { get; init; }

        private FileService Files { get; }
        private ConcurrentDictionary<Guid, CancellationTokenSource> CancellationTokens { get; } = new ConcurrentDictionary<Guid, CancellationTokenSource>();
        private ISoulseekClient Client { get; set; }
        private IDbContextFactory<TransfersDbContext> ContextFactory { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Transfers.Uploads);
        private IOptionsMonitor<Options> OptionsMonitor { get; }
        private IRelayService Relay { get; }
        private IShareService Shares { get; set; }
        private IUserService Users { get; set; }
        private EventBus EventBus { get; }
        private ITransferErrorNotificationService ErrorNotifications { get; }
        private ConcurrentDictionary<string, bool> Locks { get; } = new();
        private ConcurrentDictionary<string, string> PeerAddresses { get; } = new();

        // when an upload fails because the remote user is offline, we stamp the username here. subsequent enqueue
        // requests for that user are cheaply rejected until the cooldown expires, instead of resolving files, hitting
        // the database, watching the user, and attempting a doomed upload. a misbehaving remote client that re-requests
        // a large queue thousands of times per minute while unreachable would otherwise trigger all of that work per
        // request. the user's own client will re-request once it is actually reachable again, after the cooldown.
        private ConcurrentDictionary<string, DateTime> OfflineCooldowns { get; } = new();

        /// <summary>
        ///     Gets the last known IP address for the specified <paramref name="username"/>.
        /// </summary>
        /// <param name="username">The username for which to retrieve the address.</param>
        /// <returns>The peer address, or null if not known.</returns>
        public string GetPeerAddress(string username) =>
            PeerAddresses.TryGetValue(username, out var addr) ? addr : null;

        /// <summary>
        ///     Adds the specified <paramref name="transfer"/>. Supersedes any existing record for the same file and username.
        /// </summary>
        /// <remarks>This should generally not be called; use <see cref="EnqueueAsync(string, string)"/> instead.</remarks>
        /// <param name="transfer">The transfer to add.</param>
        public void AddOrSupersede(Transfer transfer)
        {
            using var context = ContextFactory.CreateDbContext();

            var existing = context.Transfers
                .Where(t => t.Direction == TransferDirection.Upload)
                .Where(t => t.Username == transfer.Username)
                .Where(t => t.Filename == transfer.Filename)
                .Where(t => !t.Removed)
                .FirstOrDefault();

            if (existing != default)
            {
                Log.Debug("Superseding transfer record for {Filename} from {Username}", transfer.Filename, transfer.Username);
                existing.Removed = true;
            }

            context.Add(transfer);
            context.SaveChanges();
        }

        /// <summary>
        ///     Uploads the specified enqueued <paramref name="transfer"/> to the requesting user.
        /// </summary>
        /// <param name="transfer">The Transfer to upload.</param>
        /// <returns>The operation context.</returns>
        /// <exception cref="ArgumentNullException">Thrown if the specified Transfer is null.</exception>
        /// <exception cref="TransferNotFoundException">Thrown if the specified Transfer ID can't be found in the database.</exception>
        /// <exception cref="InvalidOperationException">Thrown if the specified Transfer is not in the Queued | Locally state.</exception>
        /// <exception cref="DuplicateTransferException">Thrown if an upload matching the username and filename is already tracked by Soulseek.NET.</exception>
        /// <exception cref="NotFoundException">Thrown if the specified file can't be found on disk.</exception>
        public async Task<Transfer> UploadAsync(Transfer transfer)
        {
            var cts = new CancellationTokenSource();
            var syncRoot = new SemaphoreSlim(1, 1);

            string host = default;
            string localFilename = default;
            long localFileLength = default;

            var lockName = $"{nameof(UploadAsync)}:{transfer.Username}:{transfer.Filename}";

            if (!Locks.TryAdd(lockName, true))
            {
                Log.Debug("Ignoring concurrent invocation; lock {LockName} already held", lockName);
                return null;
            }

            /*
                from this point forward, any exit from this method MUST result in an update to the Transfer record
                in the database that sets EndedAt and ensures that the State property includes the Completed flag

                failure to do so means records will get "stuck" in the database/on the UI

                additionally, any acquired locks/semaphores must be released, including (and most importantly) the queue slot
            */
            try
            {
                Log.Debug("Acquired lock {LockName}", lockName);

                /*
                    fetch an updated copy of the transfer record from the database; now that we are locked, we *should*
                    have exclusive access to this record

                    we're not using DbContext and tracked changes here because we don't want to hold a connection
                    open for the duration of the upload
                */
                transfer = Find(t => t.Id == transfer.Id)
                    ?? throw new TransferNotFoundException($"Transfer with ID {transfer.Id} not found");

                if (transfer.State != (TransferStates.Queued | TransferStates.Locally))
                {
                    throw new InvalidOperationException($"Invalid starting state for upload; expected {TransferStates.Queued | TransferStates.Locally}, encountered {transfer.State}");
                }

                /*
                    Soulseek.NET keeps an internal dictionary of all transfers for the duration of the transfer logic;
                    check that list to see if there's already an instance of this upload in it, just in case we've gotten
                    out of sync somehow
                */
                if (Client.Uploads.Any(u => u.Username == transfer.Username && u.Filename == transfer.Filename))
                {
                    throw new DuplicateTransferException("A duplicate upload of the same file to the same user is already registered");
                }

                // users with uploads must be watched so that we can keep informed of their online status, privileges, and
                // statistics. this is so that we can accurately determine their effective group.
                try
                {
                    if (!Users.IsWatched(transfer.Username))
                    {
                        await Users.WatchAsync(transfer.Username);
                    }
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Failed to watch user {Username}", transfer.Username);
                }

                // now that the user is watched, if their last known presence is offline, don't hand a doomed transfer
                // to Soulseek.NET (which would hold a slot and wait on a long connection timeout before failing).
                // fail fast; the throw is handled by the catch below, which records the offline cooldown. the user
                // requested this file but has since gone offline; their client re-requests when it reconnects.
                if (Users.TryGetCachedPresence(transfer.Username, out var presence) && presence == UserPresence.Offline)
                {
                    throw new UserOfflineException($"User {transfer.Username} appears to be offline");
                }

                Log.Information("Initializing upload of {Filename} to {Username}", transfer.Filename, transfer.Username);

                // locate the file on disk. we checked this once already when enqueueing, but it may have moved since
                // can throw NotFoundException
                (host, localFilename, localFileLength) = await ResolveFileInfoAsync(remoteFilename: transfer.Filename);

                using var rateLimiter = new RateLimiter(250, concurrencyLimit: 1, flushOnDispose: true);

                var topts = new TransferOptions(
                    stateChanged: (args) =>
                    {
                        Log.Debug("Upload of {Filename} to user {Username} changed state from {Previous} to {New}", localFilename, transfer.Username, args.PreviousState, args.Transfer.State);

                        // prevent Exceptions thrown during shutdown from updating the transfer record with related Exceptions;
                        // instead, allow these to be left "hanging" so that they are properly cleaned up at the next startup
                        if (Application.IsShuttingDown)
                        {
                            Log.Debug("Upload update of {Filename} to {Username} not persisted; app is shutting down", transfer.Filename, transfer.Username);
                            return;
                        }

                        transfer = transfer.WithSoulseekTransfer(args.Transfer);

                        if (args.Transfer.State.HasFlag(TransferStates.InProgress) && args.Transfer.IPEndPoint?.Address != null)
                        {
                            PeerAddresses[transfer.Username] = args.Transfer.IPEndPoint.Address.ToString();
                        }

                        // todo: broadcast
                        SynchronizedUpdate(transfer, semaphore: syncRoot, cancellationToken: cts.Token);
                    },
                    progressUpdated: (args) => rateLimiter.Invoke(() =>
                    {
                        // don't do anything unless the `transfer` within the outer scope is in the
                        // InProgress state; this will help prevent out-of-band updates that are sometimes
                        // being made after the transfer is completed, causing them to appear 'stuck'
                        if (transfer.State == TransferStates.InProgress)
                        {
                            // don't wait for the semaphore; if a previous progress update is still hanging, don't make
                            // the problem worse. this will result in fewer/jumpy updates on systems with slow filesystems
                            // but the alternative is to continue to stack slow writes on top of one another
                            if (syncRoot.Wait(millisecondsTimeout: 0, cts.Token))
                            {
                                try
                                {
                                    // update only the properties that we expect to change between progress updates
                                    // this helps prevent this update from 'stepping' on other updates
                                    transfer.BytesTransferred = args.Transfer.BytesTransferred;
                                    transfer.AverageSpeed = args.Transfer.AverageSpeed;

                                    using var context = ContextFactory.CreateDbContext();

                                    context.Transfers.Where(t => t.Id == transfer.Id).ExecuteUpdate(setter => setter
                                        .SetProperty(t => t.BytesTransferred, transfer.BytesTransferred)
                                        .SetProperty(t => t.AverageSpeed, transfer.AverageSpeed));
                                }
                                finally
                                {
                                    syncRoot.Release();
                                }
                            }
                            else
                            {
                                Log.Debug("Skipped progress update of {Filename} to {Username} {BytesTransferred}/{TotalBytes}; previous update still pending", transfer.Filename, transfer.Username, args.Transfer.BytesTransferred, args.Transfer.Size);
                            }
                        }
                    }),
                    seekInputStreamAutomatically: false,
                    disposeInputStreamOnCompletion: true, // note: don't set this to false!
                    governor: (tx, req, ct) => Governor.GetBytesAsync(tx.Username, req, ct),
                    reporter: (tx, att, grant, act) => Governor.ReturnBytes(tx.Username, att, grant, act),
                    slotAwaiter: (tx, ct) => Queue.AwaitStartAsync(tx.Username, tx.Filename),
                    slotReleased: (tx) => Queue.Complete(tx.Username, tx.Filename));

                // register the cancellation token
                CancellationTokens.TryAdd(transfer.Id, cts);

                // add the transfer to the UploadQueue so that it can become eligible for selection
                Queue.Enqueue(transfer.Username, transfer.Filename);
                transfer.EnqueuedAt = DateTime.UtcNow;
                SynchronizedUpdate(transfer, semaphore: syncRoot, cancellationToken: cts.Token);

                Soulseek.Transfer completedTransfer;

                if (host == Program.LocalHostName)
                {
                    completedTransfer = await Client.UploadAsync(
                        username: transfer.Username,
                        remoteFilename: transfer.Filename,
                        size: localFileLength,
                        inputStreamFactory: (startOffset) =>
                        {
#pragma warning disable S2930 // "IDisposables" should be disposed
                            // disposeInputStreamOnCompletion takes care of this
                            var stream = new FileStream(localFilename, FileMode.Open, FileAccess.Read);
#pragma warning restore S2930 // "IDisposables" should be disposed

                            stream.Seek(startOffset, SeekOrigin.Begin);
                            return Task.FromResult((Stream)stream);
                        },
                        options: topts,
                        cancellationToken: cts.Token);
                }
                else
                {
                    completedTransfer = await Client.UploadAsync(
                        username: transfer.Username,
                        remoteFilename: transfer.Filename,
                        size: localFileLength,
                        inputStreamFactory: (startOffset) => Relay.GetFileStreamAsync(agentName: host, filename: transfer.Filename, startOffset, id: transfer.Id),
                        options: topts,
                        cancellationToken: cts.Token);

                    Relay.TryCloseFileStream(host, id: transfer.Id);
                }

                // explicitly dispose the rate limiter to prevent updates from it beyond this point, and in doing so we
                // flushe any pending update, _probably_ pushing the state of the transfer back to InProgress
                rateLimiter.Dispose();

                // copy the completed transfer that was returned from Soulseek.NET in a terminal, fully updated state
                // over the top of the transfer record, then persist it
                transfer = transfer.WithSoulseekTransfer(completedTransfer);

                // todo: broadcast
                SynchronizedUpdate(transfer, semaphore: syncRoot, cancellationToken: CancellationToken.None);

                EventBus.Raise(new UploadFileCompleteEvent
                {
                    Timestamp = transfer.EndedAt.Value,
                    LocalFilename = localFilename,
                    RemoteFilename = transfer.Filename,
                    Transfer = transfer,
                });

                // a successful upload proves the user is reachable; lift any lingering offline cooldown immediately
                OfflineCooldowns.TryRemove(transfer.Username, out _);

                return transfer;
            }
            catch (NotFoundException ex)
            {
                Log.Error(ex, "Upload of {Filename} to user {Username} failed: {Message}", transfer.Filename, transfer.Username, ex.Message);

                TryFail(transfer.Id, "File could not be found", TransferStates.Completed | TransferStates.Aborted);
                _ = ErrorNotifications.NotifyUploadErrorAsync(transfer.Username, transfer.Filename, "File could not be found");

                // todo: broadcast
                SynchronizedUpdate(transfer, semaphore: syncRoot, cancellationToken: CancellationToken.None);

                throw;
            }
            catch (Exception ex)
            {
                if (IsExpectedPeerFailure(ex))
                {
                    // the remote user is offline, dropped the connection, rejected the transfer, or simply timed
                    // out; routine in a P2P network, so log quietly without the stack trace.
                    Log.Warning("Upload of {Filename} to user {Username} failed: {Message}", transfer.Filename, transfer.Username, ex.Message);
                }
                else
                {
                    Log.Error(ex, "Upload of {Filename} to user {Username} failed: {Message}", transfer.Filename, transfer.Username, ex.Message);
                }

                // if the user is offline, start a cooldown so we stop attempting (and re-resolving/re-watching) on
                // every subsequent request until they are actually reachable again.
                if (IsUserOffline(ex))
                {
                    OfflineCooldowns[transfer.Username] = DateTime.UtcNow;
                    Log.Debug("Started offline cooldown for {Username}", transfer.Username);
                }

                TryFail(transfer.Id, exception: ex);
                _ = ErrorNotifications.NotifyUploadErrorAsync(transfer.Username, transfer.Filename, ex.Message);

                // todo: broadcast
                SynchronizedUpdate(transfer, semaphore: syncRoot, cancellationToken: CancellationToken.None);

                throw;
            }
            finally
            {
                if (host != Program.LocalHostName)
                {
                    try
                    {
                        Relay.TryCloseFileStream(host, id: transfer.Id);
                    }
                    catch
                    {
                        // noop
                    }
                }

                try
                {
                    Locks.TryRemove(lockName, out _);
                    Log.Debug("Released lock {LockName}", lockName);

                    CancellationTokens.TryRemove(transfer.Id, out _);

                    // if for some reason this logic exits without the slotReleased delegate and Complete() being invoked,
                    // the file will get stuck in the queue and prevent any further uploads to the user. be extra cautious
                    // and ensure it gets removed
                    Queue.TryComplete(username: transfer.Username, filename: transfer.Filename);
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Failed to finalize upload of {Filename} to {Username}: {Message}", transfer.Filename, transfer.Username, ex.Message);
                }
            }
        }

        /// <summary>
        ///     Enqueues the requested file.
        /// </summary>
        /// <param name="username">The username of the requesting user.</param>
        /// <param name="filename">The local filename of the requested file.</param>
        /// <returns>The operation context.</returns>
        public async Task<Transfer> EnqueueAsync(string username, string filename)
        {
            if (string.IsNullOrEmpty(username))
            {
                throw new ArgumentNullException(nameof(username), "Username is required");
            }

            if (string.IsNullOrEmpty(filename))
            {
                throw new ArgumentNullException(nameof(filename), "Filename is required");
            }

            // if we recently failed to upload to this user because they were offline, don't do any work; a reachable
            // client re-requests on its own once it reconnects, so retrying on their behalf just churns resources.
            if (IsInOfflineCooldown(username))
            {
                Log.Debug("Skipping upload enqueue of {Filename} to {Username}; user is in offline cooldown", filename, username);
                return null;
            }

            // if the user's last known presence (from watching them) is offline, don't bother enqueueing. this gates
            // the bulk of a re-request storm from a user who queued a large batch and then went offline: their client
            // keeps asking, but we already know they're unreachable. the presence cache flips back to online (via an
            // unsolicited server status event) the moment they return, so online users are never blocked.
            if (Users.TryGetCachedPresence(username, out var presence) && presence == UserPresence.Offline)
            {
                Log.Debug("Skipping upload enqueue of {Filename} to {Username}; user is offline", filename, username);
                return null;
            }

            var lockName = $"{nameof(EnqueueAsync)}:{username}:{filename}";

            if (!Locks.TryAdd(lockName, true))
            {
                Log.Debug("Ignoring concurrent upload enqueue attempt; lock {LockName} already held", lockName);
                return null;
            }

            Guid id = Guid.NewGuid();

            try
            {
                Log.Debug("Acquired lock {LockName}", lockName);

                Log.Information("Upload of {Filename} to {Username} requested", filename, username);

                using var context = ContextFactory.CreateDbContext();

                /*
                    first, get all past uploads to this user for this filename
                */
                var existingRecords = context.Transfers
                    .Where(t => t.Direction == TransferDirection.Upload)
                    .Where(t => t.Username == username)
                    .Where(t => t.Filename == filename)
                    .AsNoTracking()
                    .ToList();

                var existingInProgressRecords = existingRecords
                    .Where(t => t.EndedAt == null || !t.State.HasFlag(TransferStates.Completed))
                    .ToList();

                /*
                    if there are any that haven't ended yet (checking a few ways out of paranoia), then there's already
                    an existing transfer record covering this file, and we're already enqueued. nothing more to do!
                */
                if (existingInProgressRecords.Count != 0)
                {
                    Log.Information("Upload of {Filename} to {Username} is already queued or is in progress (ids: {Ids})", filename, username, string.Join(", ", existingInProgressRecords.Select(t => t.Id)));
                    return null;
                }

                /*
                    check the tracked upload dictionary in Soulseek.NET to see if it knows about this already
                    it shouldn't, if the slskd database doesn't. but things could get desynced
                */
                if (Client.Uploads.Any(u => u.Username == username && u.Filename == filename))
                {
                    throw new DuplicateTransferException("A duplicate upload of the same file to the same user is already registered");
                }

                /*
                    no existing transfers. next, check to see if they are requesting a file we are sharing

                    we do this after checking the database because database I/O is "cheaper" than disk and potentially
                    network (if we check a relay)
                */
                string host = default;
                string localFilename = default;
                long localFileLength = default;

                try
                {
                    (host, localFilename, localFileLength) = await ResolveFileInfoAsync(remoteFilename: filename);
                }
                catch (NotFoundException)
                {
                    Log.Information("Upload of {Filename} to {Username} {Rejected}: {Message}", filename, username, "REJECTED", "File not shared.");
                    _ = ErrorNotifications.NotifyUploadRejectedAsync(username, filename, "File not shared");
                    throw new DownloadEnqueueException($"File not shared.");
                }

                Log.Debug("Resolved {Remote} to physical file {Physical} on host '{Host}'", filename, localFilename, host);

                /*
                    we're cleared to enqueue! create a new transfer record, and automatically mark any existing records
                    we found as 'removed' to clean up the UI
                */
                var transfer = new Transfer()
                {
                    Id = id,
                    Username = username,
                    Direction = TransferDirection.Upload,
                    Filename = filename, // important! use the remote filename
                    Size = localFileLength,
                    StartOffset = 0, // potentially updated later during handshaking
                    RequestedAt = DateTime.UtcNow,
                    State = TransferStates.Queued | TransferStates.Locally,
                };

                context.Add(transfer);

                foreach (var record in existingRecords.Where(t => !t.Removed))
                {
                    record.Removed = true;
                    context.Update(record);
                    Log.Debug("Marked existing upload record of {Filename} to {Username} removed (id: {Id})", filename, username, record.Id);
                }

                context.SaveChanges();

                Log.Information("Successfully enqueued upload of {Filename} to {Username} (id: {Id})", filename, username, id);

                // users with uploads must be watched so that we can keep informed of their online status, privileges, and
                // statistics. this is so that we can accurately determine their effective group.
                try
                {
                    if (!Users.IsWatched(username))
                    {
                        await Users.WatchAsync(username);
                    }
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Failed to watch user {Username}", username);
                }

                /*
                    schedule the upload immediately

                    Task.Run can fail due to thread pool exhaustion or OOM, and this *SHOULD* throw up the chain and
                    fail the enqueue request
                */
                _ = Task.Run(() => UploadAsync(transfer)).ContinueWith(task =>
                {
                    if (task.IsCompletedSuccessfully)
                    {
                        Log.Information("Task for upload of {Filename} to {Username} completed successfully", filename, username);
                        return;
                    }

                    /*
                        things that can cause us to arrive here:

                        * file not found (moved, deleted somehow)
                        * transfer record deleted somehow
                        * transfer record updated so that it's no longer in Queued | Locally
                        * Soulseek.NET already tracking an identical upload (slskd <> Soulseek.NET desync)
                    */
                    if (IsExpectedPeerFailure(task.Exception))
                    {
                        Log.Warning("Task for upload of {Filename} to {Username} did not complete successfully: {Error}", filename, username, task.Exception.Message);
                    }
                    else
                    {
                        Log.Error(task.Exception, "Task for upload of {Filename} to {Username} did not complete successfully: {Error}", filename, username, task.Exception.Message);
                    }

                    if (!TryFail(id, task.Exception))
                    {
                        Log.Error(task.Exception, "Failed to clean up transfer {Id} after failed execution: {Message}", id, task.Exception.Message);
                    }
                });

                return transfer;
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to enqueue upload of {Filename} to {Username}: {Message}", filename, username, ex.Message);

                if (!TryFail(id, exception: ex))
                {
                    Log.Error(ex, "Failed to clean up transfer {Id} after failed enqueue: {Message}", id, ex.Message);
                    throw;
                }

                throw;
            }
            finally
            {
                if (Locks.TryRemove(lockName, out _))
                {
                    Log.Debug("Released lock {LockName}", lockName);
                }
            }
        }

        /// <summary>
        ///     Finds a single upload matching the specified <paramref name="expression"/>.
        /// </summary>
        /// <param name="expression">The expression to use to match uploads.</param>
        /// <returns>The found transfer, or default if not found.</returns>
        public Transfer Find(Expression<Func<Transfer, bool>> expression)
        {
            try
            {
                using var context = ContextFactory.CreateDbContext();

                return context.Transfers
                    .AsNoTracking()
                    .Where(t => t.Direction == TransferDirection.Upload)
                    .Where(expression).FirstOrDefault();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to find upload: {Message}", ex.Message);
                throw;
            }
        }

        /// <summary>
        ///     Returns a summary of the uploads matching the specified <paramref name="expression"/>. This can be expensive;
        ///     consider caching.
        /// </summary>
        /// <param name="expression">The expression used to select uploads for summarization.</param>
        /// <returns>
        ///     The generated summary, including the number of files and total size in bytes.
        /// </returns>
        public (int Files, long Bytes) Summarize(Expression<Func<Transfer, bool>> expression)
        {
            expression ??= t => true;

            try
            {
                using var context = ContextFactory.CreateDbContext();

                var query = context.Transfers
                    .AsNoTracking()
                    .Where(t => t.Direction == TransferDirection.Upload)
                    .Where(expression)
                    .GroupBy(t => true) // https://stackoverflow.com/a/25489456: The GroupBy(x => true) statement places all items into a single group. The Select statement the allows operations against each group.
                    .Select(t => new
                    {
                        Files = t.Count(),
                        Bytes = t.Sum(x => x.Size),
                    });

                Log.Verbose("{Method} SQL: {@Query}", nameof(Summarize), query.ToQueryString());

                var stats = query.FirstOrDefault();

                return (stats?.Files ?? 0, stats?.Bytes ?? 0);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to list uploads: {Message}", ex.Message);
                throw;
            }
        }

        /// <summary>
        ///     Returns a list of all uploads matching the optional <paramref name="expression"/>.
        /// </summary>
        /// <param name="expression">An optional expression used to match uploads.</param>
        /// <param name="includeRemoved">A value indicating whether to include uploads that have been removed previously.</param>
        /// <returns>The list of uploads matching the specified expression, or all uploads if no expression is specified.</returns>
        public List<Transfer> List(Expression<Func<Transfer, bool>> expression, bool includeRemoved)
        {
            expression ??= t => true;

            try
            {
                using var context = ContextFactory.CreateDbContext();

                return context.Transfers
                    .AsNoTracking()
                    .Where(t => t.Direction == TransferDirection.Upload)
                    .Where(t => !t.Removed || includeRemoved)
                    .Where(expression)
                    .ToList();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to list uploads: {Message}", ex.Message);
                throw;
            }
        }

        /// <summary>
        ///     Removes <see cref="TransferStates.Completed"/> uploads older than the specified <paramref name="age"/>.
        /// </summary>
        /// <param name="age">The age after which uploads are eligible for pruning, in minutes.</param>
        /// <param name="states">One or more states by which uploads are filtered for pruning.</param>
        /// <returns>The number of pruned uploads.</returns>
        public int Prune(int age, params TransferStates[] states)
        {
            var statesSet = new HashSet<int>(states.Select(s => (int)s));

            if (!statesSet.All(s => ((TransferStates)s).HasFlag(TransferStates.Completed)))
            {
                throw new ArgumentException($"Each state must include {TransferStates.Completed}", nameof(states));
            }

            try
            {
                using var context = ContextFactory.CreateDbContext();

                var cutoffDateTime = DateTime.UtcNow.AddMinutes(-age);

                var pruned = context.Transfers
                    .Where(t => t.Direction == TransferDirection.Upload)
                    .Where(t => !t.Removed)
                    .Where(t => t.EndedAt.HasValue && t.EndedAt.Value < cutoffDateTime)
                    .Where(t => statesSet.Contains((int)t.State))
                    .ExecuteUpdate(r => r.SetProperty(c => c.Removed, true));

                if (pruned > 0)
                {
                    Log.Debug("Pruned {Count} expired uploads with states {States}", pruned, statesSet);
                }

                return pruned;
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to prune uploads: {Message}", ex.Message);
                throw;
            }
        }

        /// <summary>
        ///     Removes the completed upload matching the specified <paramref name="id"/>.
        /// </summary>
        /// <remarks>This is a soft delete; the record is retained for historical retrieval.</remarks>
        /// <param name="id">The unique identifier of the upload.</param>
        /// <returns>A value indicating whether the record was removed.</returns>
        public bool Remove(Guid id)
        {
            return Remove(t => t.Id == id) > 0;
        }

        /// <summary>
        ///     Removes all completed uploads matching the specified <paramref name="expression"/>.
        /// </summary>
        /// <remarks>This is a soft delete; the record is retained for historical retrieval.</remarks>
        /// <param name="expression">The expression used to match uploads.</param>
        /// <returns>The number of records removed.</returns>
        public int Remove(Expression<Func<Transfer, bool>> expression)
        {
            try
            {
                using var context = ContextFactory.CreateDbContext();

                var count = context.Transfers
                    .Where(t => t.Direction == TransferDirection.Upload)
                    .Where(t => TransferStateCategories.Completed.Contains(t.State))
                    .Where(expression)
                    .ExecuteUpdate(r => r.SetProperty(c => c.Removed, true));

                Log.Debug("Removed {Count} uploads by expression", count);
                return count;
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to remove uploads by expression: {Message}", ex.Message);
                throw;
            }
        }

        /// <summary>
        ///     Cancels the upload matching the specified <paramref name="id"/>, if it is in progress.
        /// </summary>
        /// <param name="id">The unique identifier for the upload.</param>
        /// <returns>A value indicating whether the upload was successfully cancelled.</returns>
        public bool TryCancel(Guid id)
        {
            if (CancellationTokens.TryRemove(id, out var cts))
            {
                cts.Cancel();
                return true;
            }

            return false;
        }

        /// <summary>
        ///     Fails the upload matching the specified <paramref name="id"/> with the specified <paramref name="exception"/>,
        ///     and sets the final state accordingly.
        /// </summary>
        /// <remarks>
        ///     This method is designed to be idempotent, meaning subsequent calls for a given transfer shouldn't change
        ///     the EndedAt or Exception properties if they have already been set. If the transfer State already includes
        ///     the terminal Completed flag, it is unchanged.
        /// </remarks>
        /// <param name="id">The unique identifier for the upload.</param>
        /// <param name="exception">The exception that caused the failure.</param>
        /// <returns>A value indicating whether the upload was successfully failed.</returns>
        public bool TryFail(Guid id, Exception exception)
        {
            var state = exception switch
            {
                NotFoundException => TransferStates.Aborted,
                OperationCanceledException => TransferStates.Cancelled,
                TimeoutException => TransferStates.TimedOut,
                _ => TransferStates.Errored,
            };

            return TryFail(id, exception.Message, state);
        }

        /// <summary>
        ///     Synchronously updates the specified <paramref name="transfer"/>.
        /// </summary>
        /// <param name="transfer">The transfer to update.</param>
        public void Update(Transfer transfer)
        {
            using var context = ContextFactory.CreateDbContext();

            context.Update(transfer);
            context.SaveChanges();
        }

        /// <summary>
        ///     Gets upload statistics for the specified <paramref name="username"/>.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <param name="utcNow">An optional timestamp representing the current time in UTC.</param>
        /// <returns>The gathered statistics.</returns>
        public UserUploadStatistics GetUserStatistics(string username, DateTime? utcNow = null)
        {
            utcNow ??= DateTime.UtcNow;
            var dailyCutoff = utcNow.Value.AddDays(-1);
            var weeklyCutoff = utcNow.Value.AddDays(-7);

            using var context = ContextFactory.CreateDbContext();

            var failedStates = TransferStateCategories.Failed.ToList();
            var successState = TransferStates.Completed | TransferStates.Succeeded;

            var stats = context.Transfers
                .AsNoTracking()
                .Where(t => t.Username == username)
                .Where(t => t.Direction == TransferDirection.Upload)
                .Where(t => t.EndedAt == null || t.StartedAt >= weeklyCutoff)
                .GroupBy(t => 1) // aggregate everything into one row
                .Select(g => new UserUploadStatistics
                {
                    QueuedFiles = g.Count(t => t.EndedAt == null),
                    QueuedBytes = g.Where(t => t.EndedAt == null).Sum(t => (long?)t.Size) ?? 0,

                    // note: this generates some funky json_each() expression under the hood; it's an EF optimization
                    // that helps with optimization of query plans. i've tried expanding this out to force an IN
                    // and there's either no difference, or there's a slight improvement with the json_each method.
                    WeeklyFailedFiles = g.Count(t => t.StartedAt >= weeklyCutoff && failedStates.Contains(t.State)),

                    WeeklySucceededFiles = g.Count(t => t.StartedAt >= weeklyCutoff && t.State == successState),
                    WeeklySucceededBytes = g.Where(t => t.StartedAt >= weeklyCutoff && t.State == successState)
                        .Sum(t => (long?)t.Size) ?? 0,

                    DailyFailedFiles = g.Count(t => t.StartedAt >= dailyCutoff && failedStates.Contains(t.State)),

                    DailySucceededFiles = g.Count(t => t.StartedAt >= dailyCutoff && t.State == successState),
                    DailySucceededBytes = g.Where(t => t.StartedAt >= dailyCutoff && t.State == successState)
                        .Sum(t => (long?)t.Size) ?? 0,
                })
                .FirstOrDefault();

            return stats ?? new UserUploadStatistics();
        }

        /// <summary>
        ///     Determines whether the given <paramref name="exception"/> represents an expected peer/connection
        ///     failure (e.g. the remote user disconnected or reset the connection mid-transfer) rather than an
        ///     application error. These are routine in a P2P network and should be logged quietly.
        /// </summary>
        /// <param name="exception">The exception to classify.</param>
        /// <returns>A value indicating whether the failure is an expected peer/connection failure.</returns>
        private static bool IsExpectedPeerFailure(Exception exception)
        {
            for (var ex = exception; ex is not null; ex = ex.InnerException)
            {
                // routine, peer- or network-originated outcomes in a P2P network: the remote user is offline
                // (UserOfflineException), rejected or aborted the transfer (TransferException /
                // TransferRejectedException), the connection dropped (ConnectionException), the peer's address
                // couldn't be resolved (UserEndPointException), or things simply timed out. All Soulseek peer
                // failures derive from SoulseekClientException; none of these indicate a fault on our side, so
                // they should not be logged at ERROR.
                if (ex is SoulseekClientException or TimeoutException or OperationCanceledException)
                {
                    return true;
                }

                // a faulted Task surfaces as an AggregateException that may carry several causes; treat the whole
                // thing as expected only when every cause is.
                if (ex is AggregateException aggregate)
                {
                    return aggregate.Flatten().InnerExceptions.All(IsExpectedPeerFailure);
                }
            }

            return false;
        }

        /// <summary>
        ///     Determines whether the given <paramref name="exception"/> indicates that the remote user is offline.
        /// </summary>
        /// <param name="exception">The exception to classify.</param>
        /// <returns>A value indicating whether the failure was caused by the user being offline.</returns>
        private static bool IsUserOffline(Exception exception)
        {
            for (var ex = exception; ex is not null; ex = ex.InnerException)
            {
                if (ex is UserOfflineException)
                {
                    return true;
                }

                if (ex is AggregateException aggregate)
                {
                    return aggregate.Flatten().InnerExceptions.Any(IsUserOffline);
                }
            }

            return false;
        }

        /// <summary>
        ///     Determines whether the specified <paramref name="username"/> is within the offline cooldown window
        ///     following a recent failed upload. Expired entries are removed as a side effect.
        /// </summary>
        /// <param name="username">The username to check.</param>
        /// <returns>A value indicating whether the user is currently in an offline cooldown.</returns>
        private bool IsInOfflineCooldown(string username)
        {
            if (OfflineCooldowns.TryGetValue(username, out var lastOfflineAt))
            {
                if (DateTime.UtcNow - lastOfflineAt < OfflineCooldownDuration)
                {
                    return true;
                }

                // cooldown expired; clean up so the dictionary doesn't grow unbounded
                OfflineCooldowns.TryRemove(username, out _);
            }

            return false;
        }

        private bool TryFail(Guid id, string exception, TransferStates state)
        {
            var t = Find(t => t.Id == id);

            if (t is null)
            {
                return false;
            }

            t.EndedAt ??= DateTime.UtcNow;

            // Soulseek.NET will include the filename and username in some messages; this is useful for many things but not tracking
            // exceptions in a database. when we encounter one of these, drop the first segment.
            var m = exception;
            t.Exception ??= m.Contains(':') ? m.Substring(m.IndexOf(':') + 1).Trim() : m;

            if (!t.State.HasFlag(TransferStates.Completed))
            {
                t.State = TransferStates.Completed | state;
            }

            try
            {
                Update(t);
                return true;
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to update database: {Message}", ex.Message);
                return false;
            }
        }

        /// <summary>
        ///     Resolves a remote file's location and size from shares and potentially disk.
        /// </summary>
        /// <param name="remoteFilename">The file to resolve.</param>
        /// <returns>The resolved host, filename (on disk), and length.</returns>
        /// <exception cref="NotFoundException">Thrown if the file can't be located, either in a share or on disk.</exception>
        private async Task<(string Host, string Filename, long Length)> ResolveFileInfoAsync(string remoteFilename)
        {
            string host;
            string filename;
            long length;

            /*
                locate the file and the stored details from shares.
                the size returned here will be the size the remote client is expecting.

                throws NotFoundException
            */
            (host, filename, length) = await Shares.ResolveFileAsync(remoteFilename);

            Log.Debug("Resolved shared file {RemoteFilename} to host {Host} and file {ShareFilename} (length: {ShareLength})", remoteFilename, host, filename, length);

            /*
                if the file is hosted locally, do some quick I/O to check to see if the file still exists at the location
                and of the size stored in the scan. the cost is negligible and this will keep transfers that are doomed
                to fail out of our queue.
            */
            if (host == Program.LocalHostName)
            {
                var info = Files.ResolveFileInfo(filename);

                // if the file doesn't exist we can't continue; shares have diverged from disk
                if (!info.Exists)
                {
                    Shares.RequestScan();
                    Log.Warning("The shared file '{File}' could not be located on disk. A share scan should be performed", filename);
                    throw new NotFoundException($"The file '{filename}' could not be located on disk. A share scan should be performed.");
                }

                // shares have diverged from disk, but we *MIGHT* be able to upload this file, if the remote client
                // doesn't care that the size is exact.  we definitely need to re-scan though.
                if (info.Length != length)
                {
                    Log.Warning("The length of shared file '{File}' differs between the share ({ShareSize}) and disk ({DiskSize}). A share scan should be performed", filename, length, info.Length);
                    Shares.RequestScan();
                }

                length = info.Length;
            }
            else if (!OptionsMonitor.CurrentValue.Flags.OptimisticRelayFileInfo)
            {
                /*
                    if the file is hosted on a relay agent and the user has set the pessimistic flag to true,
                    get the file info from the agent.

                    this was, at one time, the default behavior, but users complained that it caused a lot of timeouts
                    so now it is opt-in.
                */
                var (exists, relayLength) = await Relay.GetFileInfoAsync(agentName: host, remoteFilename);

                if (!exists || relayLength <= 0)
                {
                    // todo: force a remote scan
                    throw new NotFoundException($"The file '{remoteFilename}' could not be located on Agent {host}. A share scan should be performed.");
                }

                if (relayLength != length)
                {
                    // todo: force a remote scan
                    Log.Warning("The length of shared file '{File}' on host {Host} differs between the share ({ShareSize}) and disk ({DiskSize}). A share scan should be performed", filename, host, length, relayLength);
                }

                length = relayLength;
            }

            return (host, filename, length);
        }

        private void SynchronizedUpdate(Transfer transfer, SemaphoreSlim semaphore, CancellationToken cancellationToken = default)
        {
            semaphore.Wait(cancellationToken);

            try
            {
                Update(transfer);
            }
            finally
            {
                semaphore.Release();
            }
        }
    }
}
