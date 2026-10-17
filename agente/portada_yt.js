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
  const words=clean(String(text).replace(/\|/g,' ')).toUpperCase().split(/\s+/).filter(Boolean);
  const mid=Math.ceil(words.length/2); // 2 palabras = 1 por línea (más grandes)
  // "ESPERABAN 5 | EXPLOTÓ CON 15": el | marca dónde va el salto de línea (texto elegido a mano).
  const lines=String(text).includes('|')?String(text).split('|').map((p)=>clean(p).toUpperCase().split(/\s+/).filter(Boolean)).filter((l)=>l.length):[words.slice(0,mid),words.slice(mid)].filter((l)=>l.length);
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
const cont=ep.continuity||{};const land=cont.kind==='largo';
const {data:serie0}=await sb.from('series').select('story_bible').eq('id',ep.series_id).single();const EN=require(F+'/_pulir').ctasOf(serie0&&serie0.story_bible).lang==='en';const W=land?1280:1080,H=land?720:1920;
const imgs=require(F+'/_assets').latestPerShot((ep.assets||[]).filter((a)=>a.kind==='image'&&a.storage_path&&a.shot_number!=null),['image']).filter((a)=>a.kind==='image').sort((a,b)=>a.shot_number-b.shot_number);
if(!imgs.length)throw new Error('El episodio no tiene cuadros.');
// Ya hay portada hecha para ESTE video final (p. ej. al preparar los textos) y solo falta ponerla en YouTube → no se rehace.
const lastFinal=(ep.assets||[]).filter((a)=>a.kind==='final_render').map((a)=>a.created_at).sort().pop()||'';
const th0=cont.thumbnail||{};
if(vid0&&th0.es_url&&th0.at&&new Date(th0.at)>=new Date(lastFinal||0)){
  console.log('Portada ya hecha para este video ('+th0.at+') → solo la pongo en YouTube.');
  const buf=Buffer.from(await (await fetch(th0.es_url)).arrayBuffer());
  const tk=await require(F+'/_social').youtubeAccessToken(sb);
  const r=await fetch('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId='+vid0+'&uploadType=media',{method:'POST',headers:{Authorization:'Bearer '+tk,'Content-Type':'image/jpeg'},body:buf});
  console.log(r.ok?'YouTube: portada puesta ✅ https://youtu.be/'+vid0:'YouTube: no pude poner la portada (HTTP '+r.status+': '+(await r.text()).slice(0,200)+')');
  return;
}
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
Escribe el TEXTO de la portada: 2 a 5 palabras en MAYÚSCULAS, con FUERZA y TENSIÓN, épico, que haga que la gente NO pueda pasar de largo (Franklin, oct-17: "NINGUNO SOLTÓ" es plano y descriptivo; así sí: "¡SOLO UNO SALDRÍA VIVO!", "¡NINGUNO IBA A CEDER!", "¡UNA LUCHA SIN ESCAPE!", "CASI NOS BORRA", "¿EL FIN HUMANO?"). Usa lo que está EN JUEGO (vida o muerte, el fin, lo imposible, el peligro, el secreto), con ¡! o ¿? cuando sume. EXAGERA al máximo la emoción y el drama (es lo que hace que la gente entre), NUNCA los hechos: solo lo que la historia cuenta de verdad. Entre varias opciones, elige SIEMPRE la más épica y exagerada. NO repitas el título palabra por palabra ni describas la imagen. Marca 1–2 palabras para destacar en amarillo (la más fuerte). Y la versión en inglés natural con la misma fuerza (2–5 palabras); solo se usa en canales en inglés (MindFuel): en VYRALES la portada va SOLO en español.
Para cada toma di en qué lado está el sujeto ("left","right","center") para poner el texto en el lado contrario.
ADEMÁS (Franklin, oct-16: "una portada que llame MUCHO la atención, hecha con IA, que exagere, que haga que la gente entre"): escribe 2 prompts en inglés para generar con IA una imagen NUEVA de portada, NO un cuadro del video. Estilo miniatura viral de YouTube: UN sujeto enorme y dramático que se entiende en miniatura, emoción extrema o escala exagerada (algo gigantesco, a punto de pasar, en el momento más intenso), contraste fuerte, luz de contraluz/rim light, colores saturados (naranja/azul, rojo/negro), fondo simple y oscuro, profundidad de campo corta, y un lado del cuadro LIBRE (oscuro y vacío) para poner el texto. Exagera lo visual, pero que sea el tema REAL del video (nada que el video no cuente, ni personas reales identificables, ni sangre). Sin letras, logos ni texto dentro de la imagen. ${land?'Formato horizontal 16:9.':'Formato vertical 9:16, sujeto en la mitad de abajo y el espacio libre ARRIBA.'}
${cont.cover_text_es?'EL TEXTO DE LA PORTADA YA ESTÁ DECIDIDO: "'+String(cont.cover_text_es).replace(/\|/g,' / ')+'". Elige tomas y prompts de IA que lo muestren (por ejemplo, la explosión si habla de la bomba).\n':''}Responde SOLO JSON: {"tomas":[{"n":12,"subject_side":"right","why":"..."},{"n":40,"subject_side":"left","why":"..."}],"text_es":"...","highlight_es":["..."],"text_en":"...","highlight_en":["..."],"ai":[{"prompt":"...","subject_side":"right"},{"prompt":"...","subject_side":"left"}]}`;
const j=parseJson(await runClaude(p1,{files:sheets.map((x)=>({name:x,buffer:fs.readFileSync(path.join(cwd,x))})),timeoutMin:10,log:console.log}));
const picks=(j.tomas||[]).filter((t)=>byShot[t.n]).slice(0,2);
if(!picks.length)throw new Error('Claude no eligió tomas válidas: '+JSON.stringify(j).slice(0,200));
// Texto de portada elegido a mano para este video (continuity.cover_text_es, Franklin oct-17): manda sobre el de Claude.
if(cont.cover_text_es){j.text_es=cont.cover_text_es;const lw=String(cont.cover_text_es).split(/[\s|]+/).filter(Boolean);j.highlight_es=[lw[lw.length-1]];}
console.log('Elegidas:',picks.map((t)=>t.n+' ('+t.why+')').join(' | '),'· texto:',j.text_es,'/',j.text_en);
const sideFor=(t)=>t.subject_side==='left'?'right':'left';
// Texto principal: el idioma del canal (MindFuel = inglés).
const T1=EN?(j.text_en||j.text_es):j.text_es, H1=EN?j.highlight_en:j.highlight_es;
const cands=[];
for(const t of picks){const out='cand'+t.n+'.jpg';await compose(cwd,{img:byShot[t.n],text:T1,hl:H1,side:sideFor(t),W,H,out});cands.push({img:byShot[t.n],side:sideFor(t),out,shot:t.n,kind:'cuadro'});}
// Portadas con IA (Flow, $0): imagen nueva exagerada hecha SOLO para la portada. Si Flow falla o no hay cuota, quedan los cuadros.
if(process.env.VYRALES_PORTADA_IA!=='0'&&Array.isArray(j.ai)&&j.ai.length){
  try{
    const {flowImages}=require('./flow_imagenes');
    const ai=j.ai.filter((x)=>x&&x.prompt).slice(0,2);
    console.log('Portada con IA: generando',ai.length,'imagen(es) en Flow...');
    const r=await flowImages(ai.map((x)=>x.prompt),console.log,null,{aspect:land?'16:9':'9:16'});
    for(const [k,x] of (r||[]).entries()){if(!x||!x.buffer)continue;const img=path.join(cwd,'ai'+k+'.jpg');fs.writeFileSync(img,x.buffer);const out='candIA'+k+'.jpg';await compose(cwd,{img,text:T1,hl:H1,side:sideFor(ai[k]),W,H,out});cands.push({img,side:sideFor(ai[k]),out,shot:null,kind:'ia',prompt:ai[k].prompt});}
  }catch(e){console.log('Portada con IA: no se pudo ('+String(e.message).slice(0,140)+') → sigo con los cuadros del video');}
}
let win=cands[0];
if(cands.length>1){
  const p2=`Eres el mejor diseñador de miniaturas de YouTube. Lee ${cands.map((c)=>c.out).join(', ')}: son ${cands.length} portadas candidatas del mismo video ("${ep.title||''}").
¿Cuál consigue MÁS clics en el celular (se entiende en chiquito, texto legible, sujeto claro, drama, curiosidad)? Si el texto tapa el sujeto, no se lee, o la imagen tiene letras raras, caras deformes o no tiene que ver con el video, esa pierde.
Responde SOLO JSON: {"mejor":"${cands[0].out}","por_que":"..."}`;
  try{const k=parseJson(await runClaude(p2,{files:cands.map((c)=>({name:c.out,buffer:fs.readFileSync(path.join(cwd,c.out))})),timeoutMin:6,log:console.log}));win=cands.find((c)=>c.out===k.mejor)||win;console.log('Ganadora:',win.out,'('+win.kind+') ·',k.por_que);}catch(e){console.log('no pude comparar ('+e.message.slice(0,80)+') → uso la primera');}
}
await compose(cwd,{img:win.img,text:EN?T1:(j.text_en||j.text_es),hl:EN?H1:j.highlight_en,side:win.side,W,H,out:'portada_en.jpg'});
// PORTADA PARA TIKTOK / INSTAGRAM / FACEBOOK (vertical 1080x1920, Franklin oct-16: "IA en todos"). En un Short es la
// misma ganadora. En un largo se hace una versión vertical: si ganó la de IA, Flow la genera en 9:16 con el mismo prompt.
let socialFile=null;
if(!land){socialFile=win.out;}
else{
  let vimg=win.img;
  if(win.kind==='ia'&&win.prompt){
    try{const {flowImages}=require('./flow_imagenes');const r=await flowImages([win.prompt+' Vertical 9:16 composition: the subject fills the lower half, dark empty space at the top for text.'],console.log,null,{aspect:'9:16'});if(r&&r[0]&&r[0].buffer){vimg=path.join(cwd,'ai_v.jpg');fs.writeFileSync(vimg,r[0].buffer);}}
    catch(e){console.log('Portada vertical con IA: no se pudo ('+String(e.message).slice(0,120)+') → recorto la horizontal');}
  }
  await compose(cwd,{img:vimg,text:T1,hl:H1,side:'left',W:1080,H:1920,out:'portada_social.jpg'});socialFile='portada_social.jpg';
}
const {uploadFile}=require(F+'/_storage');const {data:se}=await sb.from('series').select('slug').eq('id',ep.series_id).single();
const base=`${se.slug}/ep${ep.episode_number}/portada-yt-${Date.now()}`;
// YouTube acepta portadas de hasta 2 MB: si pasa, se baja la calidad del jpg.
for(const f of [win.out,'portada_en.jpg'].concat(socialFile&&socialFile!==win.out?[socialFile]:[])){for(let q=4;q<=12&&fs.statSync(path.join(cwd,f)).size>1.9e6;q+=2){await ff(['-i',f,'-q:v',String(q),'r_'+f],cwd);fs.renameSync(path.join(cwd,'r_'+f),path.join(cwd,f));}}
const esBuf=fs.readFileSync(path.join(cwd,win.out)),enBuf=fs.readFileSync(path.join(cwd,'portada_en.jpg'));
const thumb={shot:win.shot,kind:win.kind,ai_prompt:win.prompt||null,text_es:j.text_es,text_en:j.text_en,es_url:await uploadFile(sb,{path:base+'-es.jpg',buffer:esBuf,contentType:'image/jpeg'}),en_url:await uploadFile(sb,{path:base+'-en.jpg',buffer:enBuf,contentType:'image/jpeg'}),at:new Date().toISOString()};
thumb.social_url=socialFile===win.out?thumb.es_url:await uploadFile(sb,{path:base+'-social.jpg',buffer:fs.readFileSync(path.join(cwd,socialFile)),contentType:'image/jpeg'});
// La portada de las redes (Instagram la usa por API; TikTok/Facebook se descarga del panel) = la de IA.
const {data:fr}=await sb.from('episodes').select('continuity, validator_report').eq('id',epId).single();
const vr=Object.assign({},fr.validator_report||{});vr.publish_package=Object.assign({},vr.publish_package||{},{cover_url:thumb.social_url,cover_kind:win.kind});
await sb.from('episodes').update({continuity:Object.assign({},fr.continuity||{},{thumbnail:thumb}),validator_report:vr}).eq('id',epId);
console.log('Portada redes:',thumb.social_url);
console.log('Portada ES:',thumb.es_url);console.log('Portada EN:',thumb.en_url);
const vid=vid0||((((ep.validator_report||{}).social_runs||{}).youtube||{}).video_id);
if(vid){
  const tk=await require(F+'/_social').youtubeAccessToken(sb);
  const r=await fetch('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId='+vid+'&uploadType=media',{method:'POST',headers:{Authorization:'Bearer '+tk,'Content-Type':'image/jpeg'},body:esBuf});
  console.log(r.ok?'YouTube: portada puesta ✅ https://youtu.be/'+vid:'YouTube: no pude poner la portada (HTTP '+r.status+': '+(await r.text()).slice(0,200)+')');
}
fs.rmSync(cwd,{recursive:true,force:true});
})().catch(e=>{console.log('ERROR',e.message);process.exit(1);});
