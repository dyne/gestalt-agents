#!/usr/bin/env python3
"""Print bounded structural counts from a captured trace, never its payloads."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys

from importlib.util import module_from_spec, spec_from_file_location

spec = spec_from_file_location('capture', Path(__file__).with_name('capture-incident.py'))
capture = module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(capture)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', help='capture directory containing capture.json and trace.json')
    parser.add_argument('--event-type', help='optional exact structural event type')
    args = parser.parse_args()
    try:
        packet = Path(args.artifact)
        metadata = json.loads((packet / 'capture.json').read_text())
        trace = json.loads((packet / 'trace.json').read_text())
        start = capture.utc(metadata['requestedStart'])
        end = capture.utc(metadata['requestedEnd'])
        result = capture.coverage(trace, start, end)
        result.update(requestedStart=capture.stamp(start), requestedEnd=capture.stamp(end),
                      matchingEvents=0, failureEvents=0, eventTypes=[], omittedEventTypes=0)
        if metadata.get('status') != 'captured':
            raise ValueError('failed capture')
        if result['coverage'] == 'unknown':
            print(json.dumps(result))
            return 0
        counts = Counter()
        for event in trace['events']:
            if not start <= capture.utc(event['occurredAt']) <= end:
                continue
            name = event.get('type')
            if not isinstance(name, str) or not re.fullmatch(
                    r'(?:org-plan|autopilot|agent\.activity|session\.status)\.[a-z.-]{1,80}', name):
                name = '[unrecognized]'
            if args.event_type and name != args.event_type:
                continue
            result['matchingEvents'] += 1
            result['failureEvents'] += int(name.endswith(('-failed', '.failed')))
            counts[name] += 1
        # Stable limit; do not print error reasons, diagnoses, identifiers or payloads.
        result['eventTypes'] = [dict(type=name, count=count) for name, count in counts.most_common(10)]
        result['omittedEventTypes'] = max(0, len(counts) - 10)
        print(json.dumps(result))
        return 0
    except (OSError, KeyError, ValueError, TypeError, AttributeError):
        print(json.dumps(dict(status='failed', coverage='unknown', error='invalid capture packet')))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
