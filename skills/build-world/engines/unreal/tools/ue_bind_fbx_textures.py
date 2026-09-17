"""Bind extracted FBX diffuse PNGs in a fresh UE import folder. Dry run by default.

Not a general material repair tool: apply=True replaces the selected imported
base-material graphs with BaseColor + constant roughness. Do not use on authored
materials. Inspect the source maps first; FBX can itself contain wrong bindings.
"""
from pathlib import Path
from fbx_texture_map import texture_map, normalize_name


def bind(fbx_path, asset_folder, apply=False, roughness=.8, nanite=False, instanced=False, texture_dir=None):
    import unreal as u
    if not 0 <= roughness <= 1:
        raise ValueError('Roughness must be between 0 and 1')
    folder = asset_folder.rstrip('/')
    if not folder.startswith('/Game/'):
        raise ValueError('Choose a dedicated imported-asset folder under /Game/')
    source = Path(fbx_path)
    mapping = texture_map(source)
    extracted = Path(texture_dir) if texture_dir is not None else source.with_suffix('.fbm')
    materials = {}
    for path in u.EditorAssetLibrary.list_assets(folder, recursive=False):
        asset = u.load_asset(path)
        if isinstance(asset, u.StaticMesh):
            for slot in asset.static_materials:
                mat = slot.material_interface
                if not mat or not mat.get_path_name().startswith(folder + '/'):
                    continue  # Never rewrite a shared material outside this import folder.
                if isinstance(mat, u.Material):
                    materials[mat.get_path_name()] = mat
                else:
                    raise ValueError('Material instance needs manual handling: ' + mat.get_path_name())
    if not materials:
        raise ValueError('No mesh-owned base materials found in ' + folder)
    plan = []
    for path, mat in sorted(materials.items()):
        filename = mapping.get(normalize_name(mat.get_name()))
        if not filename:
            raise ValueError('No diffuse FBX connection for ' + path)
        image_file = extracted / filename
        if not image_file.is_file():
            raise FileNotFoundError(image_file)
        plan.append({'material': path, 'source': str(image_file),
                     'texture': folder + '/T_' + normalize_name(mat.get_name())})
    if not apply:
        return {'applied': False, 'bindings': plan}
    # Validate all mappings/files before the first material mutation. Texture imports
    # are reversible; finish checking texture types before replacing any graph.
    textures = {}
    for item in plan:
        texture = u.load_asset(item['texture']) if u.EditorAssetLibrary.does_asset_exist(item['texture']) else None
        if texture is None:
            task = u.AssetImportTask()
            task.filename = item['source']
            task.destination_path = folder
            task.destination_name = item['texture'].rsplit('/', 1)[-1]
            task.automated = True
            task.save = True
            u.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
            texture = u.load_asset(item['texture'])
        if not isinstance(texture, u.Texture2D):
            raise ValueError('Texture import failed: ' + item['source'])
        if texture.get_editor_property('compression_settings') == u.TextureCompressionSettings.TC_NORMALMAP:
            raise ValueError('Diffuse connection points to a normal map; inspect/fix source: ' + item['source'])
        textures[item['material']] = texture
    edit = u.MaterialEditingLibrary
    for item in plan:
        mat = materials[item['material']]
        edit.delete_all_material_expressions(mat)
        sample = edit.create_material_expression(mat, u.MaterialExpressionTextureSample, -300, 0)
        sample.set_editor_property('texture', textures[item['material']])
        assert edit.connect_material_property(sample, 'RGB', u.MaterialProperty.MP_BASE_COLOR)
        value = edit.create_material_expression(mat, u.MaterialExpressionConstant, -300, 140)
        value.set_editor_property('r', roughness)
        assert edit.connect_material_property(value, '', u.MaterialProperty.MP_ROUGHNESS)
        if nanite:
            edit.set_base_material_usage(mat, u.MaterialUsage.MATUSAGE_NANITE, True)
        if instanced:
            edit.set_base_material_usage(mat, u.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES, True)
        edit.recompile_material(mat)
        assert u.EditorAssetLibrary.save_loaded_asset(mat, only_if_is_dirty=False)
    return {'applied': True, 'bindings': plan}
