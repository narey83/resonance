// <copyright file="BundledCandidateRuntime.cs" company="John Narey">
// Copyright (c) 2026 John Narey. Licensed under AGPL-3.0-only.
// </copyright>

namespace resonance.Analysis.Candidates
{
    using System;
    using System.IO;

    /// <summary>Locates the enhanced worker installed with the application.</summary>
    public static class BundledCandidateRuntime
    {
        public static (string Python, string Worker, string Config) Resolve(string dataDirectory)
        {
            var root = Path.Combine(dataDirectory, "enhanced-analysis", "current");
            var python = Path.Combine(root, "envs", "enhanced", "bin", "python");
            var worker = Path.Combine(root, "worker", "analyze_track.py");
            var config = Path.Combine(root, "config.json");
            return File.Exists(python) && File.Exists(worker) && File.Exists(config)
                ? (python, worker, config)
                : (null, null, null);
        }

        public static (string Python, string Worker, string Config) ResolveWithOverrides(string dataDirectory)
        {
            var bundled = Resolve(dataDirectory);
            var python = Environment.GetEnvironmentVariable("RESONANCE_CANDIDATE_PYTHON");
            var worker = Environment.GetEnvironmentVariable("RESONANCE_CANDIDATE_WORKER");
            var config = Environment.GetEnvironmentVariable("RESONANCE_CANDIDATE_CONFIG");

            // An explicit installation must be complete. Never mix a partial override
            // with bundled paths from another version of the worker.
            return python != null || worker != null || config != null
                ? (python, worker, config)
                : bundled;
        }
    }
}
