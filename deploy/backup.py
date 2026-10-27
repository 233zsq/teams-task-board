#!/usr/bin/python3
"""Consistent SQLite online backup; no user data or secrets in output."""
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3

source = Path('/var/lib/team-task-board/team-plan.sqlite')
directory = Path('/var/backups/team-task-board/database')
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
target = directory / f'team-plan-{stamp}.sqlite'
temporary = directory / f'.{target.name}.tmp'
os.umask(0o077)
try:
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as live:
        with sqlite3.connect(temporary) as backup:
            live.backup(backup)
            if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup integrity check failed')
    with temporary.open('rb') as stream:
        os.fsync(stream.fileno())
    os.replace(temporary, target)
    print(f'BACKUP_OK={target}')
finally:
    if temporary.exists():
        temporary.unlink()
