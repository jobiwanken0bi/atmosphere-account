"""Durable metadata only; never call these helpers with credential values."""
import json
import os
from pathlib import Path
import tempfile

CODE = Path(__file__).resolve().parent
ROOT = CODE / 'state'

def prepare():
    ROOT.mkdir(mode=0o700, exist_ok=True)
    if ROOT.is_symlink() or ROOT.stat().st_uid != os.getuid():
        raise RuntimeError('Rotation state must be an owner-controlled directory.')
    ROOT.chmod(0o700)

def write(name, data):
    prepare()
    if Path(name).name != name:
        raise ValueError('Expected a state filename.')
    fd, temporary = tempfile.mkstemp(prefix='.' + name, dir=ROOT)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, ROOT / name)
        directory = os.open(ROOT, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
