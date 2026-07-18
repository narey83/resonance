// <copyright file="YamlConfigPatcher.cs" company="John Narey">
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
    using System.Text;
    using YamlDotNet.RepresentationModel;

    /// <summary>
    ///     Surgically patches individual keys within a section of a YAML configuration document, preserving the rest of the
    ///     file (including keys and comments this application does not manage).
    /// </summary>
    public static class YamlConfigPatcher
    {
        /// <summary>
        ///     Sets or removes the specified <paramref name="values"/> within the named <paramref name="section"/> of the
        ///     supplied <paramref name="yaml"/> document, returning the updated document.
        /// </summary>
        /// <param name="yaml">The current YAML document, or an empty/whitespace string to start from scratch.</param>
        /// <param name="section">The top-level section (mapping key) to patch, e.g. <c>soulseek</c>.</param>
        /// <param name="values">
        ///     The keys to set within the section. A non-null value sets or updates the key; a null value removes it.
        /// </param>
        /// <returns>The updated YAML document.</returns>
        public static string Patch(string yaml, string section, IDictionary<string, string> values)
        {
            var yamlStream = new YamlStream();

            if (!string.IsNullOrWhiteSpace(yaml))
            {
                yamlStream.Load(new StringReader(yaml));
            }

            YamlMappingNode root;
            if (yamlStream.Documents.Count == 0)
            {
                root = new YamlMappingNode();
                yamlStream.Documents.Add(new YamlDocument(root));
            }
            else
            {
                root = (YamlMappingNode)yamlStream.Documents[0].RootNode;
            }

            var sectionNode = GetOrCreateSection(root, section);

            foreach (var (key, value) in values)
            {
                SetOrUpdate(sectionNode, key, value);
            }

            var sb = new StringBuilder();
            yamlStream.Save(new StringWriter(sb), assignAnchors: false);
            return sb.ToString().Trim();
        }

        private static YamlMappingNode GetOrCreateSection(YamlMappingNode root, string section)
        {
            YamlNode sectionKey = null;
            foreach (var key in root.Children.Keys)
            {
                if (key is YamlScalarNode s && s.Value == section)
                {
                    sectionKey = key;
                    break;
                }
            }

            if (sectionKey == null)
            {
                var created = new YamlMappingNode();
                root.Children.Add(new YamlScalarNode(section), created);
                return created;
            }

            return (YamlMappingNode)root.Children[sectionKey];
        }

        private static void SetOrUpdate(YamlMappingNode node, string key, string value)
        {
            YamlNode existingKey = null;
            foreach (var k in node.Children.Keys)
            {
                if (k is YamlScalarNode s && s.Value == key)
                {
                    existingKey = k;
                    break;
                }
            }

            // a null value removes the key entirely, allowing a setting to be cleared
            if (value == null)
            {
                if (existingKey != null)
                {
                    node.Children.Remove(existingKey);
                }

                return;
            }

            if (existingKey != null)
            {
                node.Children[existingKey] = new YamlScalarNode(value);
            }
            else
            {
                node.Children.Add(new YamlScalarNode(key), new YamlScalarNode(value));
            }
        }
    }
}
