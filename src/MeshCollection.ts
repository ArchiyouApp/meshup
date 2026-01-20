/**
 *  MeshCollection.ts
 *      a collection of multiple Mesh instances
 *      Provides methods to manage, order and query the collection
 */

import { Mesh } from "./Mesh";

export class MeshCollection
{
    private _meshes:Array<Mesh>;

    constructor(...args: Array<Mesh>)
    {
        const inMeshes:Array<Mesh> = [];
        Array.from(args).forEach((inMesh) => 
        {
            const flat = Array.isArray(inMesh) ? inMesh : [inMesh];

            flat.forEach((mesh,i) => 
            {
                if(mesh instanceof Mesh) {
                    inMeshes.push(mesh);
                }
                else {
                    console.warn(`MeshCollection::constructor(): Invalid mesh at index ${i}. Supply something [<Mesh>]`);
                }
            });
        });
        this._meshes = inMeshes;
    }

    add(mesh: Mesh): void
    {
        if(!(mesh instanceof Mesh))
        {
            console.error(`MeshCollection::add(): Invalid mesh. Supply something [<Mesh>]`);
            return;
        }
        this._meshes.push(mesh);
    }

    remove(mesh: Mesh): void
    {
        this._meshes = this._meshes.filter(m => m !== mesh);
    }

    get(index: number): Mesh | undefined
    {
        return this._meshes[index];
    }

    meshes(): Array<Mesh>
    {
        return this._meshes;
    }

    //// ITERATOR METHODS ////

    forEach(callback: (mesh: Mesh, index: number, array: Mesh[]) => void): void
    {
        this._meshes.forEach(callback);
    }

    filter(callback: (mesh: Mesh, index: number, array: Mesh[]) => boolean): MeshCollection
    {
        const filtered = this._meshes.filter(callback);
        return new MeshCollection(...filtered);
    }

    reduce(callback: (acc: Mesh, mesh: Mesh) => Mesh, initialValue: Mesh): Mesh
    {
        return this._meshes.reduce(callback, initialValue);
    }

    //// BOOLEAN OPERATIONS ////

    /** Union all meshes in collection and any other collection */
    union(other?: Mesh|MeshCollection): Mesh
    {
        const otherMeshes = (other instanceof MeshCollection) 
            ? other.meshes() 
            : (other instanceof Mesh)
                ? [other]
                : [];

        const combined = new MeshCollection(...this._meshes, ...(otherMeshes || []));
        // NOTE: one can start with empty Mesh, union just merges others meshes with it
        return combined.reduce((acc, mesh) => acc.union(mesh), new Mesh()); 
    }

    /** Subtract all meshes in the other collection from this collection */
    subtract(other: Mesh|MeshCollection): this
    {
        const otherMeshes = (other instanceof MeshCollection) 
            ? other.meshes() 
            : (other instanceof Mesh)
                ? [other]
                : [];

        if(otherMeshes.length === 0)
        {
            console.warn(`MeshCollection::subtract(): No valid meshes to subtract. Returning original collection.`);
            return this;
        }

        this.forEach( mesh => {
            otherMeshes.forEach(otherMesh => {
                mesh.subtract(otherMesh);
            });
        });

        return this;
    }

    //// EXPORT ////

    /** Export MeshCollection to GLTF format
     *  IMPORTANT: We currently flatten the entire mesh into one big one
     *  TODO: Export as different objects (maybe in Node hiearchy later)
     */
    toGLTF(): undefined|string
    {
        return this.union()?.toGLTF();
    }
}