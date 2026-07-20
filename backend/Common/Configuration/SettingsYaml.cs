// <copyright file="SettingsYaml.cs" company="John Narey">
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

namespace resonance.Configuration
{
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using Microsoft.Extensions.Configuration;
    using YamlDotNet.RepresentationModel;
    using YamlDotNet.Serialization;

    /// <summary>
    ///     Converts between a YAML configuration document (the shape the web UI reads and writes) and the
    ///     flattened, colon-delimited key/value pairs stored in the settings table.
    /// </summary>
    /// <remarks>
    ///     Keys are stored verbatim (retaining the document's snake_case) so the document round-trips exactly;
    ///     the <see cref="DbConfigurationProvider"/> normalizes them for binding via <see cref="Normalize"/>.
    /// </remarks>
    public static class SettingsYaml
    {
        private static readonly string[] NullValues = { "~", "null", string.Empty };

        /// <summary>
        ///     Normalizes a configuration key the same way the YAML provider does: lowercased with underscores
        ///     and hyphens removed. This is the form the configuration binder expects.
        /// </summary>
        /// <param name="key">The key to normalize.</param>
        /// <returns>The normalized key.</returns>
        public static string Normalize(string key) =>
            key?.Replace("_", string.Empty).Replace("-", string.Empty).ToLowerInvariant();

        /// <summary>
        ///     Flattens a YAML document into <c>{prefix}:section:...</c> keys, retaining the document's original
        ///     (snake_case) casing.
        /// </summary>
        /// <param name="yaml">The YAML document text.</param>
        /// <param name="prefix">The root namespace to prepend (e.g. "resonance").</param>
        /// <returns>The flattened key/value pairs.</returns>
        public static Dictionary<string, string> Flatten(string yaml, string prefix)
        {
            var result = new Dictionary<string, string>();

            if (string.IsNullOrWhiteSpace(yaml))
            {
                return result;
            }

            using var reader = new StringReader(yaml);
            var stream = new YamlStream();
            stream.Load(reader);

            if (stream.Documents.Count == 0)
            {
                return result;
            }

            void Traverse(YamlNode node, string path)
            {
                switch (node)
                {
                    case YamlScalarNode scalar:
                        if (scalar.Value != null && !NullValues.Contains(scalar.Value.ToLowerInvariant()))
                        {
                            result[path] = scalar.Value;
                        }

                        break;
                    case YamlMappingNode map:
                        foreach (var child in map.Children)
                        {
                            var key = ((YamlScalarNode)child.Key).Value;
                            Traverse(child.Value, path == null ? key : ConfigurationPath.Combine(path, key));
                        }

                        break;
                    case YamlSequenceNode sequence:
                        for (var i = 0; i < sequence.Children.Count; i++)
                        {
                            Traverse(sequence.Children[i], ConfigurationPath.Combine(path, i.ToString()));
                        }

                        break;
                }
            }

            Traverse(stream.Documents[0].RootNode, prefix);
            return result;
        }

        /// <summary>
        ///     Rebuilds a YAML document from flattened settings keys, stripping the root namespace prefix.
        /// </summary>
        /// <param name="settings">The flattened key/value pairs (keys start with <paramref name="prefix"/>).</param>
        /// <param name="prefix">The root namespace to strip (e.g. "resonance").</param>
        /// <returns>The YAML document text.</returns>
        public static string ToYaml(IReadOnlyDictionary<string, string> settings, string prefix)
        {
            var root = new Dictionary<string, object>();
            var rootPrefix = prefix + ":";

            foreach (var (key, value) in settings.OrderBy(kvp => kvp.Key))
            {
                if (!key.StartsWith(rootPrefix))
                {
                    continue;
                }

                var segments = key.Substring(rootPrefix.Length).Split(':');
                var node = root;

                for (var i = 0; i < segments.Length - 1; i++)
                {
                    if (!node.TryGetValue(segments[i], out var child) || child is not Dictionary<string, object> childMap)
                    {
                        childMap = new Dictionary<string, object>();
                        node[segments[i]] = childMap;
                    }

                    node = childMap;
                }

                node[segments[^1]] = value;
            }

            var collapsed = CollapseArrays(root);

            var serializer = new SerializerBuilder().Build();
            return serializer.Serialize(collapsed ?? new Dictionary<string, object>());
        }

        /// <summary>
        ///     Recursively converts maps whose keys are the consecutive integers 0..n-1 into ordered lists,
        ///     reversing the array-index flattening.
        /// </summary>
        private static object CollapseArrays(object node)
        {
            if (node is not Dictionary<string, object> map)
            {
                return node;
            }

            var collapsedMap = map.ToDictionary(kvp => kvp.Key, kvp => CollapseArrays(kvp.Value));

            var indices = collapsedMap.Keys.Select(k => int.TryParse(k, out var i) ? i : -1).ToList();
            var isArray = collapsedMap.Count > 0
                && indices.All(i => i >= 0)
                && indices.OrderBy(i => i).SequenceEqual(Enumerable.Range(0, collapsedMap.Count));

            if (isArray)
            {
                return collapsedMap
                    .OrderBy(kvp => int.Parse(kvp.Key))
                    .Select(kvp => kvp.Value)
                    .ToList();
            }

            return collapsedMap;
        }
    }
}
