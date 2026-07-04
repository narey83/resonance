import { rootUrl } from '../../../config';
import {
  getSoulseekCredentials,
  updateSoulseekCredentials,
} from '../../../lib/credentials';
import { getYaml, updateYaml, validateYaml } from '../../../lib/options';
import * as prefs from '../../../lib/prefs';
import * as sharesLibrary from '../../../lib/shares';
import { ShrinkableButton } from '../../Shared';
import FolderPicker from '../../Shared/FolderPicker';
import BrowseRateLimitSection from './BrowseRateLimitSection';
import DebugModal from './DebugModal';
import FfmpegSection from './FfmpegSection';
import QoSSection from './QoSSection';
import SharesSection from './SharesSection';
import TransferErrorNotificationSection from './TransferErrorNotificationSection';
import YtDlpOptionsSection from './YtDlpOptionsSection';
import React, { useEffect, useRef, useState } from 'react';
import YAML from 'yaml';

// ── Path helpers ──────────────────────────────────────────────────────────────

const getAtPath = (object, path) =>
  path.reduce((accumulated, key) => accumulated?.[key], object);

const setAtPath = (object, path, value) => {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  return { ...object, [head]: setAtPath(object?.[head] ?? {}, rest, value) };
};

// Read a snake_case schema path from a camelCase object (hub options).
// e.g. ['soulseek', 'listen_port'] → obj.soulseek.listenPort
const snakeToCamel = (snakeString) =>
  snakeString.replaceAll(/_([a-z])/gu, (_, character) =>
    character.toUpperCase(),
  );

const getAtPathCamel = (object, path) =>
  path.reduce((accumulated, key) => accumulated?.[snakeToCamel(key)], object);

const isBlank = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '');

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA = [
  {
    fields: [
      {
        description:
          'Outputs verbose diagnostic information. Disable in production for better performance.',
        label: 'Debug Logging',
        path: ['debug'],
        type: 'toggle',
      },
      {
        description:
          'A display name for this instance, shown in the UI and relay network.',
        label: 'Instance Name',
        path: ['instance_name'],
        placeholder: 'default',
        type: 'text',
      },
    ],
    group: 'System',
    title: 'General',
  },
  {
    fields: [
      {
        description:
          'Profile description visible to other users on the network.',
        label: 'Description',
        path: ['soulseek', 'description'],
        type: 'textarea',
      },
      {
        description:
          'Port for incoming peer connections. Must be forwarded in your router or firewall. Default: 50300.',
        label: 'Listen Port',
        max: 65_535,
        min: 1,
        path: ['soulseek', 'listen_port'],
        placeholder: '50300',
        type: 'number',
      },
      {
        choices: ['None', 'Warning', 'Info', 'Debug'],
        description: 'Verbosity of Soulseek library diagnostic messages.',
        label: 'Diagnostic Level',
        path: ['soulseek', 'diagnostic_level'],
        type: 'select',
      },
    ],
    group: 'Soulseek',
    title: 'Soulseek Account',
  },
  {
    fields: [
      {
        description:
          'Automatically ask your router to forward the listen port via UPnP, so incoming peer connections work without a manual port forward. Your router must have UPnP enabled. Takes effect after a restart.',
        label: 'Enable UPnP',
        path: ['integrations', 'upnp', 'enabled'],
        type: 'toggle',
      },
      {
        choices: ['tcp', 'udp'],
        description:
          'Protocol to map. Incoming Soulseek peer connections use TCP.',
        label: 'Protocol',
        path: ['integrations', 'upnp', 'protocol'],
        type: 'select',
      },
      {
        description:
          'Lifetime of the port mapping lease, in seconds. The mapping is renewed before it expires. Set to 0 for a permanent mapping (use if your router rejects leased mappings). Default: 3600.',
        label: 'Lease Duration',
        max: 604_800,
        min: 0,
        path: ['integrations', 'upnp', 'lease_duration'],
        placeholder: '3600',
        type: 'number',
      },
    ],
    group: 'Soulseek',
    title: 'UPnP Port Mapping',
  },
  {
    fields: [
      {
        description: 'Directory where completed downloads are saved.',
        label: 'Download Directory',
        path: ['directories', 'downloads'],
        placeholder: '/downloads',
        type: 'folder',
      },
      {
        description:
          'Directory where in-progress downloads are stored temporarily.',
        label: 'Incomplete Directory',
        path: ['directories', 'incomplete'],
        placeholder: '/incomplete',
        type: 'folder',
      },
      {
        description:
          'Maximum number of simultaneous downloads. Set to 0 or leave blank for unlimited.',
        label: 'Download Slots',
        min: 0,
        path: ['transfers', 'download', 'slots'],
        placeholder: 'unlimited',
        type: 'number',
      },
      {
        connectionSpeedPath: ['transfers', 'download', 'connection_speed'],
        description:
          'Slide to choose how much of your connection to commit to downloads. Drag to 0 for unlimited.',
        label: 'Speed Limit',
        path: ['transfers', 'download', 'speed_limit'],
        type: 'speed',
      },
      {
        choices: ['resume', 'overwrite'],
        description:
          'Whether to resume or overwrite files when retrying an incomplete download.',
        label: 'Incomplete Retry',
        path: ['transfers', 'download', 'retry', 'incomplete'],
        type: 'select',
      },
      {
        description:
          'Number of times to automatically retry a failed download. Default: 3.',
        label: 'Retry Attempts',
        min: 0,
        path: ['transfers', 'download', 'retry', 'attempts'],
        placeholder: '3',
        type: 'number',
      },
    ],
    group: 'Transfers',
    title: 'Downloads',
  },
  {
    fields: [
      {
        description:
          'Maximum number of simultaneous uploads. Set to 0 for unlimited. Default: 10.',
        label: 'Upload Slots',
        min: 0,
        path: ['transfers', 'upload', 'slots'],
        placeholder: '10',
        type: 'number',
      },
      {
        connectionSpeedPath: ['transfers', 'upload', 'connection_speed'],
        description:
          'Slide to choose how much of your connection to commit to uploads. Drag to 0 for unlimited.',
        label: 'Speed Limit',
        path: ['transfers', 'upload', 'speed_limit'],
        type: 'speed',
      },
    ],
    group: 'Transfers',
    title: 'Uploads',
  },
  {
    fields: [
      {
        description:
          'Queue priority for users not in any named group. Higher numbers are served first. Default: 1.',
        label: 'Default Priority',
        min: 1,
        path: ['transfers', 'groups', 'default', 'upload', 'priority'],
        placeholder: '1',
        type: 'number',
      },
      {
        choices: ['roundrobin', 'firstinfirstout'],
        description:
          'How upload slots are assigned among queued users. Round-robin gives each user a turn; first-in-first-out serves the oldest request first.',
        label: 'Default Strategy',
        path: ['transfers', 'groups', 'default', 'upload', 'strategy'],
        type: 'select',
      },
      {
        description:
          'Maximum simultaneous uploads to users in the default group. Leave blank for no group-level limit.',
        label: 'Default Slots',
        min: 1,
        nullable: true,
        path: ['transfers', 'groups', 'default', 'upload', 'slots'],
        placeholder: 'unlimited',
        type: 'number',
      },
    ],
    group: 'Transfers',
    title: 'Default Group',
  },
  {
    fields: [
      {
        description:
          'Minimum shared files needed to avoid being classed as a leecher. Default: 1.',
        label: 'File Threshold',
        min: 1,
        path: ['transfers', 'groups', 'leechers', 'thresholds', 'files'],
        placeholder: '1',
        type: 'number',
      },
      {
        description:
          'Minimum shared directories needed to avoid being classed as a leecher. Default: 1.',
        label: 'Directory Threshold',
        min: 1,
        path: ['transfers', 'groups', 'leechers', 'thresholds', 'directories'],
        placeholder: '1',
        type: 'number',
      },
      {
        description:
          'Queue priority for users classified as leechers. Default: 1.',
        label: 'Leecher Priority',
        min: 1,
        path: ['transfers', 'groups', 'leechers', 'upload', 'priority'],
        placeholder: '1',
        type: 'number',
      },
      {
        choices: ['roundrobin', 'firstinfirstout'],
        description: 'Queue strategy applied to leecher uploads.',
        label: 'Leecher Strategy',
        path: ['transfers', 'groups', 'leechers', 'upload', 'strategy'],
        type: 'select',
      },
      {
        description:
          'Maximum simultaneous uploads to leechers. Leave blank for no group-level limit.',
        label: 'Leecher Slots',
        min: 1,
        nullable: true,
        path: ['transfers', 'groups', 'leechers', 'upload', 'slots'],
        placeholder: 'unlimited',
        type: 'number',
      },
    ],
    group: 'Transfers',
    title: 'Leechers',
  },
  {
    group: 'Transfers',
    title: 'Schedule',
    type: 'schedule',
  },
  {
    fields: [
      {
        description:
          'Stop participating in the Soulseek distributed search network.',
        label: 'Disable Network',
        path: ['soulseek', 'distributed_network', 'disabled'],
        type: 'toggle',
      },
      {
        description:
          'Prevent other nodes from connecting to this one as distributed children.',
        label: 'Disable Children',
        path: ['soulseek', 'distributed_network', 'disable_children'],
        type: 'toggle',
      },
      {
        description:
          'Maximum number of distributed child connections to accept. Default: 25.',
        label: 'Child Limit',
        min: 0,
        path: ['soulseek', 'distributed_network', 'child_limit'],
        placeholder: '25',
        type: 'number',
      },
    ],
    group: 'Soulseek',
    title: 'Distributed Network',
  },
  {
    fields: [
      {
        description:
          'Timeout for establishing new connections, in milliseconds. Default: 10000.',
        label: 'Connect Timeout',
        min: 1_000,
        path: ['soulseek', 'connection', 'timeout', 'connect'],
        placeholder: '10000',
        type: 'number',
        unit: 'ms',
      },
      {
        description:
          'Time before an idle connection is considered dead and dropped, in milliseconds. Default: 15000.',
        label: 'Inactivity Timeout',
        min: 1_000,
        path: ['soulseek', 'connection', 'timeout', 'inactivity'],
        placeholder: '15000',
        type: 'number',
        unit: 'ms',
      },
      {
        description:
          'How long to wait without receiving data before failing a transfer, in milliseconds. Default: 60000.',
        label: 'Transfer Timeout',
        min: 30_000,
        path: ['soulseek', 'connection', 'timeout', 'transfer'],
        placeholder: '60000',
        type: 'number',
        unit: 'ms',
      },
      {
        description:
          'Read buffer size for peer and server connections, in bytes. Larger values may improve throughput on fast networks. Default: 16384.',
        label: 'Read Buffer',
        min: 1_024,
        path: ['soulseek', 'connection', 'buffer', 'read'],
        placeholder: '16384',
        type: 'number',
        unit: 'bytes',
      },
      {
        description:
          'Write buffer size for peer and server connections, in bytes. Default: 16384.',
        label: 'Write Buffer',
        min: 1_024,
        path: ['soulseek', 'connection', 'buffer', 'write'],
        placeholder: '16384',
        type: 'number',
        unit: 'bytes',
      },
      {
        description:
          'Read/write buffer size for transfer connections, in bytes. Larger values improve throughput at the cost of memory. Default: 262144.',
        label: 'Transfer Buffer',
        min: 81_920,
        path: ['soulseek', 'connection', 'buffer', 'transfer'],
        placeholder: '262144',
        type: 'number',
        unit: 'bytes',
      },
      {
        description:
          'Depth of the write queue for distributed child connections. Higher values smooth out bursty traffic but use more memory. Range: 5–5000. Default: 50.',
        label: 'Write Queue',
        max: 5_000,
        min: 5,
        path: ['soulseek', 'connection', 'buffer', 'write_queue'],
        placeholder: '50',
        type: 'number',
      },
    ],
    group: 'Soulseek',
    title: 'Connection',
  },
  {
    fields: [
      {
        description: 'Port for HTTP connections. Default: 5030.',
        label: 'HTTP Port',
        max: 65_535,
        min: 1,
        path: ['web', 'port'],
        placeholder: '5030',
        type: 'number',
      },
      {
        description:
          'Disable HTTP access. HTTPS must remain enabled to avoid lockout.',
        disabledWhen: { equals: true, path: ['web', 'https', 'disabled'] },
        label: 'Disable HTTP',
        path: ['web', 'disabled'],
        type: 'toggle',
      },
      {
        description: 'Port for HTTPS connections. Default: 5031.',
        label: 'HTTPS Port',
        max: 65_535,
        min: 1,
        path: ['web', 'https', 'port'],
        placeholder: '5031',
        type: 'number',
      },
      {
        description:
          'Disable HTTPS access. HTTP must remain enabled to avoid lockout.',
        disabledWhen: { equals: true, path: ['web', 'disabled'] },
        label: 'Disable HTTPS',
        path: ['web', 'https', 'disabled'],
        type: 'toggle',
      },
      {
        description: 'Redirect all HTTP requests to HTTPS.',
        label: 'Force HTTPS',
        path: ['web', 'https', 'force'],
        type: 'toggle',
      },
      {
        description:
          'Path to a PFX certificate file for HTTPS. Leave blank to use the auto-generated self-signed certificate.',
        label: 'TLS Certificate (PFX)',
        path: ['web', 'https', 'certificate', 'pfx'],
        placeholder: '/path/to/cert.pfx',
        type: 'text',
      },
      {
        description: 'Password for the PFX certificate file.',
        label: 'Certificate Password',
        path: ['web', 'https', 'certificate', 'password'],
        type: 'password',
      },
      {
        description: 'Log all incoming HTTP requests to the web server.',
        label: 'HTTP Logging',
        path: ['web', 'logging'],
        type: 'toggle',
      },
    ],
    group: 'System',
    title: 'Web Server',
  },
  {
    fields: [
      {
        baseUnit: 'minutes',
        description:
          'How long to retain search results before automatically removing them. Set to 0 or leave blank to retain indefinitely.',
        label: 'Search History',
        path: ['retention', 'search'],
        placeholder: '0',
        type: 'duration',
      },
      {
        baseUnit: 'minutes',
        description:
          'How long to keep records of completed downloads. Set to 0 or leave blank to retain indefinitely.',
        label: 'Download Records',
        path: ['retention', 'transfers', 'download', 'succeeded'],
        placeholder: '0',
        type: 'duration',
      },
      {
        baseUnit: 'minutes',
        description:
          'How long to keep records of completed uploads. Set to 0 or leave blank to retain indefinitely.',
        label: 'Upload Records',
        path: ['retention', 'transfers', 'upload', 'succeeded'],
        placeholder: '0',
        type: 'duration',
      },
    ],
    group: 'System',
    title: 'Retention',
  },
  {
    fields: [
      {
        description:
          'Block users who send excessive folder-contents requests. Useful for users repeatedly hammering a specific folder.',
        label: 'Enabled',
        path: ['browse_rate_limit', 'enabled'],
        type: 'toggle',
      },
      {
        description:
          'Maximum folder-contents requests a user can make within the window before being blocked. Default: 10.',
        disabledWhen: { equals: false, path: ['browse_rate_limit', 'enabled'] },
        label: 'Max Requests',
        min: 1,
        path: ['browse_rate_limit', 'requests'],
        placeholder: '10',
        type: 'number',
      },
      {
        baseUnit: 'seconds',
        description:
          'Rolling time window over which requests are counted. Default: 60 seconds.',
        disabledWhen: { equals: false, path: ['browse_rate_limit', 'enabled'] },
        label: 'Window',
        path: ['browse_rate_limit', 'window_secs'],
        placeholder: '60',
        type: 'duration',
      },
      {
        baseUnit: 'minutes',
        description:
          'How long a user is blocked after exceeding the limit. Default: 60 minutes (1 hour).',
        disabledWhen: { equals: false, path: ['browse_rate_limit', 'enabled'] },
        label: 'Block Duration',
        path: ['browse_rate_limit', 'block_duration_mins'],
        placeholder: '60',
        type: 'duration',
      },
      {
        description:
          'Send the blocked user a private message on the Soulseek network when they are blocked.',
        disabledWhen: { equals: false, path: ['browse_rate_limit', 'enabled'] },
        label: 'Notify User',
        path: ['browse_rate_limit', 'send_message'],
        type: 'toggle',
      },
      {
        description:
          'Message sent to the user when blocked. Use {minutes} as a placeholder for the block duration.',
        disabledWhen: {
          equals: false,
          path: ['browse_rate_limit', 'send_message'],
        },
        label: 'Message',
        path: ['browse_rate_limit', 'message_template'],
        placeholder:
          'You have been temporarily blocked for {minutes} minutes due to excessive folder browse requests.',
        type: 'textarea',
      },
    ],
    group: 'Peers',
    title: 'Browse Rate Limiting',
  },
  {
    fields: [
      {
        description:
          'Send a private Soulseek message to users when a transfer involving them fails.',
        label: 'Enabled',
        path: ['transfer_error_notifications', 'enabled'],
        type: 'toggle',
      },
      {
        description:
          "Message sent when a user's download from you fails. Supports {filename} and {exception} placeholders.",
        disabledWhen: {
          equals: false,
          path: ['transfer_error_notifications', 'enabled'],
        },
        label: 'Upload Error Message',
        path: ['transfer_error_notifications', 'upload_error_template'],
        placeholder: "Your download of '{filename}' failed: {exception}",
        type: 'textarea',
      },
      {
        description:
          "Message sent when a user's file request is rejected. Supports {filename} and {reason} placeholders.",
        disabledWhen: {
          equals: false,
          path: ['transfer_error_notifications', 'enabled'],
        },
        label: 'Rejected Request Message',
        path: ['transfer_error_notifications', 'upload_rejected_template'],
        placeholder: "Your request for '{filename}' was rejected: {reason}",
        type: 'textarea',
      },
      {
        description:
          'Message sent to a user when their upload to you fails. Supports {filename} and {exception} placeholders.',
        disabledWhen: {
          equals: false,
          path: ['transfer_error_notifications', 'enabled'],
        },
        label: 'Download Error Message',
        path: ['transfer_error_notifications', 'download_error_template'],
        placeholder: "Your upload of '{filename}' to me failed: {exception}",
        type: 'textarea',
      },
      {
        baseUnit: 'minutes',
        description:
          'Minimum time between notifications to the same user. Prevents flooding a user with messages during repeated errors. Set to 0 to disable. Default: 5 minutes.',
        disabledWhen: {
          equals: false,
          path: ['transfer_error_notifications', 'enabled'],
        },
        label: 'Cooldown',
        min: 0,
        path: ['transfer_error_notifications', 'cooldown_mins'],
        placeholder: '5',
        type: 'duration',
      },
    ],
    group: 'Peers',
    title: 'Transfer Error Notifications',
  },
  {
    group: 'Sharing',
    title: 'Shares',
    type: 'shares',
  },
  {
    fields: [
      {
        description:
          'Serve your music library to DLNA/UPnP media renderers on the local network. Requires a restart to take effect.',
        label: 'Enabled',
        path: ['dlna', 'enabled'],
        type: 'toggle',
      },
      {
        description:
          'Name shown to DLNA clients when browsing for media servers.',
        disabledWhen: { equals: false, path: ['dlna', 'enabled'] },
        label: 'Friendly Name',
        path: ['dlna', 'friendly_name'],
        placeholder: 'Resonance',
        type: 'text',
      },
      {
        description: 'HTTP port for the DLNA server. Default: 8200.',
        disabledWhen: { equals: false, path: ['dlna', 'enabled'] },
        label: 'Port',
        max: 65_535,
        min: 1,
        path: ['dlna', 'port'],
        placeholder: '8200',
        type: 'number',
      },
      {
        description:
          'Include album art in DLNA Browse responses. Disable to speed up folder loading on slow devices.',
        disabledWhen: { equals: false, path: ['dlna', 'enabled'] },
        label: 'Serve Artwork',
        path: ['dlna', 'serve_artwork'],
        type: 'toggle',
      },
    ],
    group: 'Sharing',
    title: 'DLNA',
  },
  {
    fields: [
      {
        description: 'Enable the yt-dlp download integration.',
        label: 'Enabled',
        path: ['integrations', 'yt_dlp', 'enabled'],
        type: 'toggle',
      },
      {
        description:
          'Path to the yt-dlp executable (e.g. yt-dlp or /usr/local/bin/yt-dlp).',
        label: 'yt-dlp Executable',
        path: ['integrations', 'yt_dlp', 'executable_path'],
        placeholder: 'yt-dlp',
        type: 'text',
      },
      {
        description:
          'Path to the ffmpeg executable — required for audio extraction.',
        label: 'ffmpeg Executable',
        path: ['integrations', 'yt_dlp', 'ffmpeg_path'],
        placeholder: 'ffmpeg',
        type: 'text',
      },
      {
        choices: ['best', 'mp3', 'opus', 'flac', 'wav', 'm4a', 'aac', 'ogg'],
        description: 'Audio format to request from yt-dlp.',
        label: 'Audio Format',
        path: ['integrations', 'yt_dlp', 'audio_format'],
        type: 'select',
      },
      {
        choices: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        description: '0 = best quality, 9 = smallest file.',
        label: 'Audio Quality',
        path: ['integrations', 'yt_dlp', 'audio_quality'],
        type: 'select',
      },
      {
        choices: ['', 'mp3', 'opus', 'flac', 'wav', 'm4a', 'aac', 'ogg'],
        description:
          'Convert each track to this format (via ffmpeg) once a folder finishes, before files are moved out of staging and go live. Blank = no conversion. Can be overridden per job.',
        label: 'Convert On Complete',
        path: ['integrations', 'yt_dlp', 'convert_on_completion_format'],
        type: 'select',
      },
      {
        description:
          'yt-dlp output template (without extension). E.g. %(uploader)s/%(title)s',
        label: 'Output Template',
        path: ['integrations', 'yt_dlp', 'output_template'],
        placeholder: '%(uploader)s/%(title)s',
        type: 'text',
      },
      {
        description: 'Number of tracks downloaded at once.',
        label: 'Max Concurrent Downloads',
        max: 20,
        min: 1,
        path: ['integrations', 'yt_dlp', 'max_concurrent_downloads'],
        placeholder: '2',
        type: 'number',
      },
      {
        description:
          'Maximum retry attempts per track before marking as failed.',
        label: 'Max Retry Attempts',
        max: 10,
        min: 0,
        path: ['integrations', 'yt_dlp', 'max_retry_attempts'],
        placeholder: '3',
        type: 'number',
      },
      {
        description:
          'Bandwidth limit passed to yt-dlp. E.g. 5M, 500K. Leave blank for unlimited.',
        label: 'Bandwidth Limit',
        path: ['integrations', 'yt_dlp', 'bandwidth_limit'],
        placeholder: '5M',
        type: 'text',
      },
      {
        description:
          'Default genre tag written to all downloaded tracks. Leave blank to omit.',
        label: 'Default Genre',
        path: ['integrations', 'yt_dlp', 'default_genre'],
        placeholder: 'Electronic',
        type: 'text',
      },
      {
        description:
          'Remove sponsor, intro, and outro segments using SponsorBlock (requires ffmpeg).',
        label: 'SponsorBlock',
        path: ['integrations', 'yt_dlp', 'sponsor_block'],
        type: 'toggle',
      },
      {
        description:
          'Skip tracks whose VideoId is already completed in the database.',
        label: 'Skip Already Downloaded',
        path: ['integrations', 'yt_dlp', 'skip_existing_files'],
        type: 'toggle',
      },
    ],
    group: 'Integrations',
    title: 'YouTube / yt-dlp',
  },
  {
    fields: [
      {
        description:
          'Route Soulseek traffic through a VPN. Requires a restart to take effect.',
        label: 'Enabled',
        path: ['integrations', 'vpn', 'enabled'],
        type: 'toggle',
      },
      {
        description:
          'Enable if your VPN supports dynamic port forwarding (e.g. PIA, Mullvad). The forwarded port will be used as the Soulseek listen port.',
        disabledWhen: {
          equals: false,
          path: ['integrations', 'vpn', 'enabled'],
        },
        label: 'Port Forwarding',
        path: ['integrations', 'vpn', 'port_forwarding'],
        type: 'toggle',
      },
      {
        description:
          'How often to poll the VPN client for status. Requires a restart to take effect.',
        disabledWhen: {
          equals: false,
          path: ['integrations', 'vpn', 'enabled'],
        },
        label: 'Polling Interval',
        min: 500,
        path: ['integrations', 'vpn', 'polling_interval'],
        placeholder: '2500',
        type: 'number',
        unit: 'ms',
      },
      {
        description:
          'Root URL of the Gluetun control server (e.g. http://127.0.0.1:8000).',
        disabledWhen: {
          equals: false,
          path: ['integrations', 'vpn', 'enabled'],
        },
        label: 'Gluetun URL',
        path: ['integrations', 'vpn', 'gluetun', 'url'],
        placeholder: 'http://127.0.0.1:8000',
        type: 'text',
      },
      {
        description: 'Timeout for HTTP requests to the Gluetun control server.',
        disabledWhen: {
          equals: false,
          path: ['integrations', 'vpn', 'enabled'],
        },
        label: 'Gluetun Timeout',
        max: 10_000,
        min: 500,
        path: ['integrations', 'vpn', 'gluetun', 'timeout'],
        placeholder: '1000',
        type: 'number',
        unit: 'ms',
      },
      {
        description:
          'API key for the Gluetun control server. Takes precedence over basic auth if set.',
        disabledWhen: {
          equals: false,
          path: ['integrations', 'vpn', 'enabled'],
        },
        label: 'Gluetun API Key',
        path: ['integrations', 'vpn', 'gluetun', 'api_key'],
        type: 'password',
      },
      {
        description: 'Username for Gluetun control server basic auth.',
        disabledWhen: {
          equals: false,
          path: ['integrations', 'vpn', 'enabled'],
        },
        label: 'Gluetun Username',
        path: ['integrations', 'vpn', 'gluetun', 'username'],
        type: 'text',
      },
      {
        description: 'Password for Gluetun control server basic auth.',
        disabledWhen: {
          equals: false,
          path: ['integrations', 'vpn', 'enabled'],
        },
        label: 'Gluetun Password',
        path: ['integrations', 'vpn', 'gluetun', 'password'],
        type: 'password',
      },
    ],
    group: 'Integrations',
    title: 'VPN',
  },
  {
    fields: [
      {
        description:
          'Optional explicit path to the ffmpeg binary. Leave blank to use a self-managed copy that the app downloads and keeps updated. ffprobe is resolved alongside it.',
        label: 'Custom ffmpeg Path',
        path: ['ffmpeg', 'path'],
        placeholder: 'auto-managed',
        type: 'text',
      },
      {
        description:
          'Periodically download and install a newer static ffmpeg build in the background. Ignored when a custom path is set.',
        label: 'Auto-update ffmpeg',
        path: ['ffmpeg', 'auto_update'],
        type: 'toggle',
      },
      {
        description: 'Days between background ffmpeg update checks.',
        label: 'Update Interval (days)',
        max: 365,
        min: 1,
        path: ['ffmpeg', 'update_interval_days'],
        placeholder: '7',
        type: 'number',
      },
    ],
    group: 'Integrations',
    title: 'ffmpeg',
  },
  {
    fields: [
      {
        description:
          'Automatically look up missing track details (title, artist, album, year, genre) online and write them to your files. Runs quietly in the background. Enable one or more providers below.',
        label: 'Enable Metadata Retrieval',
        path: ['metadata_lookup', 'enabled'],
        type: 'toggle',
      },
      {
        description:
          'Minimum match confidence (0-100) required before tags are written automatically. Higher is safer. Default: 90.',
        disabledWhen: { equals: false, path: ['metadata_lookup', 'enabled'] },
        label: 'Minimum Match Score',
        max: 100,
        min: 0,
        path: ['metadata_lookup', 'min_score'],
        placeholder: '90',
        type: 'number',
      },
      {
        description:
          'Maximum lookup requests per second. The public APIs allow about 1; raise only against a self-hosted mirror.',
        disabledWhen: { equals: false, path: ['metadata_lookup', 'enabled'] },
        label: 'Requests per Second',
        max: 100,
        min: 1,
        path: ['metadata_lookup', 'rate_limit_per_second'],
        placeholder: '1',
        type: 'number',
      },
      {
        description:
          'Number of tracks looked up in parallel during a pass. Keep at 1 for the public APIs.',
        disabledWhen: { equals: false, path: ['metadata_lookup', 'enabled'] },
        label: 'Workers',
        max: 16,
        min: 1,
        path: ['metadata_lookup', 'workers'],
        placeholder: '1',
        type: 'number',
      },
      { label: 'MusicBrainz', type: 'heading' },
      {
        description:
          'Use MusicBrainz as a lookup source. Free, no token; broad coverage but weaker for underground/electronic releases. When more than one provider is enabled they are tried in order, Discogs first.',
        disabledWhen: { equals: false, path: ['metadata_lookup', 'enabled'] },
        label: 'Use MusicBrainz',
        path: ['metadata_lookup', 'music_brainz', 'enabled'],
        type: 'toggle',
      },
      {
        description:
          'Email or URL included in the MusicBrainz User-Agent, as their API requires. Recommended so requests are not blocked.',
        disabledWhen: {
          equals: false,
          path: ['metadata_lookup', 'music_brainz', 'enabled'],
        },
        label: 'Contact',
        path: ['metadata_lookup', 'contact'],
        placeholder: 'you@example.com',
        type: 'text',
      },
      {
        description:
          'MusicBrainz web service URL. Point this at a self-hosted mirror to remove the public rate limit. Default: https://musicbrainz.org/ws/2.',
        disabledWhen: {
          equals: false,
          path: ['metadata_lookup', 'music_brainz', 'enabled'],
        },
        label: 'Base URL',
        path: ['metadata_lookup', 'base_url'],
        placeholder: 'https://musicbrainz.org/ws/2',
        type: 'text',
      },
      { label: 'Discogs', type: 'heading' },
      { help: 'discogs', type: 'help' },
      {
        description:
          'Use Discogs as a lookup source. Best for electronic, vinyl and underground releases, with richer genres (Discogs Styles like Techno, Minimal, Tech House). Requires the token below.',
        disabledWhen: { equals: false, path: ['metadata_lookup', 'enabled'] },
        label: 'Use Discogs',
        path: ['metadata_lookup', 'discogs', 'enabled'],
        requiresValue: ['metadata_lookup', 'discogs', 'token'],
        type: 'toggle',
      },
      {
        description:
          'Your Discogs personal access token (see the steps above to generate one). Stored privately and used only to authenticate metadata lookups.',
        disabledWhen: { equals: false, path: ['metadata_lookup', 'enabled'] },
        label: 'Discogs Token',
        path: ['metadata_lookup', 'discogs', 'token'],
        placeholder: 'paste your token here',
        type: 'password',
      },
      { label: 'Last.fm', type: 'heading' },
      { help: 'lastfm', type: 'help' },
      {
        description:
          'Use Last.fm as a genre source. Its community tags cover obscure/electronic tracks the other databases miss, and fill in genre where the providers above came up empty. Requires a free API key.',
        disabledWhen: { equals: false, path: ['metadata_lookup', 'enabled'] },
        label: 'Use Last.fm',
        path: ['metadata_lookup', 'lastfm', 'enabled'],
        requiresValue: ['metadata_lookup', 'lastfm', 'api_key'],
        type: 'toggle',
      },
      {
        description:
          'Your Last.fm API key (see the steps above). Stored privately and used only to authenticate genre lookups.',
        disabledWhen: { equals: false, path: ['metadata_lookup', 'enabled'] },
        label: 'Last.fm API Key',
        path: ['metadata_lookup', 'lastfm', 'api_key'],
        placeholder: 'paste your API key here',
        type: 'password',
      },
      { label: 'Deezer', type: 'heading' },
      {
        description:
          'Use Deezer as a no-setup fallback — no account or key needed. Supplies release year and a broad genre where the providers above came up empty.',
        disabledWhen: { equals: false, path: ['metadata_lookup', 'enabled'] },
        label: 'Use Deezer',
        path: ['metadata_lookup', 'deezer', 'enabled'],
        type: 'toggle',
      },
    ],
    group: 'Integrations',
    title: 'Metadata Retrieval',
  },
  {
    group: 'System',
    title: 'Developer',
    type: 'developer',
  },
];

// ── Controls ──────────────────────────────────────────────────────────────────

const FolderField = ({ disabled, onChange, placeholder, value }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <>
      {pickerOpen && (
        <FolderPicker
          onCancel={() => setPickerOpen(false)}
          onSelect={(path) => {
            onChange(path);
            setPickerOpen(false);
          }}
        />
      )}
      <div className="opt-folder-row">
        <input
          className="opt-input opt-input--folder"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type="text"
          value={value ?? ''}
        />
        <button
          className="opt-browse-btn hover-fx"
          disabled={disabled}
          onClick={() => setPickerOpen(true)}
          type="button"
        >
          Browse…
        </button>
      </div>
    </>
  );
};

const Toggle = ({ disabled, onChange, value }) => (
  <button
    className={`opt-toggle${value ? ' opt-toggle--on' : ''}`}
    disabled={disabled}
    onClick={() => onChange(!value)}
    type="button"
  >
    <span className="opt-toggle-thumb" />
  </button>
);

const SPEED_UNITS = { KiB: 1, MiB: 1_024, GiB: 1_048_576 };
const INT_MAX = 2_147_483_647;
const CONN_SPEED_PREFIX = 'resonance:connSpeed:';

const detectSpeedUnit = (kib) => {
  if (!kib || kib === 0 || kib === INT_MAX) return 'KiB';
  if (kib % 1_048_576 === 0) return 'GiB';
  if (kib % 1_024 === 0) return 'MiB';
  return 'KiB';
};

const formatSpeed = (kib) => {
  if (kib >= 1_048_576) {
    const v = kib / 1_048_576;
    return `${v % 1 === 0 ? v : v.toFixed(1)} GiB/s`;
  }

  if (kib >= 1_024) {
    const v = kib / 1_024;
    return `${v % 1 === 0 ? v : v.toFixed(1)} MiB/s`;
  }

  return `${kib} KiB/s`;
};

const SpeedSliderField = ({
  connectionSpeedValue,
  disabled,
  onChange,
  onConnectionSpeedChange,
  path,
  value,
}) => {
  const lsKey = CONN_SPEED_PREFIX + path.join('.');

  const resolvedConnKib =
    connectionSpeedValue ??
    (() => {
      const stored = prefs.get(lsKey, null);
      return stored !== null ? Number(stored) : null;
    })();

  const [maxKib, setMaxKib] = useState(resolvedConnKib);
  const [maxInput, setMaxInput] = useState(() => {
    if (!resolvedConnKib) return '';
    return String(
      resolvedConnKib / SPEED_UNITS[detectSpeedUnit(resolvedConnKib)],
    );
  });
  const [maxUnit, setMaxUnit] = useState(() =>
    resolvedConnKib ? detectSpeedUnit(resolvedConnKib) : 'MiB',
  );

  useEffect(() => {
    if (connectionSpeedValue != null && connectionSpeedValue !== maxKib) {
      setMaxKib(connectionSpeedValue);
      setMaxInput(
        String(
          connectionSpeedValue /
            SPEED_UNITS[detectSpeedUnit(connectionSpeedValue)],
        ),
      );
      setMaxUnit(detectSpeedUnit(connectionSpeedValue));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-way sync from saved option; maxKib is user-editable
  }, [connectionSpeedValue]);

  const limitKib =
    value == null || value === '' || value === INT_MAX ? 0 : value;
  const isUnlimited = limitKib === 0;
  const sliderPct =
    maxKib && !isUnlimited
      ? Math.min(100, Math.round((limitKib / maxKib) * 100))
      : 0;

  const applyMax = (displayValue, unit) => {
    const n = Number.parseFloat(displayValue);
    if (!Number.isNaN(n) && n > 0) {
      const kib = Math.round(n * SPEED_UNITS[unit]);
      setMaxKib(kib);
      if (onConnectionSpeedChange) {
        onConnectionSpeedChange(kib);
      } else {
        prefs.set(lsKey, kib);
      }
    } else {
      setMaxKib(null);
      if (onConnectionSpeedChange) {
        onConnectionSpeedChange(null);
      } else {
        prefs.set(lsKey, null);
      }
    }
  };

  const handleMaxInputChange = (e) => {
    setMaxInput(e.target.value);
    applyMax(e.target.value, maxUnit);
  };

  const handleMaxUnitChange = (e) => {
    const newUnit = e.target.value;
    setMaxUnit(newUnit);
    applyMax(maxInput, newUnit);
  };

  const handleSliderChange = (e) => {
    const pct = Number(e.target.value);
    onChange(pct === 0 ? 0 : Math.round((pct / 100) * (maxKib ?? 0)));
  };

  return (
    <div className="opt-speed-slider">
      <div className="opt-speed-row">
        <span className="opt-speed-row-label">Your speed</span>
        <div className="opt-input-wrap">
          <input
            className="opt-input opt-speed-input"
            disabled={disabled}
            min={0}
            onChange={handleMaxInputChange}
            placeholder="e.g. 100"
            step="any"
            type="number"
            value={maxInput}
          />
          <select
            className="opt-unit-select"
            disabled={disabled}
            onChange={handleMaxUnitChange}
            value={maxUnit}
          >
            {Object.keys(SPEED_UNITS).map((u) => (
              <option
                key={u}
                value={u}
              >
                {u}/s
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="opt-speed-row">
        <span className="opt-speed-row-label">Commit</span>
        <div className="opt-speed-commit">
          <input
            className="opt-speed-range"
            disabled={disabled || !maxKib}
            max={100}
            min={0}
            onChange={handleSliderChange}
            type="range"
            value={sliderPct}
          />
          <span className="opt-speed-limit-label">
            {isUnlimited
              ? 'Unlimited'
              : `${formatSpeed(limitKib)}${maxKib ? ` · ${sliderPct}%` : ''}`}
          </span>
        </div>
      </div>
    </div>
  );
};

const DeveloperSection = ({ disabled, onChange, parsed }) => {
  const swaggerEnabled = Boolean(
    getAtPath(parsed ?? {}, ['feature', 'swagger']),
  );
  // Build the Swagger link from the current origin (scheme/host/port) plus the
  // configured urlBase, so it works behind an HTTPS reverse proxy as well as in
  // local dev where the dev server proxies /swagger to the backend.
  const swaggerUrl = `${window.location.origin}${rootUrl}/swagger`;

  return (
    <div className="info-section">
      <div className="info-section-body">
        <OptionField
          disabled={disabled}
          field={{
            description:
              'Enable the Swagger API documentation UI. Requires a restart to take effect.',
            label: 'Swagger UI',
            type: 'toggle',
          }}
          onChange={(value) => onChange(['feature', 'swagger'], value)}
          value={swaggerEnabled}
        />
        {swaggerEnabled && (
          <div className="opt-field">
            <div className="opt-field-label">Swagger URL</div>
            <div className="opt-field-right">
              <div className="opt-field-control">
                <a
                  className="opt-link"
                  href={swaggerUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {swaggerUrl}
                </a>
              </div>
              <div className="opt-field-desc">
                Open the Swagger API documentation in your browser.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const DURATION_UNITS = {
  minutes: [
    { factor: 1, label: 'mins' },
    { factor: 60, label: 'hours' },
    { factor: 1_440, label: 'days' },
  ],
  seconds: [
    { factor: 1, label: 'secs' },
    { factor: 60, label: 'mins' },
    { factor: 3_600, label: 'hours' },
  ],
};

const bestDurationUnit = (value, baseUnit) => {
  const units = DURATION_UNITS[baseUnit];
  if (!value) return units[0];
  for (let index = units.length - 1; index >= 0; index--) {
    if (value >= units[index].factor && value % units[index].factor === 0)
      return units[index];
  }

  return units[0];
};

const DurationField = ({
  baseUnit,
  disabled,
  onChange,
  placeholder,
  value,
}) => {
  const units = DURATION_UNITS[baseUnit];
  const [unitLabel, setUnitLabel] = useState(
    () => bestDurationUnit(value, baseUnit).label,
  );
  const initializedRef = useRef(value != null);

  useEffect(() => {
    if (!initializedRef.current && value != null) {
      initializedRef.current = true;
      setUnitLabel(bestDurationUnit(value, baseUnit).label);
    }
  }, [baseUnit, value]);

  const currentUnit = units.find((u) => u.label === unitLabel) ?? units[0];
  const displayValue =
    value != null && value !== '' ? Number(value) / currentUnit.factor : '';

  const handleChange = (raw) => {
    if (raw === '') {
      onChange(0);
      return;
    }

    const n = Number.parseFloat(raw);
    if (!Number.isNaN(n)) onChange(Math.round(n * currentUnit.factor));
  };

  return (
    <div className="opt-input-wrap">
      <input
        className="opt-input"
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        step="any"
        type="number"
        value={displayValue}
      />
      <select
        className="opt-unit-select"
        disabled={disabled}
        onChange={(e) => setUnitLabel(e.target.value)}
        value={unitLabel}
      >
        {units.map((u) => (
          <option
            key={u.label}
            value={u.label}
          >
            {u.label}
          </option>
        ))}
      </select>
    </div>
  );
};

const renderControl = ({
  connectionSpeedValue,
  disabled,
  field,
  onChange,
  onConnectionSpeedChange,
  value,
}) => {
  const { choices, max, min, nullable, placeholder, type, unit } = field;

  if (type === 'duration') {
    return (
      <DurationField
        baseUnit={field.baseUnit}
        disabled={disabled}
        onChange={onChange}
        placeholder={placeholder}
        value={value}
      />
    );
  }

  if (type === 'speed') {
    return (
      <SpeedSliderField
        connectionSpeedValue={connectionSpeedValue}
        disabled={disabled}
        onChange={onChange}
        onConnectionSpeedChange={onConnectionSpeedChange}
        path={field.path}
        value={value}
      />
    );
  }

  if (type === 'folder') {
    return (
      <FolderField
        disabled={disabled}
        onChange={onChange}
        placeholder={placeholder}
        value={value}
      />
    );
  }

  if (type === 'toggle') {
    return (
      <Toggle
        disabled={disabled}
        onChange={onChange}
        value={Boolean(value)}
      />
    );
  }

  if (type === 'select') {
    return (
      <select
        className="opt-select"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value ?? ''}
      >
        {(choices ?? []).map((choice) => (
          <option
            key={choice}
            value={choice}
          >
            {choice}
          </option>
        ))}
      </select>
    );
  }

  if (type === 'textarea') {
    return (
      <textarea
        className="opt-textarea"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        value={value ?? ''}
      />
    );
  }

  const displayValue =
    type === 'number' && nullable && value === INT_MAX ? '' : value ?? '';

  const inputElement = (
    <div className="opt-input-wrap">
      <input
        autoComplete={type === 'password' ? 'new-password' : undefined}
        className="opt-input"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => {
          const raw = event.target.value;
          if (type === 'number') {
            onChange(raw === '' && nullable ? undefined : Number(raw));
          } else {
            onChange(raw);
          }
        }}
        placeholder={placeholder}
        type={type}
        value={displayValue}
      />
      {unit && <span className="opt-unit">{unit}</span>}
    </div>
  );

  return type === 'password' ? (
    <form onSubmit={(e) => e.preventDefault()}>
      <input
        aria-hidden="true"
        autoComplete="username"
        name="username"
        onChange={() => {}}
        style={{ display: 'none' }}
        type="text"
        value=""
      />
      {inputElement}
    </form>
  ) : (
    inputElement
  );
};

const OptionField = ({
  connectionSpeedValue,
  disabled,
  field,
  onChange,
  onConnectionSpeedChange,
  value,
}) => (
  <div className="opt-field">
    <div className="opt-field-label">{field.label}</div>
    <div className="opt-field-right">
      <div className="opt-field-control">
        {renderControl({
          connectionSpeedValue,
          disabled,
          field,
          onChange,
          onConnectionSpeedChange,
          value,
        })}
      </div>
      <div className="opt-field-desc">{field.description}</div>
    </div>
  </div>
);

const DiscogsTokenHelp = () => (
  <div className="opt-help">
    <div className="opt-help-title">How to get a token</div>
    Discogs has far deeper coverage of electronic, vinyl and underground
    releases than MusicBrainz, with richer genres (Discogs “Styles” such as
    Techno, Minimal and Tech House). To use it you need a free personal access
    token:
    <ol>
      <li>
        Sign in to Discogs and open{' '}
        <a
          className="opt-link"
          href="https://www.discogs.com/settings/developers"
          rel="noreferrer"
          target="_blank"
        >
          discogs.com/settings/developers
        </a>
        .
      </li>
      <li>
        Under <strong>Personal access token</strong>, click{' '}
        <strong>Generate new token</strong>.
      </li>
      <li>
        Copy the token and paste it into the <strong>Discogs Token</strong>{' '}
        field below.
      </li>
      <li>
        Turn on <strong>Use Discogs</strong> (with{' '}
        <strong>Enable Metadata Retrieval</strong> on), then{' '}
        <strong>Save</strong>. A backend restart applies the change.
      </li>
    </ol>
  </div>
);

const LastfmKeyHelp = () => (
  <div className="opt-help">
    <div className="opt-help-title">How to get an API key</div>
    Last.fm’s community tags are a good genre source for obscure and electronic
    tracks. To use them you need a free API key:
    <ol>
      <li>
        Sign in to Last.fm and open{' '}
        <a
          className="opt-link"
          href="https://www.last.fm/api/account/create"
          rel="noreferrer"
          target="_blank"
        >
          last.fm/api/account/create
        </a>
        .
      </li>
      <li>Fill in the form (any application name/description) and submit.</li>
      <li>
        Copy the <strong>API key</strong> and paste it into the{' '}
        <strong>Last.fm API Key</strong> field below.
      </li>
      <li>
        Turn on <strong>Use Last.fm</strong>, then <strong>Save</strong>. A
        backend restart applies the change.
      </li>
    </ol>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const SOULSEEK_ACCOUNT_TITLE = 'Soulseek Account';

// Order in which nav groups are shown. Sections are bucketed by their `group`
// field; the flat SCHEMA order is preserved within each group.
const GROUP_ORDER = [
  'System',
  'Soulseek',
  'Transfers',
  'Peers',
  'Sharing',
  'Integrations',
];

// eslint-disable-next-line complexity
const Options = ({ options, state = {}, theme }) => {
  const [activeSection, setActiveSection] = useState(0);
  const [debugModal, setDebugModal] = useState(false);
  const [scanWorking, setScanWorking] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [parsed, setParsed] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
  });
  const [credentialsDirty, setCredentialsDirty] = useState(false);
  const [managedShares, setManagedShares] = useState([]);

  const { debug } = options;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const [yamlText, creds, sharesByHost] = await Promise.all([
          getYaml(),
          getSoulseekCredentials(),
          sharesLibrary.getAll(),
        ]);
        setParsed(YAML.parse(yamlText) ?? {});
        setCredentials({
          username: creds.username ?? '',
          password: creds.password ?? '',
        });
        const allShares = Object.values(sharesByHost).flat();
        setManagedShares(allShares.filter((s) => s.isManaged));
      } catch (error) {
        setFetchError(error.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [loadKey]);

  const handleChange = (path, value) => {
    setParsed((previous) => setAtPath(previous ?? {}, path, value));
    setIsDirty(true);
    setSaveError(null);
  };

  const handleCredentialChange = (field, value) => {
    setCredentials((previous) => ({ ...previous, [field]: value }));
    setCredentialsDirty(true);
    setSaveError(null);
  };

  const handleDiscard = () => {
    setIsDirty(false);
    setCredentialsDirty(false);
    setLoadKey((previous) => previous + 1);
  };

  const isSoulseekSection =
    SCHEMA[activeSection]?.title === SOULSEEK_ACCOUNT_TITLE;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (isSoulseekSection && credentialsDirty) {
        if (!credentials.username || !credentials.password) {
          setSaveError('Username and password are required');
          return;
        }

        await updateSoulseekCredentials({
          username: credentials.username,
          password: credentials.password,
        });
        setCredentialsDirty(false);
      }

      if (isDirty) {
        if (
          getAtPath(parsed, ['web', 'disabled']) &&
          getAtPath(parsed, ['web', 'https', 'disabled'])
        ) {
          setSaveError(
            'Cannot disable both HTTP and HTTPS — you would be locked out of the web interface.',
          );
          setSaving(false);
          return;
        }

        const newYaml = YAML.stringify(parsed ?? {}, {
          simpleKeys: true,
          sortMapEntries: false,
        });
        const validationError = await validateYaml({ yaml: newYaml });
        if (validationError) {
          setSaveError(validationError);
          return;
        }

        await updateYaml({ yaml: newYaml });
        setIsDirty(false);
      }
    } catch (error) {
      setSaveError(error?.response?.data ?? error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRescan = async () => {
    try {
      setScanWorking(true);
      await sharesLibrary.rescan();
    } catch (error) {
      console.error(error);
    } finally {
      setScanWorking(false);
    }
  };

  const handleCancelScan = async () => {
    try {
      setScanWorking(true);
      await sharesLibrary.cancel();
    } catch (error) {
      console.error(error);
    } finally {
      setScanWorking(false);
    }
  };

  const getFieldValue = (field) =>
    parsed === null
      ? getAtPathCamel(options, field.path)
      : getAtPath(parsed, field.path);

  const isEditable = parsed !== null && !loading;

  return (
    <div className="opts-shell">
      <div className="opts-toolbar">
        <span className="opts-toolbar-title">
          {SCHEMA[activeSection].title}
        </span>
        <div className="opts-toolbar-actions">
          {SCHEMA[activeSection].type === 'shares' &&
            (state?.shares?.scanning ? (
              <ShrinkableButton
                color="red"
                disabled={scanWorking}
                icon="x"
                loading={scanWorking}
                mediaQuery="(max-width: 516px)"
                onClick={handleCancelScan}
              >
                Cancel Scan
              </ShrinkableButton>
            ) : (
              <ShrinkableButton
                color={state?.shares?.scanPending ? 'yellow' : undefined}
                disabled={scanWorking}
                icon={scanWorking ? 'spinner' : 'refresh'}
                loading={scanWorking}
                mediaQuery="(max-width: 516px)"
                onClick={handleRescan}
                primary={!state?.shares?.scanPending}
              >
                Rescan Shares
              </ShrinkableButton>
            ))}
          {debug && SCHEMA[activeSection].type !== 'shares' && (
            <ShrinkableButton
              icon="bug"
              mediaQuery="(max-width: 516px)"
              onClick={() => setDebugModal(true)}
            >
              Debug View
            </ShrinkableButton>
          )}
          {(isDirty || (isSoulseekSection && credentialsDirty)) && (
            <ShrinkableButton
              disabled={saving}
              icon={saving ? 'spinner' : 'save'}
              loading={saving}
              mediaQuery="(max-width: 516px)"
              onClick={handleSave}
              primary
            >
              Save Changes
            </ShrinkableButton>
          )}
          {(isDirty || (isSoulseekSection && credentialsDirty)) && (
            <ShrinkableButton
              icon="undo"
              mediaQuery="(max-width: 516px)"
              onClick={handleDiscard}
            >
              Discard
            </ShrinkableButton>
          )}
        </div>
      </div>

      {(fetchError || saveError) && (
        <div className="opts-errors">
          {fetchError && (
            <div className="opt-error">
              Failed to load configuration: {fetchError}
            </div>
          )}
          {saveError && (
            <div className="opt-error">Save failed: {saveError}</div>
          )}
        </div>
      )}

      <div className="opts-layout">
        <nav className="opts-nav">
          {GROUP_ORDER.map((group) => {
            const items = SCHEMA.map((section, index) => ({
              section,
              index,
            })).filter(({ section }) => section.group === group);
            if (items.length === 0) return null;
            return (
              <div
                className="opts-nav-group"
                key={group}
              >
                <div className="opts-nav-group-title">{group}</div>
                {items.map(({ index, section }) => (
                  <button
                    className={`opts-nav-item hover-fx${activeSection === index ? ' opts-nav-item--active' : ''}`}
                    key={section.title}
                    onClick={() => setActiveSection(index)}
                    type="button"
                  >
                    {section.title}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="opts-content">
          {SCHEMA[activeSection].type === 'schedule' ? (
            <QoSSection
              disabled={!isEditable}
              onChange={(value) => handleChange(['qos', 'schedule'], value)}
              value={parsed?.qos?.schedule ?? []}
            />
          ) : SCHEMA[activeSection].type === 'developer' ? (
            <DeveloperSection
              disabled={!isEditable}
              onChange={handleChange}
              parsed={parsed}
            />
          ) : SCHEMA[activeSection].type === 'shares' ? (
            <SharesSection
              disabled={!isEditable}
              managedPaths={managedShares}
              onChange={(value) =>
                handleChange(['shares', 'directories'], value)
              }
              scanState={state.shares}
              value={parsed?.shares?.directories ?? []}
            />
          ) : (
            <div className="info-section">
              <div className="info-section-body">
                {isSoulseekSection && (
                  <>
                    <OptionField
                      disabled={!isEditable}
                      field={{
                        description: 'Your Soulseek account username.',
                        label: 'Username',
                        type: 'text',
                      }}
                      key="credentials-username"
                      onChange={(value) =>
                        handleCredentialChange('username', value)
                      }
                      value={credentials.username}
                    />
                    <OptionField
                      disabled={!isEditable}
                      field={{
                        description: 'Your Soulseek account password.',
                        label: 'Password',
                        type: 'password',
                      }}
                      key="credentials-password"
                      onChange={(value) =>
                        handleCredentialChange('password', value)
                      }
                      value={credentials.password}
                    />
                  </>
                )}
                {SCHEMA[activeSection].fields.map((field) => {
                  if (field.type === 'heading') {
                    return (
                      <div
                        className="opt-subheading"
                        key={`heading-${field.label}`}
                      >
                        {field.label}
                      </div>
                    );
                  }

                  if (field.type === 'help' && field.help === 'discogs') {
                    return <DiscogsTokenHelp key="discogs-help" />;
                  }

                  if (field.type === 'help' && field.help === 'lastfm') {
                    return <LastfmKeyHelp key="lastfm-help" />;
                  }

                  const conditionallyDisabled =
                    (field.disabledWhen &&
                      getAtPath(parsed ?? {}, field.disabledWhen.path) ===
                        field.disabledWhen.equals) ||
                    // gate a toggle on a required value elsewhere (e.g. an API key/token)
                    (field.requiresValue &&
                      isBlank(getAtPath(parsed ?? {}, field.requiresValue))) ||
                    false;
                  return (
                    <OptionField
                      connectionSpeedValue={
                        field.connectionSpeedPath
                          ? getAtPath(parsed ?? {}, field.connectionSpeedPath)
                          : undefined
                      }
                      disabled={!isEditable || conditionallyDisabled}
                      field={field}
                      key={field.path.join('.')}
                      onChange={(value) => handleChange(field.path, value)}
                      onConnectionSpeedChange={
                        field.connectionSpeedPath
                          ? (v) => handleChange(field.connectionSpeedPath, v)
                          : undefined
                      }
                      value={getFieldValue(field)}
                    />
                  );
                })}
                {SCHEMA[activeSection].title === 'Browse Rate Limiting' && (
                  <BrowseRateLimitSection />
                )}
                {SCHEMA[activeSection].title ===
                  'Transfer Error Notifications' && (
                  <TransferErrorNotificationSection />
                )}
                {SCHEMA[activeSection].title === 'YouTube / yt-dlp' && (
                  <YtDlpOptionsSection />
                )}
                {SCHEMA[activeSection].title === 'ffmpeg' && <FfmpegSection />}
              </div>
            </div>
          )}
        </div>
      </div>

      <DebugModal
        onClose={() => setDebugModal(false)}
        open={debugModal}
        theme={theme}
      />
    </div>
  );
};

export default Options;
