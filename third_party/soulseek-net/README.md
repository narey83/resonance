# Patched Soulseek.NET

`backend/resonance.csproj` references `Soulseek 10.0.2-resonance.1`, which is
[`third_party/packages/Soulseek.10.0.2-resonance.1.nupkg`](../packages) — upstream
[Soulseek.NET](https://github.com/jpdillingham/Soulseek.NET) `10.0.2` plus
[`enforce-upload-linger-deadline.patch`](enforce-upload-linger-deadline.patch). `nuget.config` at the repo root adds
`third_party/packages` as a package source so restore finds it.

## Why

After the last byte of an upload is written, `SoulseekClient.UploadFromStreamAsync` lingers on the transfer
connection waiting for the receiver to hang up, which is how it knows they got everything. The loop checks
`TransferOptions.MaximumLingerTime` (default 3s) only *between* reads, and the read it awaits doesn't return
until the receiver sends something or the connection dies. A receiver that goes silent without disconnecting
therefore holds the connection — and, through `SlotAwaiter`, one of our upload slots — until the connection
inactivity timeout fires instead (`soulseek.connection.timeout.transfer`, 60s for us).

That is reachable in normal operation: a peer re-requesting a file it already holds in full sends a start
offset equal to the file size, the write is skipped, and neither side has anything left to send or any reason
to hang up. In the 30 days before this patch, 18,572 such transfers across 158 peers burned ~317 hours of
upload-slot time, each one recorded as a 60-second success that moved zero bytes.

The patch races the read against the time remaining, so the deadline is enforceable.

## Rebuilding

```bash
git clone --depth 1 --branch 10.0.2 https://github.com/jpdillingham/Soulseek.NET.git
cd Soulseek.NET
git apply /path/to/resonance/third_party/soulseek-net/enforce-upload-linger-deadline.patch
dotnet build src/Soulseek.csproj -c Release -p:Version=10.0.2-resonance.1
dotnet pack  src/Soulseek.csproj -c Release -p:Version=10.0.2-resonance.1 --no-build -o ./nupkg
cp nupkg/Soulseek.10.0.2-resonance.1.nupkg /path/to/resonance/third_party/packages/
```

Bump the `-resonance.N` suffix when the patch changes — NuGet caches by version, so reusing a version leaves
stale copies in `~/.nuget/packages` and on the server.

## Dropping this

The patch is upstreamable as-is and isn't Resonance-specific. Once it lands in a released Soulseek.NET, point
`backend/resonance.csproj` back at the official package and delete this directory, the `resonance-local`
source in `nuget.config`, and `third_party/packages`.
