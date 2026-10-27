"""Load the pinned local HTDemucs checkpoint with weights-only deserialization."""

import hashlib
from fractions import Fraction
from pathlib import Path

import numpy as np
import torch
from demucs.htdemucs import HTDemucs
from demucs.pretrained import get_model

CHECKPOINT = "955717e8-8726e21a.th"
SHA256 = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"


def load_verified_model(root):
    root = Path(root)
    with (root / CHECKPOINT).open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != SHA256:
            raise ValueError("HTDemucs checkpoint identity mismatch")
    # Demucs stores its model class and NumPy scalar constructor in this specific
    # verified checkpoint. Keep PyTorch weights-only loading enabled and scope the
    # required constructors to this load instead of enabling arbitrary pickle.
    with torch.serialization.safe_globals(
        [
            HTDemucs,
            Fraction,
            np.dtype,
            np.core.multiarray.scalar,
            type(np.dtype("float64")),
            type(np.dtype("float32")),
        ]
    ):
        return get_model("955717e8", repo=root)
