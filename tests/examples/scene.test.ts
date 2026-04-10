/**
 * tests/examples/basics.test.ts
 *
 * Integration-level tests that mirror typical library usage patterns.
 * These verify that common workflows produce sensible results end-to-end.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, Point } from '../../src/index';
import { Collection } from '../../src/Collection';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { Container } from '../../src/Container';
import { save } from '../../src/utils';
import { dashPatternToUint16 } from '../../src/GLTFExtensions';

beforeAll(async () =>
{
    await initAsync();
});

describe('glTF extension exports', () =>
{
    it('Mesh with stroke style emits EXT_mesh_primitive_edge_visibility and BENTLEY_materials_line_style', async () =>
    {
        const box = Mesh.Cube(10);
        box.style.strokeWidth = 3;
        box.style.strokeDash = [5, 2];

        const gltfStr = await box.toGLTF();
        expect(gltfStr).toBeTruthy();
        const gltf = JSON.parse(gltfStr!);

        // Both extensions must be declared
        expect(gltf.extensionsUsed).toContain('EXT_mesh_primitive_edge_visibility');
        expect(gltf.extensionsUsed).toContain('BENTLEY_materials_line_style');

        // Primitive must carry the edge-visibility extension with a valid accessor index
        const prim = gltf.meshes[0].primitives[0];
        const edgeVisExt = prim.extensions?.['EXT_mesh_primitive_edge_visibility'];
        expect(edgeVisExt).toBeDefined();
        expect(typeof edgeVisExt.visibility).toBe('number');
        expect(gltf.accessors[edgeVisExt.visibility]).toBeDefined();

        // Edge material must carry BENTLEY_materials_line_style with correct values
        const edgeMatIdx = edgeVisExt.material;
        expect(typeof edgeMatIdx).toBe('number');
        const edgeMat = gltf.materials[edgeMatIdx];
        const lineStyleExt = edgeMat?.extensions?.['BENTLEY_materials_line_style'];
        expect(lineStyleExt).toBeDefined();
        expect(lineStyleExt.width).toBe(3);
        expect(lineStyleExt.pattern).toBe(dashPatternToUint16([5, 2]));

        save('test.mesh.extensions.gltf', gltfStr!);
    });

    it('Curve with dash style emits BENTLEY_materials_line_style', async () =>
    {
        const line = Curve.Line([0,0,0], [10,0,0]);
        line.style.strokeWidth = 2;
        line.style.strokeDash = [4, 4];

        const gltfStr = await line.toGLTF();
        expect(gltfStr).toBeTruthy();
        const gltf = JSON.parse(gltfStr!);

        expect(gltf.extensionsUsed).toContain('BENTLEY_materials_line_style');

        const mat = gltf.materials[0];
        const ext = mat?.extensions?.['BENTLEY_materials_line_style'];
        expect(ext).toBeDefined();
        expect(ext.width).toBe(2);
        expect(ext.pattern).toBe(dashPatternToUint16([4, 4]));

        save('test.curve.extensions.gltf', gltfStr!);
    });
});

describe('Set up a basic scene hierarchy and export', () =>
{
    it('Create a scene hierarchy and export to GLTF', async () =>
    {
        const cyl = Mesh.Cylinder(5, 10).color('blue');
        const cubes = Mesh.Cube(10).replicate(4, (c,i) => c.move(i*15, 0, 0).color(255-i*50, 0, 0))
                        .moveTo(0,0,0)
                        .moveZ(20);
        const spheres = Mesh.Sphere(5).row(3, 10)
                            .color('yellow')
                            .moveTo(0,0,0)
                            .moveZ(35);

        const lines = Collection.generate(50, () => Curve.Line(Point.random(10), Point.random(10)))
                        .color('green')
                        .moveTo(0,0,0)
                        .moveZ(50);

        const scene = Container.root();
        scene.add(cyl); // on top level
        scene.addLayer('cubes', cubes); // in a layer
        scene.add('spheres').add(spheres); // same thing
        scene.addLayer('lines', lines); 
        
        const gltf = await scene.toGLTF();
        expect(gltf).toBeTruthy();
        save('test.scene.gltf', gltf);
    });
});
