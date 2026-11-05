/**
 *  tests/helpers/segments.ts
 *
 *  The line work of a projection counted in straight segments, not in Curves: a projection
 *  joins the edges that meet end to end into one polyline (see Mesh._joinPolylines), so the
 *  four sides of a box are one Curve. Tests that count edges count these.
 */

type XY = [number, number];

/** Whether `p` lies on the straight way from `a` to `b` */
function onLine(a: XY, p: XY, b: XY): boolean
{
    const [ux, uy] = [p[0] - a[0], p[1] - a[1]];
    const [vx, vy] = [b[0] - p[0], b[1] - p[1]];
    const cross = ux * vy - uy * vx;
    return Math.abs(cross) <= 1e-6 * Math.hypot(ux, uy) * Math.hypot(vx, vy) && (ux * vx + uy * vy) > 0;
}

/** Every straight segment of the Curves in a collection (or of one Curve), as two points */
export function segments(col: any): Array<[XY, XY]>
{
    const curves: any[] = col?.toArray?.() ?? (col ? [col] : []);
    return curves.flatMap(c =>
    {
        const pts: any[] = c.controlPoints?.() ?? c.points?.() ?? [];
        // a closed Curve does not repeat its first point: its last segment goes back to it
        const ring: XY[] = ((c.isClosed?.() && pts.length > 2) ? [...pts, pts[0]] : pts).map((p: any) => [p.x, p.y]);
        // an edge is straight from corner to corner: points on the way (a sampled edge) are no corners
        const corners = ring.filter((p, i) => i === 0 || i === ring.length - 1 || !onLine(ring[i - 1], p, ring[i + 1]));
        return corners.slice(1).map((p, i) => [corners[i], p] as [XY, XY]);
    });
}

/** How many straight segments; 0 for nothing */
export function segmentCount(col: any): number
{
    return segments(col).length;
}

/** The lengths of the segments, rounded and sorted */
export function segmentLengths(col: any): number[]
{
    return segments(col)
        .map(([a, b]) => +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(6))
        .sort((x, y) => x - y);
}

/** The segments as one text, direction and order left out: two projections draw the same lines when equal */
export function segmentsText(col: any): string
{
    const n = (v: number) => (Math.round(v * 1e6) / 1e6 + 0).toFixed(6); // + 0: no '-0'
    const f = (p: XY) => `${n(p[0])},${n(p[1])}`;
    return segments(col).map(([a, b]) => [f(a), f(b)].sort().join(' ')).sort().join('|');
}
