"""Configure Docker's CIFS driver without exposing passwords in command arguments."""

import getpass
import hashlib
import http.client
import json
import socket
from pathlib import Path
from urllib.parse import quote


class DockerAPI:
    def __init__(self, endpoint="/var/run/docker.sock"):
        self.endpoint = endpoint

    def request(self, method, path, value=None):
        connection = http.client.HTTPConnection("localhost", timeout=60)
        connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.sock.settimeout(60)
        connection.sock.connect(self.endpoint)
        try:
            connection.request(
                method,
                path,
                body=json.dumps(value) if value is not None else None,
                headers={"Content-Type": "application/json"},
            )
            response = connection.getresponse()
            body = response.read()
            # Daemon errors can contain mount options. Never echo the response body.
            if response.status not in (200, 201, 404):
                raise RuntimeError(
                    "Docker volume operation failed (HTTP "
                    + str(response.status)
                    + "); inspect daemon logs privately"
                )
            return response.status, json.loads(body) if body else {}
        finally:
            connection.close()


def credentials(config, directory):
    path = Path(
        config.get("smbCredentialsFile", directory / "smb.credentials")
    ).expanduser()
    if not path.exists():
        username = config.get("smbUsername") or input("SMB username: ").strip()
        password = getpass.getpass("SMB password (stored privately on this host): ")
        if (
            not username
            or not password
            or any(char in username + password for char in "\r\n\0")
        ):
            raise ValueError("Single-line SMB credentials are required")
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x") as stream:
            path.chmod(0o600)
            stream.write("username=" + username + "\npassword=" + password + "\n")
    if path.stat().st_mode & 0o077:
        raise ValueError("SMB credential file must have mode 0600")
    values = dict(
        line.split("=", 1) for line in path.read_text().splitlines() if "=" in line
    )
    if not values.get("username") or not values.get("password"):
        raise ValueError("SMB username/password are required")
    return values


def volume_definition(source, account, uid, gid, address):
    for key in ("username", "password", "domain"):
        if any(char in account.get(key, "") for char in ",\r\n\0"):
            raise ValueError(
                "Docker CIFS credentials cannot contain commas or line breaks; use a compatible dedicated SMB account"
            )
    options = [
        "addr=" + address,
        "username=" + account["username"],
        "password=" + account["password"],
        "vers=3.1.1",
        "seal",
        "uid=" + str(uid),
        "gid=" + str(gid),
        "nosuid",
        "nodev",
        "noexec",
    ]
    if account.get("domain"):
        options.append("domain=" + account["domain"])
    return {"type": "cifs", "device": source, "o": ",".join(options)}


def ensure_music_volume(config, directory, name, uid, gid, api=None):
    source = config["smbSource"].rstrip("/")
    account = credentials(config, directory)
    host = source[2:].split("/", 1)[0]
    address = socket.gethostbyname(host)
    options = volume_definition(source, account, uid, gid, address)
    suffix = hashlib.sha256((source + "\0" + account["username"]).encode()).hexdigest()[
        :12
    ]
    volume = name + "_music_" + suffix
    api = api or DockerAPI()
    status, existing = api.request("GET", "/volumes/" + quote(volume, safe=""))
    if status == 200:
        if existing.get("Driver") != "local" or existing.get("Options") != options:
            raise RuntimeError(
                "Existing music volume configuration differs; it has been preserved"
            )
    else:
        api.request(
            "POST",
            "/volumes/create",
            {
                "Name": volume,
                "Driver": "local",
                "DriverOpts": options,
                "Labels": {"resonance.managed": "true", "resonance.share": source},
            },
        )
    return volume
