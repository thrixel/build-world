#!/usr/bin/env python3
"""Compare ue_scene_audit snapshots; additions and mesh swaps are reported separately."""
import argparse
import json
import math
from pathlib import Path


def close(left, right, tolerance):
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isclose(left, right, rel_tol=0, abs_tol=tolerance)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(close(a, b, tolerance) for a, b in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(close(left[k], right[k], tolerance) for k in left)
    return left == right


def compare(before, after, tolerance=1e-4):
    if before.get('schema') != 1 or after.get('schema') != 1:
        raise ValueError('Expected schema 1 snapshots from ue_scene_audit.py')
    if before['world'] != after['world']:
        raise ValueError('World paths differ; do not compare unrelated levels')
    old, new = before['actors'], after['actors']
    result = {'added': sorted(new.keys() - old.keys()), 'removed': sorted(old.keys() - new.keys()),
              'placement_changes': [], 'component_changes': [], 'mesh_swaps': []}
    for key in old.keys() & new.keys():
        a, b = old[key], new[key]
        if not close(a['transform'], b['transform'], tolerance):
            result['placement_changes'].append(key)
        ac, bc = a['components'], b['components']
        if ac.keys() != bc.keys():
            result['component_changes'].append({'actor': key, 'change': 'component names'})
        for name in ac.keys() & bc.keys():
            x, y = ac[name], bc[name]
            if x['mesh'] != y['mesh']:
                result['mesh_swaps'].append({'actor': key, 'component': name, 'before': x['mesh'], 'after': y['mesh']})
            for field in ['world_transform', 'count', 'overrides', 'instance_transform_hash']:
                if not close(x.get(field), y.get(field), tolerance):
                    result['component_changes'].append({'actor': key, 'component': name, 'change': field})
    result['preserved_existing_placements'] = not any(result[k] for k in ['removed', 'placement_changes', 'component_changes'])
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('before', type=Path)
    p.add_argument('after', type=Path)
    p.add_argument('--tolerance', type=float, default=1e-4, help='Absolute tolerance; positions are UE units')
    args = p.parse_args()
    if args.tolerance < 0:
        p.error('Tolerance must be nonnegative')
    result = compare(json.loads(args.before.read_text()), json.loads(args.after.read_text()), args.tolerance)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['preserved_existing_placements'] else 1)


if __name__ == '__main__':
    main()
