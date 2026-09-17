"""Read-only UE editor audit. Import and call audit(output_path, instance_hashes=False).

Audits the currently loaded editor world; never loads, saves, or changes a level.
Triangle counts are LOD0 render data, potentially Nanite fallback, NOT per-frame cost.
"""
import hashlib
import json
from pathlib import Path


def transform(value):
    return {
        'position': [value.translation.x, value.translation.y, value.translation.z],
        'rotation_quaternion': [value.rotation.x, value.rotation.y, value.rotation.z, value.rotation.w],
        'scale': [value.scale3d.x, value.scale3d.y, value.scale3d.z],
    }


def audit(output_path, instance_hashes=False):
    import unreal as u
    world = u.get_editor_subsystem(u.UnrealEditorSubsystem).get_editor_world()
    if not world:
        raise RuntimeError('No editor world loaded')
    if u.get_editor_subsystem(u.UnrealEditorSubsystem).get_game_world():
        raise RuntimeError('Stop PIE before auditing the authored editor world')
    result = {'schema': 1, 'world': world.get_path_name(), 'actors': {}, 'meshes': {},
              'dirty_maps': [p.get_name() for p in u.EditorLoadingAndSavingUtils.get_dirty_map_packages()],
              'dirty_content': [p.get_name() for p in u.EditorLoadingAndSavingUtils.get_dirty_content_packages()]}
    subsystem = u.get_editor_subsystem(u.EditorActorSubsystem)
    for actor in subsystem.get_all_level_actors():
        row = {'label': actor.get_actor_label(), 'class': actor.get_class().get_path_name(),
               'transform': transform(actor.get_actor_transform()), 'components': {}}
        result['actors'][actor.get_path_name()] = row
        for component in actor.get_components_by_class(u.StaticMeshComponent):
            mesh = component.static_mesh
            if not mesh:
                continue
            instanced = isinstance(component, u.InstancedStaticMeshComponent)
            count = component.get_instance_count() if instanced else 1
            item = {'mesh': mesh.get_path_name(), 'world_transform': transform(component.get_world_transform()),
                    'count': count, 'cast_shadow': component.get_editor_property('cast_shadow'),
                    'desired_max_draw_distance': component.get_editor_property('ld_max_draw_distance'),
                    'overrides': [m.get_path_name() if m else None for m in component.get_editor_property('override_materials')]}
            if instanced and instance_hashes:
                digest = hashlib.sha256()
                for index in range(count):
                    value = component.get_instance_transform(index, world_space=False)
                    digest.update(json.dumps(transform(value), sort_keys=True).encode())
                item['instance_transform_hash'] = digest.hexdigest()
            row['components'][component.get_name()] = item
            key = mesh.get_path_name()
            if key not in result['meshes']:
                bounds = mesh.get_bounds()
                result['meshes'][key] = {
                    'lod0_render_triangles': mesh.get_num_triangles(0),
                    'nanite': mesh.get_editor_property('nanite_settings').enabled,
                    'bounds_origin': [bounds.origin.x, bounds.origin.y, bounds.origin.z],
                    'bounds_extent': [bounds.box_extent.x, bounds.box_extent.y, bounds.box_extent.z],
                    'material_slots': [s.material_interface.get_path_name() if s.material_interface else None for s in mesh.static_materials],
                    'instances': 0,
                }
            result['meshes'][key]['instances'] += count
        if isinstance(actor, u.Light):
            row['light'] = {'cast_shadows': actor.light_component.cast_shadows}
    Path(output_path).write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    u.log(f'Scene audit saved: {output_path} ({len(result["actors"])} actors)')
    return result
