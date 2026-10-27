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
    using Dapper;
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

        /// <summary>Stops admission, cancels active uploads and drains their cleanup.</summary>
        /// <returns>The task that completes when all upload work has exited.</returns>
        Task StopAsync();

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
        ///     Restarts any uploads to the specified <paramref name="username"/> that were parked because the user was
        ///     offline when the upload was last attempted.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <returns>The number of uploads for which a restart was scheduled.</returns>
        int ResumeParkedUploads(string username);

        /// <summary>
        ///     Cancels any uploads to the specified <paramref name="username"/> that are parked because the user was
        ///     offline when the upload was last attempted.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <returns>The number of uploads that were cancelled.</returns>
        int PurgeParkedUploads(string username);

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

        /// <summary>Lists every active upload and a database-limited recent history.</summary>
        /// <returns>All matching active transfers and at most the requested number of completed transfers.</returns>
        List<Transfer> ListCapped(bool includeRemoved, bool activeOnly, int maxCompleted);

        /// <summary>Lists dangling transfers, including removed records, for startup recovery.</summary>
        /// <returns>Transfers that are unfinished or lack a completed state, including removed records.</returns>
        List<Transfer> ListForRecovery() => List(t => t.EndedAt == null || !TransferStateCategories.Completed.Contains(t.State), includeRemoved: true);

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
        ///     Gets the last known peer addresses for the specified <paramref name="usernames"/>, falling back to
        ///     persisted network info for users not seen with an in-progress transfer since the application started.
        /// </summary>
        /// <param name="usernames">The usernames of the peers.</param>
        /// <returns>A dictionary of username to IP address string, containing only usernames for which an address is known.</returns>
        IReadOnlyDictionary<string, string> GetPeerAddresses(IEnumerable<string> usernames);

        /// <summary>
        ///     Synchronously updates the specified <paramref name="transfer"/>.
        /// </summary>
        /// <param name="transfer">The transfer to update.</param>
        void Update(Transfer transfer);
    }

    /// <summary>
    ///     Manages uploads.
    /// </summary>
    public class UploadService : IUploadService, IAsyncDisposable
    {
        public UploadService(
            FileService fileService,
            IUserService userService,
            ISoulseekClient soulseekClient,
            IOptionsMonitor<Options> optionsMonitor,
            IShareService shareService,
            IRelayService relayService,
            IDbContextFactory<TransfersDbContext> contextFactory,
            EventBus eventBus,
            ITransferErrorNotificationService errorNotifications,
            ConnectionStringDictionary connectionStrings)
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
            NetworkInfoStore = new TransferNetworkInfoStore(connectionStrings);

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

        private UploadWorkLifetime Work { get; } = new();

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
        private TransferNetworkInfoStore NetworkInfoStore { get; }

        /// <inheritdoc/>
        public Task StopAsync() => Work.StopAsync();

        /// <inheritdoc/>
        public ValueTask DisposeAsync() => Work.DisposeAsync();

        /// <summary>
        ///     Gets the last known IP addresses for the specified <paramref name="usernames"/>, falling back to
        ///     persisted network info (<c>transfers."TransferNetworkInfo"</c>) for any not seen with an in-progress
        ///     upload since the application started.
        /// </summary>
        /// <param name="usernames">The usernames for which to retrieve addresses.</param>
        /// <returns>A dictionary of username to IP address string, containing only usernames for which an address is known.</returns>
        public IReadOnlyDictionary<string, string> GetPeerAddresses(IEnumerable<string> usernames)
        {
            var result = new Dictionary<string, string>();
            var missing = new List<string>();

            foreach (var username in usernames.Distinct())
            {
                if (PeerAddresses.TryGetValue(username, out var addr))
                {
                    result[username] = addr;
                }
                else
                {
                    missing.Add(username);
                }
            }

            if (missing.Count > 0)
            {
                try
                {
                    var rows = NetworkInfoStore.GetPeerAddresses(missing);

                    foreach (var (username, ip) in rows)
                    {
                        result[username] = ip;
                        PeerAddresses.TryAdd(username, ip);
                    }
                }
                catch (Exception ex)
                {
                    Log.Debug(ex, "Failed to look up persisted peer addresses for {Count} user(s)", missing.Count);
                }
            }

            return result;
        }

        /// <summary>
        ///     Adds the specified <paramref name="transfer"/>. Supersedes any existing record for the same file and username.
        /// </summary>
        /// <remarks>This should generally not be called; use <see cref="EnqueueAsync(string, string)"/> instead.</remarks>
        /// <param name="transfer">The transfer to add.</param>
        public void AddOrSupersede(Transfer transfer)
        {
            // Shares EnqueueAsync's per-(username, filename) lock (same lock name, rather than a lock
            // of its own) so the two can never race each other for the same user's file. Matches
            // EnqueueAsync's own semantics for lock contention: skip the work rather than wait for it.
            var lockName = $"{nameof(EnqueueAsync)}:{transfer.Username}:{transfer.Filename}";

            if (!Locks.TryAdd(lockName, true))
            {
                Log.Debug("Ignoring concurrent AddOrSupersede for {Filename} to {Username}; lock {LockName} already held", transfer.Filename, transfer.Username, lockName);
                return;
            }

            try
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
                    transfer.RetryOfId = RetryLinking.FindPriorFailedAttempt([existing], transfer.Filename)?.Id;

                    Log.Debug("Superseding transfer record for {Filename} from {Username}", transfer.Filename, transfer.Username);
                    existing.Removed = true;
                }

                context.Add(transfer);
                context.SaveChanges();
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
            using var work = Work.Enter();
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(Work.Token);
            var cancellationToken = cts.Token;
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

                the one deliberate exception is the "parked" exit below, for a peer that has gone offline: the record is
                left in Queued | Locally on purpose so the upload survives until they return. that exit is only safe
                because two things can un-park it (ResumeParkedUploads when the server reports the peer online, and
                EnqueueAsync when the peer re-requests the file), and because startup cleanup dispositions anything
                still parked if the application restarts

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

                cancellationToken.ThrowIfCancellationRequested();

                /*
                    now that the user is watched, if their last known presence is offline, don't hand a doomed transfer
                    to Soulseek.NET (which would hold a slot and wait on a long connection timeout before failing).

                    park the transfer rather than failing it: leave the record in Queued | Locally and return without an
                    in-flight task. a queued upload is meant to survive the peer going offline -- that's what the peer's
                    place-in-queue polling is for -- so completing it as Errored here means a single dropped connection
                    terminates every file the peer still had queued. their client reacts by re-requesting the whole
                    folder, which is exactly the request storm this check was added to avoid.

                    parking keeps the resource win of not holding a slot or a task per waiting file, without throwing
                    the queue away. see the comment above for what un-parks it.
                */
                if (Users.TryGetCachedPresence(transfer.Username, out var presence) && presence == UserPresence.Offline)
                {
                    Log.Debug("Parked upload of {Filename} to {Username}; user is offline", transfer.Filename, transfer.Username);
                    return null;
                }

                Log.Information("Initializing upload of {Filename} to {Username}", transfer.Filename, transfer.Username);

                // locate the file on disk. we checked this once already when enqueueing, but it may have moved since
                // can throw NotFoundException
                (host, localFilename, localFileLength) = await ResolveFileInfoAsync(remoteFilename: transfer.Filename);

                using var rateLimiter = new RateLimiter(250, concurrencyLimit: 1, flushOnDispose: true);

                var topts = new TransferOptions(
                    stateChanged: (args) =>
                    {
                        using var callback = Work.TryEnter();
                        if (callback is null)
                        {
                            return;
                        }

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
                        SynchronizedUpdate(transfer, semaphore: syncRoot, cancellationToken: cancellationToken);
                    },
                    progressUpdated: (args) => rateLimiter.Invoke(() =>
                    {
                        // don't do anything unless the `transfer` within the outer scope is in the
                        // InProgress state; this will help prevent out-of-band updates that are sometimes
                        // being made after the transfer is completed, causing them to appear 'stuck'
                        using var callback = Work.TryEnter();
                        if (callback is null)
                        {
                            return;
                        }

                        if (transfer.State == TransferStates.InProgress)
                        {
                            // don't wait for the semaphore; if a previous progress update is still hanging, don't make
                            // the problem worse. this will result in fewer/jumpy updates on systems with slow filesystems
                            // but the alternative is to continue to stack slow writes on top of one another
                            if (syncRoot.Wait(millisecondsTimeout: 0, cancellationToken))
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
                    slotAwaiter: (tx, ct) => Queue.AwaitStartAsync(tx.Username, tx.Filename).WaitAsync(ct),
                    slotReleased: (tx) => Queue.Complete(tx.Username, tx.Filename));

                // register the cancellation token
                CancellationTokens.TryAdd(transfer.Id, cts);

                // add the transfer to the UploadQueue so that it can become eligible for selection
                Queue.Enqueue(transfer.Username, transfer.Filename);
                transfer.EnqueuedAt = DateTime.UtcNow;
                SynchronizedUpdate(transfer, semaphore: syncRoot, cancellationToken: cancellationToken);

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
                        cancellationToken: cancellationToken);
                }
                else
                {
                    completedTransfer = await Client.UploadAsync(
                        username: transfer.Username,
                        remoteFilename: transfer.Filename,
                        size: localFileLength,
                        inputStreamFactory: (startOffset) => Relay.GetFileStreamAsync(agentName: host, filename: transfer.Filename, startOffset, id: transfer.Id),
                        options: topts,
                        cancellationToken: cancellationToken);

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

                return transfer;
            }
            catch (Exception) when (Work.Token.IsCancellationRequested)
            {
                // Preserve shutdown records for the existing startup recovery pass.
                Log.Debug("Upload of {Filename} to {Username} stopped for shutdown", transfer.Filename, transfer.Username);
                return null;
            }
            catch (NotFoundException ex)
            {
                Log.Error(ex, "Upload of {Filename} to user {Username} failed: {Message}", transfer.Filename, transfer.Username, ex.Message);

                TryFail(transfer.Id, "File could not be found", TransferStates.Completed | TransferStates.Aborted);
                await ErrorNotifications.NotifyUploadErrorAsync(transfer.Username, transfer.Filename, "File could not be found");

                // todo: broadcast
                SynchronizedUpdate(transfer, semaphore: syncRoot, cancellationToken: CancellationToken.None);

                throw;
            }
            catch (Exception ex)
            {
                /*
                    the peer turned out to be unreachable after all. our cached presence said online (or we had none
                    yet), so the transfer was handed to Soulseek.NET, which resolves the peer's endpoint through the
                    server and raises UserOfflineException -- with wording identical to the presence check above,
                    which is why the two were indistinguishable in the logs.

                    this is the same situation the presence check parks for, just discovered a step later, so park it
                    here too rather than completing it and taking the peer's whole queue with it. before this, the
                    check above merely masked this path; once it stopped throwing, the cascade simply reappeared here
                    (1,184 files for a single peer in five hours).

                    only park while the record still holds the starting state. once Soulseek.NET has reported any
                    progress the record has moved on, and a resume would fail UploadAsync's starting-state check, so
                    anything past that point is failed normally below. in practice this path is reached before any
                    state change is raised, so it covers the cascade.
                */
                if (IsUserOffline(ex) && transfer.State == (TransferStates.Queued | TransferStates.Locally))
                {
                    Log.Debug("Parked upload of {Filename} to {Username}; user is offline", transfer.Filename, transfer.Username);
                    return null;
                }

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

                TryFail(transfer.Id, exception: ex);
                await ErrorNotifications.NotifyUploadErrorAsync(transfer.Username, transfer.Filename, ex.Message);

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
            using var work = Work.Enter();
            if (string.IsNullOrEmpty(username))
            {
                throw new ArgumentNullException(nameof(username), "Username is required");
            }

            if (string.IsNullOrEmpty(filename))
            {
                throw new ArgumentNullException(nameof(filename), "Filename is required");
            }

            /*
                note: there is deliberately no "is this user offline?" gate here any more.

                returning null from this method reports success to the requesting peer (the EnqueueDownload delegate
                signals rejection by throwing), so skipping the enqueue told the peer their file was queued while
                recording nothing -- the file could then never arrive. that was tolerable only while an offline peer
                was assumed not to be asking, but a peer sending us a request is by definition reachable, so the gate
                mostly fired on a stale presence cache.

                storm protection is instead the existing duplicate check below, which is per-file rather than per-user:
                the first request for a file does the resolve/insert work, every repeat is a cheap indexed lookup that
                returns here. an offline peer's transfers are parked by UploadAsync rather than attempted.
            */
            var lockName = $"{nameof(EnqueueAsync)}:{username}:{filename}";

            if (!Locks.TryAdd(lockName, true))
            {
                Log.Debug("Ignoring concurrent upload enqueue attempt; lock {LockName} already held", lockName);
                return null;
            }

            Guid id = Guid.NewGuid();
            var transferCreated = false;

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

                    /*
                        the peer asking for a file they already have queued is proof they're reachable, so this is also
                        the cue to restart it if it was parked while they were offline.

                        a parked record can't be told apart from a live one by state alone (both sit in Queued | Locally
                        until Soulseek.NET reports otherwise), so just start them all: UploadAsync holds a lock per
                        username/filename for as long as it runs, so this is a no-op for anything already in flight.

                        this is the safety net that makes parking safe. without it, a status event we never receive
                        (a missed notification, a peer we stopped watching) would leave the record queued forever, and
                        this very duplicate check would block the peer from ever re-requesting it.
                    */
                    foreach (var record in existingInProgressRecords.Where(t => t.State == (TransferStates.Queued | TransferStates.Locally)))
                    {
                        StartUploadTask(record);
                    }

                    return null;
                }

                /*
                    check the tracked upload dictionary in Soulseek.NET to see if it knows about this already
                    it shouldn't, if the slskd database doesn't. but things could get desynced
                */
                var trackedUpload = Client.Uploads.FirstOrDefault(u => u.Username == username && u.Filename == filename);
                if (trackedUpload is not null)
                {
                    if (!trackedUpload.State.HasFlag(TransferStates.Completed))
                    {
                        Log.Debug("Upload of {Filename} to {Username} is already active in the transfer client", filename, username);
                        return null;
                    }

                    // Completed SDK entries can linger briefly. Do not acknowledge a new request
                    // as queued when no active upload can fulfil it; let the peer retry instead.
                    Log.Information("Upload of {Filename} to {Username} deferred while the previous transfer is being released", filename, username);
                    throw new DownloadEnqueueException("Previous upload is finishing cleanup; please retry shortly.");
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

                // if the most recent not-yet-removed record for this file ended in failure, link this attempt
                // to it so the history UI can present the eventual outcome as a retry rather than as two
                // unrelated transfers. A prior success is a deliberate re-upload, not a retry, so it is
                // intentionally not linked.
                var priorFailedAttempt = RetryLinking.FindPriorFailedAttempt(existingRecords, filename);

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
                    RetryOfId = priorFailedAttempt?.Id,
                };

                context.Add(transfer);

                foreach (var record in existingRecords.Where(t => !t.Removed))
                {
                    record.Removed = true;
                    context.Update(record);
                    Log.Debug("Marked existing upload record of {Filename} to {Username} removed (id: {Id})", filename, username, record.Id);
                }

                context.SaveChanges();
                transferCreated = true;

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

                // schedule the upload immediately
                StartUploadTask(transfer);

                return transfer;
            }
            catch (OperationCanceledException) when (Work.Token.IsCancellationRequested)
            {
                // A persisted queued row is recovered on startup; do not stamp it as an enqueue failure.
                throw;
            }
            catch (DownloadEnqueueException) when (!transferCreated)
            {
                // Expected peer-facing rejection; no database record exists to clean up.
                throw;
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to enqueue upload of {Filename} to {Username}: {Message}", filename, username, ex.Message);

                if (transferCreated && !TryFail(id, exception: ex))
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
        ///     Restarts any uploads to the specified <paramref name="username"/> that were parked because the user was
        ///     offline when the upload was last attempted.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <returns>The number of uploads for which a restart was scheduled.</returns>
        public int ResumeParkedUploads(string username)
        {
            if (string.IsNullOrEmpty(username))
            {
                return 0;
            }

            // as in EnqueueAsync, a parked transfer is indistinguishable from a live one by state alone, so restart
            // every queued record and let UploadAsync's per-file lock discard the redundant ones
            var parked = List(
                t => t.Username == username && t.EndedAt == null && t.State == (TransferStates.Queued | TransferStates.Locally),
                includeRemoved: false);

            if (parked.Count == 0)
            {
                return 0;
            }

            Log.Information("Resuming {Count} parked upload(s) to {Username}", parked.Count, username);

            foreach (var transfer in parked)
            {
                StartUploadTask(transfer);
            }

            return parked.Count;
        }

        /// <summary>
        ///     Cancels any uploads to the specified <paramref name="username"/> that are parked because the user was
        ///     offline when the upload was last attempted.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <returns>The number of uploads that were cancelled.</returns>
        public int PurgeParkedUploads(string username)
        {
            if (string.IsNullOrEmpty(username))
            {
                return 0;
            }

            var parked = List(
                t => t.Username == username && t.EndedAt == null && t.State == (TransferStates.Queued | TransferStates.Locally),
                includeRemoved: false);

            if (parked.Count == 0)
            {
                return 0;
            }

            var cancelled = parked.Count(t => TryCancel(t.Id));

            if (cancelled > 0)
            {
                Log.Information("Cancelled {Count} parked upload(s) to {Username}, who is offline", cancelled, username);
            }

            return cancelled;
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

        /// <inheritdoc/>
        public List<Transfer> ListForRecovery()
        {
            using var context = ContextFactory.CreateDbContext();
            return TransferListQuery.ListForRecovery(context, TransferDirection.Upload);
        }

        public List<Transfer> ListCapped(bool includeRemoved, bool activeOnly, int maxCompleted)
        {
            using var context = ContextFactory.CreateDbContext();
            return TransferListQuery.ListCapped(context, TransferDirection.Upload, includeRemoved, activeOnly, maxCompleted);
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

                var pruned = TransferPruner.Prune(context, TransferDirection.Upload, cutoffDateTime, statesSet);

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
                try
                {
                    cts.Cancel();
                }
                catch (ObjectDisposedException)
                {
                    // The upload completed after we removed its cancellation source.
                }

                return true;
            }

            /*
                no token means either the upload already ended, or the record is 'stuck': parked while the peer was
                offline, or orphaned by a restart. a stuck record is never Completed, and EnqueueAsync refuses to
                enqueue a file that already has a non-completed record -- so leaving it as-is would mean the peer
                could never request that file again. disposition it here, the same way DownloadService does.
            */
            var t = Find(t => t.Id == id);

            if (t is not null && !t.State.HasFlag(TransferStates.Completed))
            {
                t.EndedAt = DateTime.UtcNow;
                t.State = TransferStates.Completed | TransferStates.Cancelled;
                t.Exception = new OperationCanceledException().Message;
                Update(t);

                Queue.TryComplete(username: t.Username, filename: t.Filename);
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
        ///     Starts the upload of the specified <paramref name="transfer"/> on a background task, ensuring the transfer
        ///     record is dispositioned if the task itself faults.
        /// </summary>
        /// <remarks>
        ///     Safe to call for a transfer that is already in flight; <see cref="UploadAsync(Transfer)"/> holds a lock per
        ///     username/filename and returns immediately if it is already held.
        /// </remarks>
        /// <param name="transfer">The transfer to upload.</param>
        private void StartUploadTask(Transfer transfer)
        {
            // Reserve before scheduling so shutdown cannot miss work waiting for a thread.
            var work = Work.Enter();
            try
            {
                _ = Task.Run(async () =>
                {
                    using (work)
                    {
                        try
                        {
                            var result = await UploadAsync(transfer);
                            if (result is not null)
                            {
                                Log.Information("Task for upload of {Filename} to {Username} completed successfully", transfer.Filename, transfer.Username);
                            }
                        }
                        catch (Exception) when (Work.Token.IsCancellationRequested)
                        {
                            // Startup recovery dispositions interrupted transfers.
                        }
                        catch (Exception ex)
                        {
                            if (IsExpectedPeerFailure(ex))
                            {
                                Log.Warning("Task for upload of {Filename} to {Username} did not complete successfully: {Error}", transfer.Filename, transfer.Username, ex.Message);
                            }
                            else
                            {
                                Log.Error(ex, "Task for upload of {Filename} to {Username} did not complete successfully: {Error}", transfer.Filename, transfer.Username, ex.Message);
                            }

                            try
                            {
                                if (!TryFail(transfer.Id, ex))
                                {
                                    Log.Error(ex, "Failed to clean up transfer {Id} after failed execution", transfer.Id);
                                }
                            }
                            catch (Exception cleanupError)
                            {
                                Log.Error(cleanupError, "Failed to clean up transfer {Id}", transfer.Id);
                            }
                        }
                    }
                });
            }
            catch
            {
                work.Dispose();
                throw;
            }
        }

        private bool TryFail(Guid id, string exception, TransferStates state)
        {
            var t = Find(t => t.Id == id);

            if (t is null)
            {
                return false;
            }

            // never re-disposition a transfer that already succeeded. a redundant restart that raced a completion
            // (see StartUploadTask) arrives here with an InvalidOperationException about the starting state, and
            // without this the message would be stamped onto a transfer that actually finished fine.
            if (t.State.HasFlag(TransferStates.Succeeded))
            {
                return true;
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
