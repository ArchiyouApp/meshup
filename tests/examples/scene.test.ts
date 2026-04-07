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

beforeAll(async () =>
{
    await initAsync();
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

        const lines = Collection.generate(10, () => Curve.Line(Point.random(10), Point.random(10)))
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
