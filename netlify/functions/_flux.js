// Imágenes con FLUX.2 Klein 4B en la PC "king" (ComfyUI). Gratis. Solo desde el agente local
// (necesita alcanzar king por Tailscale). Probado oct-2026: bien con UN sujeto (animal, objeto,
// paisaje); mal con varios sujetos distintos en la misma imagen y sin caras de personajes.
// Devuelve lo mismo que _image.generateImage: { buffer, mimeType, costUsd, model }.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GEN = () => (process.env.VYRALES_GEN_URL || 'http://100.66.84.73:8188').replace(/\/$/, '');
const TEMPLATE = path.join(__dirname, '..', '..', 'agente', 'flux2_edit_api.json');
const NEG = 'people, human, hands, fingers, man, woman, human eye, text, letters, watermark, logo, collage, split screen, border, cartoon, cgi, plastic';
const RULE = ' Vertical 9:16, photorealistic, cinematic nature documentary photo, dramatic lighting, sharp detail. No people, no hands, no humans, no text.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(60000) }, opts || {}));
  if (!r.ok) throw new Error('king (flux) ' + url.replace(GEN(), '') + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.json();
}

function graph(prompt, refName, aspect) {
  const [W, H] = aspect === '16:9' ? [1344, 768] : [768, 1344]; // largos 16:9 (oct-12: salían cuadros verticales en el largo)
  const wf = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  delete wf['81'];
  if (refName) {
    wf['76'].inputs.image = refName;
    wf['75:63'].inputs.positive = ['75:124', 0];
    wf['75:63'].inputs.negative = ['75:122', 0];
  } else {
    for (const k of ['76', '75:80', '75:100', '75:123', '75:122', '75:124']) delete wf[k];
    wf['75:63'].inputs.positive = ['75:74', 0];
    wf['75:63'].inputs.negative = ['75:67', 0];
  }
  wf['75:66'].inputs.width = W; wf['75:66'].inputs.height = H;
  wf['75:62'].inputs.width = W; wf['75:62'].inputs.height = H;
  wf['75:74'].inputs.text = prompt;
  wf['75:67'].inputs.text = NEG;
  wf['75:73'].inputs.noise_seed = crypto.randomInt(1, 2 ** 31);
  wf['9'].inputs.filename_prefix = 'vyrales/flux';
  return wf;
}

// prompt: descripción corta de lo que se ve. reference: { imageBytes, mimeType } → edita esa imagen.
async function fluxImage({ prompt, reference = null, aspect = '9:16' }) {
  if (!fs.existsSync(TEMPLATE)) throw new Error('Falta agente/flux2_edit_api.json (flux solo funciona desde el agente local).');
  let refName = null;
  if (reference) {
    const fd = new FormData();
    fd.append('image', new Blob([Buffer.from(reference.imageBytes, 'base64')], { type: reference.mimeType || 'image/png' }), 'vy_ref_' + Date.now() + '.png');
    fd.append('overwrite', 'true');
    const up = await j(GEN() + '/upload/image', { method: 'POST', body: fd });
    refName = up.subfolder ? up.subfolder + '/' + up.name : up.name;
  }
  const text = (reference ? 'Edit this image: ' : '') + String(prompt).trim().replace(/\.?$/, '.') + RULE;
  const t0 = Date.now();
  const { prompt_id } = await j(GEN() + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph(text, refName, aspect), client_id: 'vyrales' }) });
  for (;;) {
    await sleep(3000);
    if (Date.now() - t0 > 10 * 60000) throw new Error('king (flux) tardó más de 10 min');
    const item = (await j(GEN() + '/history/' + prompt_id))[prompt_id];
    if (!item) continue;
    const s = item.status || {};
    if (s.status_str === 'error') throw new Error('ComfyUI (flux) dio error: ' + JSON.stringify((s.messages || []).filter((m) => m[0] === 'execution_error')).slice(0, 500));
    const f = (((item.outputs || {})['9'] || {}).images || [])[0];
    if (!f) { if (s.completed) throw new Error('flux terminó sin imagen'); continue; }
    const r = await fetch(`${GEN()}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}`);
    return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: 'image/png', costUsd: 0, model: 'flux2_klein_king' };
  }
}

// oct-15 (Franklin): "quitar a FLUX, no genera imagenes realistas". Si Flow falla en darnos UNA
// imagen (no responde, se cae, etc.) eso es una falla de generacion → recien ahi se llama a Gemini
// (de pago, pero igual de realista que Flow). Si la imagen SI sale pero el QA la rechaza (no coincide
// con la narracion, algo deformado), el problema es el PROMPT, no el motor: se reescribe el prompt y
// se reintenta con Flow de nuevo, nunca se cambia a FLUX. useFlux() queda apagada (siempre false) en
// vez de borrar fluxImage(), para poder volver a prenderla facil si hace falta.
function useFlux(storyBible, shot) {
  return false;
}

module.exports = { fluxImage, useFlux };
