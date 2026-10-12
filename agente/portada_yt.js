// PORTADA de YouTube (Franklin, oct-11: "siempre la más épica del video, con texto llamativo").
// Uso: portada_yt:<ep>[:<videoId>]. Claude mira TODOS los cuadros del video (hojas de contacto), elige los 2 más épicos y
// escribe el texto (2–4 palabras ES + EN). Se arman portadas 1280x720 (largo) o 1080x1920 (Short) con letras gigantes,
// Claude elige la mejor y se sube a YouTube (thumbnails.set). Guarda continuity.thumbnail {es_url, en_url, shot}. $0.
const path=require('path');const fs=require('fs');const os=require('os');const {execFile}=require('child_process');const ROOT=path.join(__dirname,'..');
for (const l of fs.readFileSync(path.join(ROOT,'.env'),'utf8').split(/\r?\n/)){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
const F=path.join(ROOT,'netlify/functions');
let ffmpeg='ffmpeg';try{ffmpeg=require(path.join(ROOT,'node_modules','ffmpeg-static'));}catch(_){}
const ff=(args,cwd)=>new Promise((res,rej)=>execFile(ffmpeg,['-y','-v','error'].concat(args),{cwd,maxBuffer:1<<26},(e,so,se)=>e?rej(new Error(String(se||e.message).slice(-300))):res()));
const {runClaude,parseJson}=require('./_claude');
const {findFont,FONT_FILE,FONT_NAME}=require(F+'/_render');
const clean=(t)=>String(t||'').replace(/[{}\\]/g,'').trim();

async function compose(cwd,{img,text,hl,side,W,H,out}){
  // Texto: 1–2 líneas gigantes, palabra destacada en amarillo, borde negro grueso, lado sin sujeto oscurecido.
  const words=clean(text).toUpperCase().split(/\s+/).filter(Boolean);
  const mid=Math.ceil(words.length/2); // 2 palabras = 1 por línea (más grandes)
  const lines=[words.slice(0,mid),words.slice(mid)].filter((l)=>l.length);
  const hlSet=new Set((hl||[]).map((w)=>clean(w).toUpperCase()));
  const longest=Math.max(...lines.map((l)=>l.join(' ').length));
  const land=W>H;
  const fs0=Math.round(Math.min(land?175:190,(land?W*0.55:W*0.92)/(longest*0.62)));
  const al=land?(side==='right'?6:4):8; // \an4 izq-centro, \an6 der-centro, \an8 arriba-centro
  const x=land?(side==='right'?W-60:60):W/2, y=land?H/2:H*0.2;
  const txt=lines.map((l)=>l.map((w)=>hlSet.has(w.replace(/[^\p{L}\p{N}]/gu,''))||hlSet.has(w)?`{\\1c&H0000E5FF&}${w}{\\1c&H00FFFFFF&}`:w).join(' ')).join('\\N');
  const ass=['[Script Info]','ScriptType: v4.00+',`PlayResX: ${W}`,`PlayResY: ${H}`,'','[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: T,${FONT_NAME},${fs0},&H00FFFFFF,&H00FFFFFF,&H00000000,&HAA000000,-1,0,0,0,100,100,1,0,1,${Math.round(fs0*0.09)},${Math.round(fs0*0.06)},5,40,40,40,1`,
    '','[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.00,0:00:05.00,T,,0,0,0,,{\\an${al}\\pos(${x},${y})}${txt}`].join('\n');
  fs.writeFileSync(path.join(cwd,'t.ass'),ass);
  const grad=land?(side==='right'?`geq=lum='lum(X,Y)*(0.55+0.45*(1-X/W))':cb='cb(X,Y)':cr='cr(X,Y)'`:`geq=lum='lum(X,Y)*(0.55+0.45*X/W)':cb='cb(X,Y)':cr='cr(X,Y)'`):`geq=lum='lum(X,Y)*(0.6+0.4*min(1,Y/(H*0.45)))':cb='cb(X,Y)':cr='cr(X,Y)'`;
  await ff(['-i',img,'-vf',`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=contrast=1.12:saturation=1.25:brightness=0.01,unsharp=5:5:0.6,format=yuv420p,${grad},ass=t.ass:fontsdir=fonts`,'-frames:v','1','-q:v','2',out],cwd);
}

(async()=>{const [epId,vid0]=process.argv.slice(2);
const sb=require(F+'/_supabase').getSupabaseClient();
const {data:ep}=await sb.from('episodes').select('*, assets(*)').eq('id',epId).single();
const cont=ep.continuity||{};const land=cont.kind==='largo';const W=land?1280:1080,H=land?720:1920;
const imgs=require(F+'/_assets').latestPerShot((ep.assets||[]).filter((a)=>a.kind==='image'&&a.storage_path&&a.shot_number!=null),['image']).filter((a)=>a.kind==='image').sort((a,b)=>a.shot_number-b.shot_number);
if(!imgs.length)throw new Error('El episodio no tiene cuadros.');
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'vy-portada-'));fs.mkdirSync(path.join(cwd,'fonts'));fs.copyFileSync(findFont(),path.join(cwd,'fonts',FONT_FILE));
console.log('Bajando',imgs.length,'cuadros...');
const byShot={};
for(const [i,a] of imgs.entries()){const f=path.join(cwd,'s'+a.shot_number+'.jpg');fs.writeFileSync(f,Buffer.from(await (await fetch(a.storage_path)).arrayBuffer()));byShot[a.shot_number]=f;
  await ff(['-i',f,'-vf',`scale=384:216:force_original_aspect_ratio=increase,crop=384:216,drawbox=x=0:y=0:w=70:h=44:color=black@0.7:t=fill,drawtext=fontfile=fonts/${FONT_FILE}:text='${a.shot_number}':x=8:y=6:fontsize=32:fontcolor=yellow`,'-q:v','3',path.join(cwd,'lab'+String(i+1).padStart(4,'0')+'.jpg')],cwd);}
await ff(['-i','lab%04d.jpg','-vf','tile=5x4:padding=6:color=black','-q:v','3','hoja%02d.jpg'],cwd);
const sheets=fs.readdirSync(cwd).filter((x)=>/^hoja\d+\.jpg$/.test(x)).sort();
const narr=(ep.shots||[]).slice().sort((a,b)=>a.n-b.n).map((s)=>s.n+': '+String(s.voice_part||(Array.isArray(s.dialogue)?s.dialogue.map((d)=>d&&d.line).join(' '):'')).slice(0,140)).join('\n');
const p1=`Eres el mejor diseñador de miniaturas (portadas) de YouTube para documentales de historia con millones de vistas.
Lee las imágenes ${sheets.join(', ')}: son hojas con TODOS los cuadros del video; el número amarillo es la toma.
Título del video: "${ep.title||''}". Gancho: "${cont.hook_text||''}".
Narración por toma (para entender qué es cada imagen):
${narr.slice(0,9000)}

Elige las 2 tomas MÁS ÉPICAS para la portada: un solo sujeto claro y grande, drama, escala, contraste, colores fuertes, que se entienda en miniatura chiquita del celular, que muestre de qué trata el video (el tema PRINCIPAL, no una comparación con otro caso ni un detalle cualquiera), sin caras deformes ni texto inventado. DESCARTA cualquier cuadro con algo que no corresponde a la época de la historia (barcos, edificios, ropa o máquinas modernas en una escena prehistórica, etc.), salvo que la narración de esa toma lo mencione.
Escribe el TEXTO de la portada: 2 a 4 palabras en MAYÚSCULAS que den curiosidad y NO repitan el título palabra por palabra (ej. "CASI NOS BORRA", "¿EL FIN HUMANO?"). Marca 1 palabra para destacar en amarillo. Y la versión en inglés natural (2–4 palabras).
Para cada toma di en qué lado está el sujeto ("left","right","center") para poner el texto en el lado contrario.
Responde SOLO JSON: {"tomas":[{"n":12,"subject_side":"right","why":"..."},{"n":40,"subject_side":"left","why":"..."}],"text_es":"...","highlight_es":["..."],"text_en":"...","highlight_en":["..."]}`;
const j=parseJson(await runClaude(p1,{files:sheets.map((x)=>({name:x,buffer:fs.readFileSync(path.join(cwd,x))})),timeoutMin:10,log:console.log}));
const picks=(j.tomas||[]).filter((t)=>byShot[t.n]).slice(0,2);
if(!picks.length)throw new Error('Claude no eligió tomas válidas: '+JSON.stringify(j).slice(0,200));
console.log('Elegidas:',picks.map((t)=>t.n+' ('+t.why+')').join(' | '),'· texto:',j.text_es,'/',j.text_en);
const sideFor=(t)=>t.subject_side==='left'?'right':'left';
const cands=[];
for(const t of picks){const out='cand'+t.n+'.jpg';await compose(cwd,{img:byShot[t.n],text:j.text_es,hl:j.highlight_es,side:sideFor(t),W,H,out});cands.push({t,out});}
let win=cands[0];
if(cands.length>1){
  const p2=`Eres el mejor diseñador de miniaturas de YouTube. Lee ${cands.map((c)=>c.out).join(' y ')}: son 2 portadas candidatas del mismo video ("${ep.title||''}").
¿Cuál consigue MÁS clics en el celular (se entiende en chiquito, texto legible, sujeto claro, drama)? Si el texto tapa el sujeto o no se lee, esa pierde.
Responde SOLO JSON: {"mejor":"${cands[0].out}","por_que":"..."}`;
  try{const k=parseJson(await runClaude(p2,{files:cands.map((c)=>({name:c.out,buffer:fs.readFileSync(path.join(cwd,c.out))})),timeoutMin:6,log:console.log}));win=cands.find((c)=>c.out===k.mejor)||win;console.log('Ganadora:',win.out,'·',k.por_que);}catch(e){console.log('no pude comparar ('+e.message.slice(0,80)+') → uso la primera');}
}
await compose(cwd,{img:byShot[win.t.n],text:j.text_en||j.text_es,hl:j.highlight_en,side:sideFor(win.t),W,H,out:'portada_en.jpg'});
const {uploadFile}=require(F+'/_storage');const {data:se}=await sb.from('series').select('slug').eq('id',ep.series_id).single();
const base=`${se.slug}/ep${ep.episode_number}/portada-yt-${Date.now()}`;
// YouTube acepta portadas de hasta 2 MB: si pasa, se baja la calidad del jpg.
for(const f of [win.out,'portada_en.jpg']){for(let q=4;q<=12&&fs.statSync(path.join(cwd,f)).size>1.9e6;q+=2){await ff(['-i',f,'-q:v',String(q),'r_'+f],cwd);fs.renameSync(path.join(cwd,'r_'+f),path.join(cwd,f));}}
const esBuf=fs.readFileSync(path.join(cwd,win.out)),enBuf=fs.readFileSync(path.join(cwd,'portada_en.jpg'));
const thumb={shot:win.t.n,text_es:j.text_es,text_en:j.text_en,es_url:await uploadFile(sb,{path:base+'-es.jpg',buffer:esBuf,contentType:'image/jpeg'}),en_url:await uploadFile(sb,{path:base+'-en.jpg',buffer:enBuf,contentType:'image/jpeg'}),at:new Date().toISOString()};
const {data:fr}=await sb.from('episodes').select('continuity').eq('id',epId).single();
await sb.from('episodes').update({continuity:Object.assign({},fr.continuity||{},{thumbnail:thumb})}).eq('id',epId);
console.log('Portada ES:',thumb.es_url);console.log('Portada EN:',thumb.en_url);
const vid=vid0||((((ep.validator_report||{}).social_runs||{}).youtube||{}).video_id);
if(vid){
  const tk=await require(F+'/_social').youtubeAccessToken(sb);
  const r=await fetch('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId='+vid+'&uploadType=media',{method:'POST',headers:{Authorization:'Bearer '+tk,'Content-Type':'image/jpeg'},body:esBuf});
  console.log(r.ok?'YouTube: portada puesta ✅ https://youtu.be/'+vid:'YouTube: no pude poner la portada (HTTP '+r.status+': '+(await r.text()).slice(0,200)+')');
}
fs.rmSync(cwd,{recursive:true,force:true});
})().catch(e=>{console.log('ERROR',e.message);process.exit(1);});
