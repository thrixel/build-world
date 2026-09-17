#!/usr/bin/env python3
"""Summarize numeric frame rows from UE CSV Profiler captures (no dependencies)."""
import argparse
import csv
import json
import math
import statistics
from pathlib import Path


def summarize(path, columns, start=0, stop=None):
    with Path(path).open(newline='', encoding='utf-8-sig') as stream:
        reader = csv.DictReader(stream)
        missing = set(columns) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f'{path}: missing columns {sorted(missing)}')
        frames = []
        for row in reader:
            # UE appends metadata after the frame rows. Do not count it as frames.
            try:
                values = {key: float(row[key]) for key in columns}
            except (TypeError, ValueError, KeyError):
                continue
            if all(math.isfinite(value) for value in values.values()):
                frames.append(values)
    sample = frames[start:stop]
    if not sample:
        raise ValueError(f'{path}: no frames in requested slice')
    result = {'file': str(path), 'total_frames': len(frames),
              'sample_start': start, 'sample_count': len(sample), 'columns': {}}
    for key in columns:
        values = sorted(row[key] for row in sample)
        result['columns'][key] = {
            'mean': statistics.mean(values), 'median': statistics.median(values),
            'p95': values[max(0, math.ceil(len(values) * .95) - 1)],
            'min': values[0], 'max': values[-1],
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('captures', nargs='+', type=Path)
    parser.add_argument('--columns', nargs='+', default=['FrameTime', 'GPUTime', 'GameThreadTime'])
    parser.add_argument('--start', type=int, default=0, help='First numeric frame index, inclusive')
    parser.add_argument('--stop', type=int, help='Last numeric frame index, exclusive')
    parser.add_argument('--output', type=Path, help='JSON destination; otherwise stdout')
    args = parser.parse_args()
    if args.start < 0 or (args.stop is not None and args.stop <= args.start):
        parser.error('Require 0 <= start < stop')
    result = [summarize(p, args.columns, args.start, args.stop) for p in args.captures]
    text = json.dumps(result, indent=2) + '\n'
    if args.output:
        if args.output.resolve() in [p.resolve() for p in args.captures]:
            parser.error('Output must not overwrite a capture')
        args.output.write_text(text)
    else:
        print(text, end='')


if __name__ == '__main__':
    main()
