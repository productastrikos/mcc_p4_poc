import React, { forwardRef, lazy, Suspense } from 'react';

/* Lazy entry points: three.js (about 150 kB gzipped) loads on first use. */
const load = () => import('./views');
const Thumb = lazy(() => load().then((m) => ({ default: m.TwinThumb })));
const Orbit = lazy(() => load().then((m) => ({ default: m.TwinOrbit })));
const Feed = lazy(() => load().then((m) => ({ default: m.CameraFeed })));

const Loading = ({ className = '' }) => <div className={`twin3d-loading ${className}`} />;

export function TwinThumb(props) {
  return <Suspense fallback={<Loading className={props.className} />}><Thumb {...props} /></Suspense>;
}

export const TwinOrbit = forwardRef(function TwinOrbitLazy(props, ref) {
  return <Suspense fallback={<Loading className={props.className} />}><Orbit ref={ref} {...props} /></Suspense>;
});

export const CameraFeed = forwardRef(function CameraFeedLazy(props, ref) {
  return <Suspense fallback={<Loading className={props.className} />}><Feed ref={ref} {...props} /></Suspense>;
});
