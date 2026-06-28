// Public API for the GTA San Andreas text map parsers (DAT / IDE / IPL).
export { parseCarcols, type VehicleColours } from './carcols.parser';
export { type CarGroup, parseCarGroups } from './cargrp.parser';
export { type Carmods, parseCarmods } from './carmods.parser';
export { type FxEmitter, type FxKeyframe, type FxSystem, parseFxp, sampleFxTrack } from './fxp.parser';
export { parseGtaDat } from './gta-dat.parser';
export { type HandlingEntry, parseHandling } from './handling.parser';
export { hasIdeFlag, IdeFlag } from './ide-flags';
export { parseIde, parseTimedObjects, parseTxdParents } from './ide.parser';
export { interiorId, isInterior } from './interior';
export { parseBinaryIpl } from './ipl-binary.parser';
export { parseIpl } from './ipl.parser';
export { isLodModel } from './lod';
export { ColDamageEffect, type ObjectDatEntry, parseObjectDat } from './object-dat.parser';
export { parsePedDefs, type PedDef } from './ped-defs.parser';
export { parseProcObj, type ProcObjRule } from './procobj.parser';
export { parseSurfaceNames } from './surfinfo.parser';
export {
  buildTimecyc,
  type Rgb,
  type Rgba,
  sampleTimecyc,
  sampleTimecycBlend,
  type Timecyc,
  type TimecycHour,
  type TimecycWeather,
} from './timecyc';
export { convertTo24h, parseTimecyc, WEATHER_NAMES } from './timecyc.parser';
export * from './types';
export { parseVehicleDefs, type VehicleDef } from './vehicle-defs.parser';
export { parseWater, type WaterQuad } from './water.parser';
export { type MapZone, parseZones } from './zon.parser';
