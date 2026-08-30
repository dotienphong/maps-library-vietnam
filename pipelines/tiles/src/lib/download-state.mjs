/**
 * @param {{ pbfExists: boolean, actualMd5: string | undefined, expectedMd5: string }} state
 */
export function needsOsmDownload(state) {
  return !state.pbfExists || state.actualMd5 !== state.expectedMd5;
}

export function planetilerDownloadArgs() {
  return ['--osm-path=data/sources/vietnam.osm.pbf', '--only-download'];
}
