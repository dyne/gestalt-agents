#!/usr/bin/env python3
"""Preserve the supported read-only Mobile trace; never print trace payloads."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def utc(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('timezone required')
    return parsed.astimezone(dt.timezone.utc)


def stamp(value):
    return value.isoformat().replace('+00:00', 'Z')


def coverage(trace, start, end):
    result = dict(eventCount=None, firstTimestamp=None, lastTimestamp=None,
                  coverage='unknown', coverageBasis='observed event envelope only')
    if not isinstance(trace, dict) or trace.get('schemaVersion') != 1:
        return result
    events = trace.get('events')
    if not isinstance(events, list):
        return result
    result['eventCount'] = len(events)
    try:
        times = [utc(event['occurredAt']) for event in events]
    except (KeyError, TypeError, ValueError, AttributeError):
        return result
    if not times:
        result['coverage'] = 'missing'
        return result
    first, last = min(times), max(times)
    result.update(firstTimestamp=stamp(first), lastTimestamp=stamp(last))
    result['coverage'] = ('covered' if first <= start and last >= end else
                          'missing' if last < start or first > end else 'partial')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--session', required=True)
    parser.add_argument('--cwd', required=True, help='explicit relay workspace, never inferred')
    parser.add_argument('--data-dir', help='explicit relay state override')
    parser.add_argument('--output', required=True, help='parent for a unique private capture')
    parser.add_argument('--start', required=True, help='incident start with UTC offset')
    parser.add_argument('--end', required=True, help='incident end with UTC offset')
    args = parser.parse_args()
    artifact = None
    try:
        start, end = utc(args.start), utc(args.end)
        if start > end:
            raise ValueError('range')
        workspace = Path(args.cwd).resolve(strict=True)
        if not workspace.is_dir() or not args.session or len(args.session) > 256:
            raise ValueError('input')
        data = Path(args.data_dir).resolve(strict=True) if args.data_dir else None
        if data and not data.is_dir():
            raise ValueError('data directory')
        mobile = os.environ.get('GESTALT_MOBILE_BIN')
        source = 'GESTALT_MOBILE_BIN' if mobile else 'gestalt path mobile'
        if not mobile:
            found = subprocess.run(['gestalt', 'path', 'mobile'], capture_output=True,
                                   timeout=15, check=True)
            mobile = found.stdout.decode().strip()
        if not mobile or '\n' in mobile:
            raise ValueError('discovery')
        executable = Path(shutil.which(mobile) or mobile).resolve(strict=True)
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise ValueError('executable')
        parent = Path(args.output).resolve(strict=True)
        artifact = Path(tempfile.mkdtemp(prefix='incident-', dir=parent))
        metadata = dict(capturedAt=stamp(dt.datetime.now(dt.timezone.utc)),
                        sessionId=args.session, workspace=str(workspace),
                        dataDirectory=str(data) if data else None,
                        provenance='explicit arguments; exporter has no workspace identity',
                        executable=str(executable), executableDiscovery=source,
                        exporterVersion=None, requestedStart=stamp(start), requestedEnd=stamp(end),
                        exportEventLimit=5000, status='failed', coverage='unknown')
        try:
            version = subprocess.run([str(executable), '--version'], capture_output=True, timeout=15)
            value = version.stdout.decode().strip()
            if version.returncode == 0 and len(value) <= 100 and all(c.isalnum() or c in '.+-_ ' for c in value):
                metadata['exporterVersion'] = value
        except (OSError, subprocess.TimeoutExpired, UnicodeError):
            pass
        command = [str(executable), 'trace', args.session, '--json', '--cwd', str(workspace)]
        if data:
            command += ['--data-dir', str(data)]
        trace_path = artifact / 'trace.json'
        with trace_path.open('xb') as output, (artifact / 'export.stderr').open('xb') as error:
            os.chmod(trace_path, 0o600)
            os.chmod(artifact / 'export.stderr', 0o600)
            try:
                export = subprocess.run(command, stdout=output, stderr=error, timeout=60)
                metadata['exportExit'] = export.returncode
                if export.returncode != 0:
                    raise ValueError('export_failed')
                with trace_path.open() as saved:
                    trace = json.load(saved)
                if not isinstance(trace, dict) or trace.get('sessionId') != args.session:
                    raise ValueError('session_mismatch')
                # Optional identities must agree; current schema has none.
                if 'workspace' in trace and Path(trace['workspace']).resolve() != workspace:
                    raise ValueError('workspace_mismatch')
                metadata.update(coverage(trace, start, end), status='captured')
            except (ValueError, TypeError, OSError, subprocess.TimeoutExpired) as failure:
                metadata['error'] = (str(failure) if str(failure) in
                                     ('export_failed', 'session_mismatch', 'workspace_mismatch')
                                     else 'invalid_or_unavailable_export')
        path = artifact / 'capture.json'
        with path.open('x') as saved:
            os.chmod(path, 0o600)
            json.dump(metadata, saved, indent=2)
            saved.write('\n')
        # Identifiers, errors, versions and payloads stay in the private packet.
        print(json.dumps(dict(status=metadata['status'], coverage=metadata['coverage'],
                              eventCount=metadata.get('eventCount'), artifact=str(artifact),
                              trace=str(trace_path), metadata=str(path))))
        return 0 if metadata['status'] == 'captured' else 1
    except (OSError, ValueError, subprocess.SubprocessError, UnicodeError):
        print(json.dumps(dict(status='failed', error='check explicit paths, range and Mobile discovery',
                              artifact=str(artifact) if artifact else None)))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
