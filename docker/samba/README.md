# Music server share

The existing CrazyMax Samba container stays on the development server. The music
filesystem remains at `/mnt/music`. Its Compose service adds this bind mount while
preserving the existing data share:

```yaml
services:
  samba:
    volumes:
      - /mnt/music:/samba/downloads
```

The private CrazyMax `/data/config.yml` includes this share alongside existing
shares and its existing authentication section:

```yaml
share:
  - name: music_network
    path: /samba/downloads
    browsable: true
    readonly: false
    guestok: false
    validusers: narey
```

The live endpoint is `//192.168.0.254/music_network`. `ServerStore` is unchanged.
Authentication remains the existing Samba account; no passwords or full private
configuration are stored in this repository. The laptop mounts this share through
Docker CIFS, using the portable bootstrap. A read/write probe from that system
passed, and its temporary file was removed. Music files were not moved or changed.
