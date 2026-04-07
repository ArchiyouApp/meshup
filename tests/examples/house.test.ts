/**
 * tests/examples/house.test.ts
 *
 */
import { beforeAll, describe, it, expect, should } from 'vitest';
import { Collection, initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Sketch } from '../../src/Sketch';
import { save } from '../../src/utils';
import { rad } from '../../src/utils';

beforeAll(async () =>
{
    await initAsync();
});

describe('Example: House', () => 
{
    const WIDTH = 400;
    const HEIGHT = 300; // wall height
    const DEPTH = 500;
    const ROOF_ANGLE = 45;
    const ROOF_OVERHANG_FRONT = 50;
    const THICKNESS = 20;

    it('Build a simple house', () => 
    {
        const roofLinePoints = [
            [WIDTH/2, HEIGHT+Math.round(Math.tan(rad(ROOF_ANGLE)) * WIDTH/2)], [WIDTH,HEIGHT]];
        const frontFacade = new Sketch('xz')
                        .lineTo(0, HEIGHT)
                        .polyline(roofLinePoints)
                        .lineTo(WIDTH,0)
                        .close()
                        .extrude(THICKNESS);
        
        // TODO: add more tests

        const backFacade = frontFacade?.copy()?.move(0, DEPTH-THICKNESS, 0);

        const wallLeft = Mesh.BoxBetween([0,0,0], [THICKNESS, DEPTH-2*THICKNESS, HEIGHT])
                            .move(0, THICKNESS, 0);
        const wallRight = wallLeft.copy()!.move(WIDTH - THICKNESS, 0, 0);
        const roof = new Sketch('xz')
                        .moveTo(0, HEIGHT)
                        .polyline(roofLinePoints)
                        .extend(50, 'both')
                        .offsetted(THICKNESS)
                        .close()
                        .extrude(DEPTH+ROOF_OVERHANG_FRONT*2)
                        ?.move(0,-ROOF_OVERHANG_FRONT);
                        

        const door = Mesh.Box(100, 50, 200).move(WIDTH/2, 0, 200/2);
        frontFacade?.subtract(door);
        
        const house = new Collection(frontFacade!, backFacade!, wallLeft, wallRight, roof!);

        const gltf = house!.toGLTF();
        expect(house).toBeTruthy();
        save('house.gltf', gltf );
        
    });

});
