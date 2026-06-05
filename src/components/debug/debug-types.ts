// TEMPORARY debug overlay vocabulary. Remove with the rest of components/debug.

/** How much to load + where to look: the whole map, or just the Ganton district. */
export type CameraTarget = 'full-map' | 'ganton';

/** What geometry to draw: the real map (LODs excluded) or only the LOD stand-ins. */
export type GeometryMode = 'lods' | 'map';
