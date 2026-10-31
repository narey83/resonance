# HTTP/3 playback investigation — 31 October 2026

A controlled test reproduced a concrete HTTP/3 resume incompatibility on Mac
Brave, with matching client and server traces. This replaces the earlier broad
HTTP/2-only mitigation with a targeted transport policy.

## Evidence

The stopped previous gateway's binary identifies Caddy 2.11.4 / quic-go 0.59.1.
The dev laptop runs Caddy 2.11.7 / quic-go 0.63.0. Neither deployment previously
specified a header limit. Caddy 2.11.6 changed the default from 1 MiB to 16 KiB
([release notes](https://github.com/caddyserver/caddy/releases/tag/v2.11.6)).

On an isolated synthetic-audio origin, the installed Caddy initially advertised
1 MiB. Twelve Mac playback changes succeeded over HTTP/3. Reloading the same
Caddy with only the header limit changed to 16 KiB reproduced:

```text
QUIC error 164:
Server sent an SETTINGS_MAX_FIELD_SECTION_SIZE: 16384
which reduces current value: 1048576
```

The completed Brave NetLog contains that error on source 405683. The matching
server qlog `1f045c5e2ced8d74_server.sqlog` contains two early-data packets and
an application connection close with error 265 (`H3_SETTINGS_ERROR`) and the same
reason. A separate direct-server-to-Caddy transition also reproduced error 165,
where early data was rejected but Chromium still rejected the reduced settings.
Neither failure depends on a real music file or library/database work.

HTTP/3 clients remember settings for early-data requests. A server accepting early
data must not reduce those remembered limits
([RFC 9114 section 7.2.4.2](https://www.rfc-editor.org/rfc/rfc9114.html#section-7.2.4.2)).
In the installed sources, Caddy's external QUIC listener uses the public
`http3.ConfigureTLSConfig` wrapper, then `ServeListener`. This bypasses the
HTTP/3 server-specific session-ticket settings compatibility checks used by
quic-go's internally created listener. The reproduced accepted-early-data failure
is consistent with that integration path. No custom proxy binary or upstream
source patch is part of this deployment.

## Correction and validation

The shared transport import enables HTTP/1.1, HTTP/2 and HTTP/3, turns early data
off, and pins the header budget at 16 KiB. It keeps HTTP/3 available without
allowing requests to reuse stale settings before the handshake. The site no
longer sends `Alt-Svc: clear`; Caddy advertises its actual HTTP/3 port.

With a freshly created isolated Caddy listener using `0rtt off`, repeating the
1 MiB to 16 KiB change kept all twelve Mac audio starts on HTTP/3, at 20–53 ms.
Forty cancelled transfers and the final probe also succeeded over HTTP/3. The two
server traces contain no early-data packets or error closes. These are synthetic
transport measurements, not end-to-end timings for real library files.

The automated HTTP/3 regression uses the real transport import, an HTTP/3-only
listener and the same browser across the limit change. It verifies eight audio
starts, seeking, byte ranges, a new connection after reload and no NetLog errors
164/165. The separate HTTP/2 test verifies the fallback path. Both run in the
site-health workflow. Runtime tests run on the dev laptop; Mac Brave provides
additional client-route evidence.

A reload may reuse Caddy's cached QUIC listener, whose early-data option was fixed
when it was created. Apply this setting to a fresh listener; simply editing the
JSON on an already active HTTP/3 listener is insufficient. The production
migration begins with HTTP/3 disabled, so it creates a fresh listener without
restarting the backend. Preserve this detail during future upgrades and rollback.

## Scope and retained artifacts

The original twelve-second production failure was not captured at the time. The
controlled experiment proves the settings incompatibility and matches the actual
proxy version/default change; it does not prove that every historical delay had
this cause. The reproduced error recovered through HTTP/2 in about 73 ms, so it
must not be presented as a reproduced twelve-second timeout.

Private evidence remains under `.dev/quic-forensics/` on the Mac and
`/home/narey/resonance-builds/quic-forensics-20261031` on the dev laptop. The user's
completed `chrome-net-export-log.json` remains private and excluded from Git.
Raw browser logs and proxy configuration can contain sensitive data: do not
attach them to public issues. No upstream issue has been submitted.
