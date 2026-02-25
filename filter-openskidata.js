const fs = require('fs');

const BBOX = [-110.92, 43.55, -110.80, 43.62];

function coordInBBox(coord) {
  const [lng, lat] = coord;
  return lng >= BBOX[0] && lng <= BBOX[2] && lat >= BBOX[1] && lat <= BBOX[3];
}

function featureInBBox(feature) {
  const geom = feature.geometry;
  if (!geom || !geom.coordinates) return false;
  
  function checkCoords(coords, type) {
    if (type === 'Point') return coordInBBox(coords);
    if (type === 'LineString') return coords.some(c => coordInBBox(c));
    if (type === 'MultiLineString' || type === 'Polygon') return coords.some(ring => ring.some(c => coordInBBox(c)));
    if (type === 'MultiPolygon') return coords.some(poly => poly.some(ring => ring.some(c => coordInBBox(c))));
    return false;
  }
  
  return checkCoords(geom.coordinates, geom.type);
}

function filterFile(inputPath, outputPath, label) {
  console.log(`Reading ${label}...`);
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const data = JSON.parse(raw);
  console.log(`Total features: ${data.features.length}`);
  
  const filtered = data.features.filter(featureInBBox);
  console.log(`Filtered to JH bbox: ${filtered.length} features`);
  
  // Show sample properties
  if (filtered.length > 0) {
    console.log(`\nSample properties (first feature):`);
    console.log(JSON.stringify(filtered[0].properties, null, 2));
  }
  
  const output = { type: 'FeatureCollection', features: filtered };
  fs.writeFileSync(outputPath, JSON.stringify(output));
  console.log(`Wrote ${outputPath}\n`);
}

filterFile('/tmp/openskidata-runs-full.geojson', 'data/jh-runs.geojson', 'runs');
filterFile('/tmp/openskidata-lifts-full.geojson', 'data/jh-lifts.geojson', 'lifts');
