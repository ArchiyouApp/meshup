/**
 * The shape of what {@link Importer.rawDXF} returns.
 *
 * Mirrors `rust/src/io/dxf_entities.rs`; the two must be changed together. Kept as plain data
 * with no classes so it survives `structuredClone` and can be handed straight across a worker
 * boundary.
 *
 * Coordinates are DXF's own: **Y-up**, in the file's units. Nothing is converted here.
 */

/** `$INSUNITS`: 0 unitless, 1 in, 2 ft, 4 mm, 5 cm, 6 m — the values that actually appear. */
export interface DxfHeaderData
{
    units: number;
    ltscale: number;
    ext_min: [number, number, number];
    ext_max: [number, number, number];
}

export interface DxfLayerData
{
    name: string;
    /** AutoCAD Color Index. */
    color: number;
    on: boolean;
    line_type: string;
    /** 1/100 mm; negative values are the BYLAYER/BYBLOCK/DEFAULT sentinels. */
    line_weight: number;
}

export interface DxfVertexData
{
    x: number;
    y: number;
    /** The tangent of a quarter of the arc's included angle. 0 means the next segment is straight. */
    bulge: number;
}

export type DxfEntityData = DxfCommon & DxfKindData;

interface DxfCommon
{
    layer: string;
    /** 256 = BYLAYER, 0 = BYBLOCK — neither is a colour. */
    color: number;
    line_type: string;
    line_weight: number;
    visible: boolean;
    /** OCS extrusion. `(0,0,-1)` mirrors the entity in X. */
    extrusion: [number, number, number];
}

export type DxfKindData =
  | { type: 'Point'; at: [number, number, number] }
  | { type: 'Line'; a: [number, number, number]; b: [number, number, number] }
  | { type: 'Arc'; center: [number, number, number]; radius: number; start: number; end: number }
  | { type: 'Circle'; center: [number, number, number]; radius: number }
  | {
      type: 'Ellipse';
      center: [number, number, number];
      /** Major-axis endpoint RELATIVE to the centre. */
      major: [number, number, number];
      ratio: number;
      /** Radians. A closed ellipse spans 0..2π. */
      start: number; end: number;
    }
  | { type: 'Polyline'; vertices: DxfVertexData[]; closed: boolean }
  | {
      type: 'Spline';
      degree: number;
      control_points: Array<[number, number, number]>;
      fit_points: Array<[number, number, number]>;
      knots: number[];
      weights: number[];
      closed: boolean;
    }
  | {
      type: 'Insert';
      name: string;
      at: [number, number, number];
      scale: [number, number, number];
      /** Degrees. */
      rotation: number;
      columns: number; rows: number;
      column_spacing: number; row_spacing: number;
    }
  | { type: 'Text'; at: [number, number, number]; value: string; height: number; rotation: number }
  | { type: 'Other'; name: string };

export interface DxfBlockData
{
    name: string;
    base: [number, number, number];
    entities: DxfEntityData[];
}

export interface DxfDoc
{
    header: DxfHeaderData;
    layers: DxfLayerData[];
    blocks: DxfBlockData[];
    /** Model-space entities. `INSERT`s are unexpanded references. */
    entities: DxfEntityData[];
}
