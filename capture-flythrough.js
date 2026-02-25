#!/usr/bin/env node
/**
 * Frame-by-frame Mapbox flythrough capture using Playwright + ffmpeg.
 * Optimized for practical capture times.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FRAME_DIR = '/tmp/flythrough-frames';
const FPS = 24;
const DURATION = 12; // seconds
const TOTAL_FRAMES = FPS * DURATION; // 288 frames
const WIDTH = 1280;
const HEIGHT = 720;

const TOKEN_A = 'pk.eyJ1IjoicXR5cmVlIiwiYSI6ImNtaH';
const TOKEN_B = 'l5eHNmeDBoY3oybXEwNTIxNGgxYmsifQ.VqoAKKHQxQX-lNNPwVKHmw';

const KEYFRAMES = [
  { t: 0, center: [-110.76963, 43.73576], zoom: 12.85, pitch: 74.5, bearing: -111.2 },
  { t: 0.3, center: [-110.83825, 43.60253], zoom: 12.95, pitch: 76, bearing: -133.6 },
  { t: 0.5, center: [-110.83247, 43.59941], zoom: 13.76, pitch: 85, bearing: -66.4 },
  { t: 1, center: [-110.8339, 43.59484], zoom: 15.26, pitch: 84, bearing: -40 }
];

function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { return t * t * (3 - 2 * t); }

function interpolateAt(t) {
  let a = KEYFRAMES[0], b = KEYFRAMES[KEYFRAMES.length - 1];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (t >= KEYFRAMES[i].t && t <= KEYFRAMES[i + 1].t) {
      a = KEYFRAMES[i]; b = KEYFRAMES[i + 1]; break;
    }
  }
  const segLen = b.t - a.t;
  const segT = segLen > 0 ? (t - a.t) / segLen : 0;
  const eased = smoothstep(segT);
  return {
    center: [lerp(a.center[0], b.center[0], eased), lerp(a.center[1], b.center[1], eased)],
    zoom: lerp(a.zoom, b.zoom, eased),
    pitch: lerp(a.pitch, b.pitch, eased),
    bearing: lerp(a.bearing, b.bearing, eased)
  };
}

const HTML = `<!DOCTYPE html><html><head>
<script src="https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.js"></script>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css" rel="stylesheet">
<style>*{margin:0;padding:0}#map{width:${WIDTH}px;height:${HEIGHT}px}</style>
</head><body><div id="map"></div><script>
mapboxgl.accessToken='${TOKEN_A}${TOKEN_B}';
const map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/satellite-streets-v12',
center:[-110.76963,43.73576],zoom:12.85,pitch:74.5,bearing:-111.2,
preserveDrawingBuffer:true,antialias:true});
map.on('load',()=>{
map.addSource('mapbox-dem',{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512});
map.setTerrain({source:'mapbox-dem',exaggeration:1.5});
const layers=map.getStyle().layers;
const ll=layers.find(l=>l.type==='symbol'&&l.layout['text-field']);
if(ll)map.addLayer({id:'3d-buildings',source:'composite','source-layer':'building',
filter:['==','extrude','true'],type:'fill-extrusion',minzoom:13,
paint:{'fill-extrusion-color':'#aaa','fill-extrusion-height':['get','height'],
'fill-extrusion-base':['get','min_height'],'fill-extrusion-opacity':0.6}},ll.id);
map.once('idle',()=>{window._mapReady=true;});
});
window.setCam=function(c){
  map.jumpTo({center:c.center,zoom:c.zoom,pitch:c.pitch,bearing:c.bearing});
};
window.waitIdle=function(){return new Promise(r=>{
  if(map.loaded()&&!map.isMoving()&&!map.isZooming()){
    map.once('idle',()=>r(true));
    // Timeout fallback
    setTimeout(()=>r(false),3000);
  } else {
    map.once('idle',()=>r(true));
    setTimeout(()=>r(false),3000);
  }
});};
</script></body></html>`;

(async () => {
  if (fs.existsSync(FRAME_DIR)) fs.rmSync(FRAME_DIR, { recursive: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });

  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--use-gl=angle', '--use-angle=metal']
  });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.setContent(HTML);
  
  console.log('Waiting for map to load...');
  await page.waitForFunction(() => window._mapReady === true, { timeout: 60000 });
  
  // Let initial tiles fully render
  console.log('Warming up tiles...');
  await page.waitForTimeout(5000);

  console.log(`Capturing ${TOTAL_FRAMES} frames...`);
  const startTime = Date.now();

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const t = i / (TOTAL_FRAMES - 1);
    const cam = interpolateAt(t);
    await page.evaluate(c => window.setCam(c), cam);
    
    // Wait for tiles - short timeout for smooth capture
    // First frame and every 24th frame (1/sec): wait for idle
    // Others: just wait 100ms
    if (i === 0 || i % 24 === 0) {
      await page.evaluate(() => window.waitIdle());
    } else {
      await page.waitForTimeout(100);
    }
    
    const frameNum = String(i).padStart(4, '0');
    await page.screenshot({ path: path.join(FRAME_DIR, `frame-${frameNum}.png`), type: 'png' });
    
    if (i % 48 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = i > 0 ? (i / elapsed * 1).toFixed(1) : '?';
      console.log(`Frame ${i}/${TOTAL_FRAMES} (${(t*100).toFixed(1)}%) - ${elapsed}s elapsed, ${rate} fps`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`All ${TOTAL_FRAMES} frames captured in ${totalTime}s. Closing browser...`);
  await browser.close();

  // Stitch with ffmpeg
  const outPath = path.join(__dirname, 'images', 'flythrough.mp4');
  const { execSync } = require('child_process');
  console.log('Stitching with ffmpeg...');
  execSync(`ffmpeg -y -framerate ${FPS} -i ${FRAME_DIR}/frame-%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 "${outPath}"`, { stdio: 'inherit' });
  
  const stats = fs.statSync(outPath);
  console.log(`Done! Output: ${outPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
})();
