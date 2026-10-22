import { outfallBlocking } from '../utils';

/*
 * Turning app data into the state a 3D view shows. No three.js here, so pages
 * can build states without loading the 3D bundle.
 */

/** Sensor-clock hour as a decimal; `live` adds the wall-clock minutes so light changes smoothly. */
export function hourOf(simTime, live = false) {
  if (!simTime) return 12;
  const h = parseInt(simTime.slice(11, 13), 10) || 0;
  return live ? h + new Date().getUTCMinutes() / 60 : h + 0.5;
}

/** State from a digital-twin frame (recorded, now or projected). */
export function frameState(frame) {
  return {
    rain: frame.rain, drain: frame.drain, depth: frame.depth, tide: frame.tide,
    block: frame.block, pumps: frame.pumps, roadsClosed: frame.roadsClosed,
    hour: hourOf(frame.time, frame.kind === 'now'),
  };
}

/** State from a live hotspot (the /api/live snapshot). */
export function liveState(h, simTime) {
  const s = h.sensors;
  return {
    rain: s.rain_mmhr, drain: s.drain_pct, depth: s.water_depth_cm, tide: s.tide_m,
    block: outfallBlocking(h, s.tide_m, s.river_m),
    pumps: h.response?.pumps?.length || 0, roadsClosed: !!h.response?.roads_closed,
    hour: hourOf(simTime, true),
  };
}

/** Test conditions for the camera, for demonstrating the vision check. */
export const TEST_CONDITIONS = {
  normal: { label: 'Normal', state: { rain: 0, drain: 30, depth: 0 } },
  rising: { label: 'Rising', state: { rain: 22, drain: 92, depth: 0 } },
  overflowing: { label: 'Overflowing', state: { rain: 35, drain: 100, depth: 5 } },
  flooded: { label: 'Road flooded', state: { rain: 30, drain: 100, depth: 24 } },
};

/**
 * Burned-in camera text. The date and hour come from the sensor clock; the
 * minutes and seconds tick with the wall clock (MYT is a whole-hour offset).
 */
export function cameraInfo(site, simTime, { source = 'live', banner } = {}) {
  return () => {
    const now = new Date();
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    const ss = String(now.getUTCSeconds()).padStart(2, '0');
    const date = simTime ? simTime.slice(0, 10) : '';
    const hh = simTime ? simTime.slice(11, 13) : '00';
    return {
      camera: site.cctv,
      place: (site.roads?.[0] || site.name).toUpperCase(),
      clock: `${date} ${hh}:${mm}:${ss} MYT`,
      sub: source === 'live' ? site.name.toUpperCase() : `${site.name.toUpperCase()} · EXERCISE`,
      banner,
    };
  };
}
