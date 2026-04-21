
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, ShapeCollection } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Sketch } from '../../src/Sketch';
import { save } from '../../src/utils';

beforeAll(async () =>
{
    await initAsync();
});

describe('Sketch', () =>
{
    it('should create basic curves on XY', () =>
    {
        const pline = new Sketch()
                            .moveTo(0,0)
                            .lineTo(10,0)
                            .lineTo(10,10)
                            .lineTo(0,10)
                            .end();

        
        expect(pline.curves().length).toBe(1); // auto merged into one
        expect(pline.curves().first()).toBeInstanceOf(Curve);
        expect(pline.curves().first().length()).toBeCloseTo(30);
        expect(pline.curves().first().isClosed()).toBe(false);
        expect(pline.first().close().length()).toBeCloseTo(40); // close last segment
    });

    
    it('make lines with polar coordinates', async () =>
    {
        const plortho = new Sketch('front')
                        .lineTo('100<0')
                        .lineTo('100<90')
                        .end().first().color('red');
            
        expect(plortho).toBeInstanceOf(Curve);
        expect(plortho.length()).toBeCloseTo(200);
        expect(plortho.normal().angle([0,-1,0])).toBeCloseTo(0);


        const pl = new Sketch('top')
                    .lineTo('100<45')
                    .lineTo('100<<90')
                    .end().first().color('blue');
        
        expect(pl).toBeInstanceOf(Curve);
        expect(pl.length()).toBeCloseTo(200);

        const pl2 = new Sketch('top')
                        .lineTo('100<-10')
                        .lineTo('100<10')
                        .end().first().color('green');

        // Side: like a chair seat line
        const pl3 = new Sketch('right')
                        .moveTo(0,100)
                        .lineTo('100<-3')
                        .lineTo(`100<<${90-18}`)
                        .end().first().color('orange');

        expect(pl3.normal().angle([1,0,0])).toBeCloseTo(0);
        expect(pl3.length()).toBeCloseTo(200);

        await save('test.sketch.polar.gltf', await new ShapeCollection<Curve>(plortho, pl, pl2, pl3).toGLTF());
    });
    
});