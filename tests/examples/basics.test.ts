/**
 * tests/examples/basics.test.ts
 *
 * Integration-level tests that mirror typical library usage patterns.
 * These verify that common workflows produce sensible results end-to-end.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { Sketch } from '../../src/Sketch';
import { Vector } from '../../src/Vector';
import { Collection } from '../../src/Collection';

beforeAll(async () => {
    await initAsync();
});

describe('Example: primitive meshes', () => {
    it('builds a cube and checks it has geometry', () => {
        const cube = Mesh.Cube(10);
        expect(cube.positions().length).toBeGreaterThan(0);
        expect(cube.polygons().length).toBeGreaterThan(0);
    });

    it('builds a sphere and checks it has more faces than a cube', () => {
        const sphere = Mesh.Sphere(5);
        const cube = Mesh.Cube(10);
        expect(sphere.polygons().length).toBeGreaterThan(
            cube.polygons().length
        );
    });
});

describe('Example: boolean modeling workflow', () => {
    it('punches a hole by subtracting a smaller cube', () => {
        const box = Mesh.Cuboid(20, 20, 20);
        const hole = Mesh.Cube(8);
        box.difference(hole);
        expect(box.positions().length).toBeGreaterThan(0);
    });
});

describe('Example: sketch-to-solid workflow', () => {
    it('draws a closed rectangle and extrudes it', () => {
        const mesh = new Sketch()
            .moveTo(0, 0)
            .lineTo(30, 0)
            .lineTo(30, 20)
            .lineTo(0, 20)
            .close()
            .extrude(10);

        console.log('==== MESH ====');
        console.log(mesh);


        expect(mesh).toBeTruthy();
        expect((mesh as Mesh).polygons().length).toBeGreaterThan(0);
    });
});

describe('Example: curve operations', () => {
    it('creates a 3D polyline and measures its length', () => {
        const c = Curve.Polyline([[0,0,0], [10,0,0], [10,10,0], [10,10,10]]);
        // Total path length: 10 + 10 + 10 = 30
        expect(c.length()).toBeCloseTo(30, 0);
    });

    it('samples points on a circle curve', () => {
        const circle = Curve.Circle(5);
        const pts = circle.tessellate();
        expect(pts.length).toBeGreaterThan(4);
        // All points should be approximately 5 units from the origin
        pts.forEach(p => {
            const r = Math.sqrt(p.x * p.x + p.y * p.y);
            expect(r).toBeCloseTo(5, 0);
        });
    });
});

describe('Example: vector math', () => {
    it('normalizes a vector and checks it is unit length', () => {
        const v = new Vector(3, 4, 0).normalize();
        expect(v.length()).toBeCloseTo(1);
    });

    it('computes dot product of known vectors', () => {
        const a = new Vector(1, 0, 0);
        const b = new Vector(0, 0, 1);
        expect(a.dot(b.toVector3Js())).toBeCloseTo(0); // perpendicular
    });
});

describe('Example: collection workflow', () => {
    it('collects two meshes and iterates over them', () => {
        const a = Mesh.Cube(5);
        const b = Mesh.Cube(5);
        b.translate([10, 0, 0]);

        const col = new Collection(a, b);
        expect(col.count()).toBe(2);

        let totalVertices = 0;
        col.shapes().forEach(s => {
            totalVertices += (s as Mesh).positions().length;
        });
        expect(totalVertices).toBeGreaterThan(0);
    });
});
