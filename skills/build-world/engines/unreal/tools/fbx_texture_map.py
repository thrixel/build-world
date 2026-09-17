#!/usr/bin/env python3
"""Read binary FBX diffuse texture connections without importing geometry or Unreal."""
import argparse
import json
import re
import struct
from pathlib import Path


def normalize_name(name):
    """Match FBX/material names despite import punctuation substitutions."""
    return re.sub(r'[^\w]', '_', name)


def texture_map(path):
    data = Path(path).read_bytes()
    if not data.startswith(b'Kaydara FBX Binary  \x00\x1a\x00') or len(data) < 27:
        raise ValueError('Expected binary FBX, not ASCII FBX or a conversion-status stub')
    version = struct.unpack_from('<I', data, 23)[0]
    header_format = '<QQQB' if version >= 7500 else '<IIIB'
    header_size = struct.calcsize(header_format)

    def node(position, depth=0):
        if depth > 256:
            raise ValueError('FBX node depth exceeds parser limit')
        end, count, size, name_length = struct.unpack_from(header_format, data, position)
        if not end:
            return None, position + header_size
        if end <= position + header_size or end > len(data):
            raise ValueError('Invalid FBX node extent')
        position += header_size
        name = data[position:position + name_length].decode()
        position += name_length
        property_end = position + size
        if property_end > end:
            raise ValueError('FBX properties exceed node extent')
        properties = []
        scalar_formats = {'Y': 'h', 'C': '?', 'I': 'i', 'F': 'f', 'D': 'd', 'L': 'q'}
        for _ in range(count):
            kind = chr(data[position])
            position += 1
            if kind in scalar_formats:
                fmt = scalar_formats[kind]
                value = struct.unpack_from('<' + fmt, data, position)[0]
                position += struct.calcsize(fmt)
            elif kind in ('S', 'R'):
                length = struct.unpack_from('<I', data, position)[0]
                position += 4
                # Raw blobs (embedded textures) are irrelevant to the connection map.
                value = data[position:position + length].decode(errors='replace') if kind == 'S' else None
                position += length
            elif kind in 'fdlibc':
                _length, _encoding, compressed_bytes = struct.unpack_from('<III', data, position)
                position += 12 + compressed_bytes  # Skip geometry arrays, compressed or raw.
                value = None
            else:
                raise ValueError('Unsupported FBX property type: ' + kind)
            if position > property_end:
                raise ValueError('Invalid FBX property size')
            properties.append(value)
        if position != property_end:
            raise ValueError('FBX property count/size mismatch')
        children = []
        while position < end - header_size:
            child, position = node(position, depth + 1)
            if child:
                children.append(child)
        return (name, properties, children), end

    roots = []
    position = 27
    while position < len(data) - header_size:
        item, position = node(position)
        if not item:
            break
        roots.append(item)
    sections = {name: children for name, _, children in roots}
    if 'Objects' not in sections or 'Connections' not in sections:
        raise ValueError('FBX has no Objects/Connections sections')
    materials = {}
    textures = {}
    for name, properties, children in sections['Objects']:
        if name == 'Material':
            materials[properties[0]] = properties[1].split('\x00')[0].removeprefix('Material::')
        elif name == 'Texture':
            textures[properties[0]] = next(
                (values[0] for key, values, _ in children if key == 'RelativeFilename'), '')
    result = {}
    for _, values, _ in sections['Connections']:
        if (len(values) > 3 and values[1] in textures and values[2] in materials
                and values[3] in ('DiffuseColor', 'BaseColor')):
            material = normalize_name(materials[values[2]])
            filename = Path(textures[values[1]].replace('\\', '/')).name
            if not filename:
                raise ValueError('Diffuse texture has no relative filename: ' + material)
            if material in result and result[material] != filename:
                raise ValueError('Ambiguous diffuse texture for ' + material)
            result[material] = filename
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fbx', type=Path)
    args = parser.parse_args()
    print(json.dumps(texture_map(args.fbx), indent=2))
