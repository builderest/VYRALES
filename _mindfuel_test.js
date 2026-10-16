// Prueba puntual MindFuel Rise: 6 imagenes cosmicas via Flow + 6 videos LTX en king. No toca episodios/DB.
const fs = require('fs');
const path = require('path');
const { flowImages } = require('./agente/flow_imagenes');

const SHOTS = [
  { name: 'shot1_nebula', prompt: 'A vast dark nebula filling the frame, deep blue and violet gas clouds drifting slowly, with a single sharp beam of white light cutting diagonally across it.', motion: 'The light beam slides slowly from one side of the frame to the other at a steady pace.', cam: 'slow lateral drift to the left' },
  { name: 'shot2_planet', prompt: "A single rocky planet in silhouette against deep space, backlit by a bright sun emerging slowly from behind its curved edge.", motion: "The sunlight grows gradually brighter as the planet's edge glows.", cam: 'short slow pan to the right' },
  { name: 'shot3_converge', prompt: 'A dense field of small bright points of light scattered across deep black space, like gravity about to pull everything toward one spot.', motion: 'The points of light slowly draw inward and compress toward a single glowing point at the center of the frame, everything converging at the same calm pace.', cam: 'gentle slight handheld sway' },
  { name: 'shot4_shockwave', prompt: 'A glowing ring of orange and white energy at the center of a dark frame, like the first instant of a shockwave.', motion: 'The ring of energy expands outward from the center in slow motion, growing larger and fainter as it spreads toward the edges.', cam: 'slow lateral drift to the right' },
  { name: 'shot5_gasgiant', prompt: "Thick golden-orange clouds of a gas giant's atmosphere filling the frame, forming one large spiral band.", motion: 'The spiral band of clouds rotates slowly in one continuous direction at a steady pace.', cam: 'short slow pan to the left' },
  { name: 'shot6_star', prompt: 'A single small bright star at the center of total darkness.', motion: 'The star slowly grows larger and more intense, its light expanding evenly outward in all directions like it is igniting.', cam: 'slow lateral drift to the left' },
];

const OUT = path.join(__dirname, '_to_delete', 'mindfuel_test');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  console.log('=== Paso 1/2: Flow genera las 6 imagenes (9:16, una sesion) ===');
  const prompts = SHOTS.map((s) => s.prompt);
  const results = await flowImages(prompts, console.log, (i, r) => {
    console.log(`  escena ${i + 1}: ${r && r.buffer ? 'OK ' + r.buffer.length + ' bytes' : 'FALLO'}`);
  }, { aspect: '9:16' });

  results.forEach((r, i) => {
    if (r && r.buffer) {
      const file = path.join(OUT, SHOTS[i].name + '.jpg');
      fs.writeFileSync(file, r.buffer);
      console.log('guardado:', file);
    } else {
      console.log('SIN IMAGEN:', SHOTS[i].name, r && r.error);
    }
  });
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(SHOTS, null, 2));
  console.log('=== LISTO paso 1/2 ===');
})().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
