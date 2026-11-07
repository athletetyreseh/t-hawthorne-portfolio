"""Prepare a private, reviewable D1 import from a Sites checkouts JSON snapshot.

The input, output, and any photo files must stay outside the public repository.
Photos already 72 hours old are intentionally not transferred.
"""
import argparse
import datetime as dt
import json
import os
import re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path, help='Private JSON with a rows array')
parser.add_argument('--sql', required=True, type=Path, help='New private SQL output')
parser.add_argument('--manifest', required=True, type=Path, help='New private photo manifest')
parser.add_argument('--photos-dir', type=Path, help='Directory holding original R2 objects, if any are unexpired')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
for path in [args.source, args.sql, args.manifest, *([args.photos_dir] if args.photos_dir else [])]:
    if path.resolve().is_relative_to(repo):
        parser.error('Input, output, and photos must be outside the public repository')

with args.source.open(encoding='utf8') as file:
    data = json.load(file)
rows = data.get('rows') if isinstance(data, dict) else data
if not isinstance(rows, list):
    parser.error('Source must be a JSON array or an object with a rows array')

columns = ('id','badge','first_name','last_name','phone','photo_key','checked_out_at','returned_at','owner')
now = dt.datetime.now(dt.timezone.utc)
active = set()
ids = set()
photos = []
statements = []

def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('timestamp has no timezone')
    return parsed.astimezone(dt.timezone.utc)

def quoted(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"

for row in rows:
    if not isinstance(row, dict) or any(key not in row for key in columns):
        raise SystemExit('A row is missing required columns; no import was written')
    row = {key: row[key] for key in columns}
    if not isinstance(row['id'], str) or not re.fullmatch(r'[a-f0-9-]{36}', row['id']) or row['id'] in ids:
        raise SystemExit('An ID is invalid or duplicated; no import was written')
    ids.add(row['id'])
    if not re.fullmatch(r'(wab|amz|shred)-0[12]|ship-0[123]|misc-0[1234]', str(row['badge'])):
        raise SystemExit('A badge ID is invalid; no import was written')
    if not all(isinstance(row[key], str) and row[key] for key in ('first_name','last_name','phone','checked_out_at')):
        raise SystemExit('A required value is missing; no import was written')
    try:
        checked_out = timestamp(row['checked_out_at'])
        if row['returned_at'] is not None:
            timestamp(row['returned_at'])
    except (ValueError, TypeError, AttributeError):
        raise SystemExit('A timestamp is invalid; no import was written')
    if row['returned_at'] is None:
        if row['badge'] in active:
            raise SystemExit('More than one active checkout exists for a badge; no import was written')
        active.add(row['badge'])
    if not row['photo_key']:
        row['photo_key'] = None
    else:
        key = row['photo_key']
        if not isinstance(key, str) or not re.fullmatch(r'[a-f0-9-]{36}\.jpg', key):
            raise SystemExit('An ID photo key is invalid; no import was written')
        if now - checked_out >= dt.timedelta(hours=72):
            row['photo_key'] = None
        else:
            if not args.photos_dir:
                raise SystemExit('Unexpired photos require --photos-dir; no import was written')
            source = (args.photos_dir / key).resolve()
            if source.parent != args.photos_dir.resolve() or not source.is_file():
                raise SystemExit('An unexpired photo is missing; no import was written')
            photos.append({'key':key, 'file':str(source)})
    values = ', '.join(quoted(row[key]) for key in columns)
    statements.append(f"INSERT INTO checkouts ({','.join(columns)}) VALUES ({values});")

def private_write(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf8') as file:
        file.write(content)

private_write(args.sql, '\n'.join(statements) + '\n')
private_write(args.manifest, json.dumps(photos, indent=2) + '\n')
print(f'Prepared {len(rows)} records, {len(active)} active checkouts, and {len(photos)} unexpired photos in private files.')
