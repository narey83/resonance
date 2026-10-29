// <copyright file="CandidateAnalysisOptions.cs" company="John Narey">
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

namespace resonance.Analysis.Candidates
{
    using System;

    public record CandidateResourcePlan(
        int ProcessorCount,
        int ParallelJobs,
        int ThreadsPerJob,
        long AvailableMemoryBytes,
        long MemoryPerJobBytes);

    public record CandidateAnalysisOptions(
        string PythonExecutable,
        string WorkerScript,
        string ConfigFile,
        string OutputRoot,
        int TimeoutSeconds = 660,
        long MaxResultBytes = 32 * 1024 * 1024,
        int MaxParallelJobs = 0,
        int ThreadsPerJob = 0,
        long MemoryPerJobBytes = 5L * 1024 * 1024 * 1024)
    {
        public bool Enabled => !string.IsNullOrWhiteSpace(PythonExecutable)
            && !string.IsNullOrWhiteSpace(WorkerScript)
            && !string.IsNullOrWhiteSpace(ConfigFile)
            && !string.IsNullOrWhiteSpace(OutputRoot);

        /// <summary>
        ///     Divides the CPUs actually available to this process between as many concurrent
        ///     model jobs as memory permits. Explicit positive settings override the automatic
        ///     choices, while zero retains portable resource detection.
        /// </summary>
        /// <returns>The bounded parallel-job and per-job thread allocation.</returns>
        public CandidateResourcePlan ResolveResources(int processorCount, long availableMemoryBytes)
        {
            var processors = Math.Max(1, processorCount);
            var memoryPerJob = MemoryPerJobBytes > 0 ? MemoryPerJobBytes : 5L * 1024 * 1024 * 1024;
            var memoryJobs = availableMemoryBytes > 0
                ? Math.Max(1, (int)Math.Min(processors, availableMemoryBytes / memoryPerJob))
                : processors;

            int jobs;
            int threads;
            if (MaxParallelJobs > 0 && ThreadsPerJob > 0)
            {
                jobs = Math.Min(processors, MaxParallelJobs);
                threads = Math.Min(processors, ThreadsPerJob);
            }
            else if (MaxParallelJobs > 0)
            {
                jobs = Math.Min(processors, MaxParallelJobs);
                threads = Math.Max(1, (int)Math.Ceiling((double)processors / jobs));
            }
            else if (ThreadsPerJob > 0)
            {
                threads = Math.Min(processors, ThreadsPerJob);
                jobs = Math.Min(memoryJobs, Math.Max(1, (int)Math.Ceiling((double)processors / threads)));
            }
            else
            {
                // Prefer an exact division so automatic mode neither leaves CPUs idle nor
                // oversubscribes every PyTorch/OpenMP worker. When memory is the tighter
                // resource, fewer wider jobs are safer than swapping several large models.
                jobs = Math.Min(processors, memoryJobs);
                while (jobs > 1 && processors % jobs != 0)
                {
                    jobs--;
                }

                threads = Math.Max(1, processors / jobs);
            }

            return new(processors, jobs, threads, availableMemoryBytes, memoryPerJob);
        }
    }

    public record CandidateAnalysisRequest(string Path, double? Seconds = null, string[] Features = null);
}
