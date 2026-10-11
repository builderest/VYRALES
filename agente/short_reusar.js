// SHORT CON LAS TOMAS DEL LARGO (Franklin, oct-11): el Short conserva SU narración, pero en vez de generar tomas
// nuevas usa las del video largo (ya revisadas, se ven bien). Uso: short_reusar:<short_ep>. $0 en video.
//  1) Voz del Short (si falta; Gemini TTS, centavos).
//  2) Claude ve TODAS las tomas del largo (hojas de contacto + su narración) y elige, para cada frase del Short, la
//     toma (o 2 seguidas si la frase es larga) que muestra exactamente lo que se dice.
//  3) QA: Claude revisa cada frase con su cuadro elegido; si no cuadra, elige otra toma del largo (hasta 2 vueltas).
//  4) Cada toma se pasa a vertical a pantalla completa (recortada centrada en el sujeto) y se une el Short
//     con su voz y letras grandes.
const path=require('path');const fs=require('fs');const os=require('os');const {execFile}=require('child_process');const ROOT=path.join(__dirname,'..');
for (const l of fs.readFileSync(path.join(ROOT,'.env'),'utf8').split(/\r?\n/)){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
process.env.VYRALES_LOCAL_RUN=process.env.VYRALES_LOCAL_RUN||'1';
const F=path.join(ROOT,'netlify/functions');
let ffmpeg='ffmpeg';try{ffmpeg=require(path.join(ROOT,'node_modules','ffmpeg-static'));}catch(_){}
const ff=(args,cwd)=>new Promise((res,rej)=>execFile(ffmpeg,['-y','-v','error'].concat(args),{cwd,maxBuffer:1<<26,timeout:15*60000},(e,so,se)=>e?rej(new Error(String(se||e.message).slice(-300))):res()));
const durOf=(f,cwd)=>new Promise((res)=>execFile(ffmpeg,['-hide_banner','-i',f],{cwd},(e,so,se)=>{const m=String(se||'').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);res(m?+m[1]*3600+ +m[2]*60+ +m[3]:0);}));
const {runClaude,parseJson}=require('./_claude');
const {findFont,FONT_FILE}=require(F+'/_render');
const lineOf=(x)=>String(x.voice_part||(Array.isArray(x.dialogue)?x.dialogue:(x.dialogue?[x.dialogue]:[])).map((d)=>d&&d.line).filter(Boolean).join(' ')).trim();

(async()=>{const epId=process.argv[2];
const sb=require(F+'/_supabase').getSupabaseClient();
const {data:ep}=await sb.from('episodes').select('*, assets(*)').eq('id',epId).single();
const longId=(ep.continuity||{}).parent_episode_id;if(!longId)throw new Error('Este Short no tiene video largo (continuity.parent_episode_id).');
const {data:lg}=await sb.from('episodes').select('*, assets(*)').eq('id',longId).single();
const {data:series}=await sb.from('series').select('*').eq('id',ep.series_id).single();
const A=require(F+'/_assets');
const lClips={},lImgs={};
A.latestPerShot((lg.assets||[]).filter((a)=>a.storage_path&&a.shot_number!=null),['video_clip','image']).forEach((a)=>{if(a.kind==='video_clip')lClips[a.shot_number]=a;if(a.kind==='image')lImgs[a.shot_number]=a;});
const lShots=(lg.shots||[]).slice().sort((a,b)=>a.n-b.n).filter((s)=>lClips[s.n]&&lImgs[s.n]);
console.log(`Short "${ep.title}" ← largo "${lg.title}" (${lShots.length} tomas disponibles)`);

// 1) Voz del Short
const VF=require(F+'/_voice_full');
const voice=await VF.ensureFullVoice(sb,{episode:ep,series,log:console.log});
const sShots=(ep.shots||[]).slice().sort((a,b)=>a.n-b.n);
const need=VF.shotCutsExact(voice,sShots)||{};
console.log('voz del Short:',voice.seconds,'s');

const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'vy-reusar-'));fs.mkdirSync(path.join(cwd,'fonts'));fs.copyFileSync(findFont(),path.join(cwd,'fonts',FONT_FILE));
// duraciones de las tomas del largo + hojas de contacto
const lDur={};
for(const [i,s] of lShots.entries()){
  const fi=path.join(cwd,'L'+s.n+'.jpg');fs.writeFileSync(fi,Buffer.from(await (await fetch(lImgs[s.n].storage_path)).arrayBuffer()));
  lDur[s.n]=await durOf(lClips[s.n].storage_path,cwd);
  await ff(['-i',fi,'-vf',`scale=384:216:force_original_aspect_ratio=increase,crop=384:216,drawbox=x=0:y=0:w=70:h=44:color=black@0.7:t=fill,drawtext=fontfile=fonts/${FONT_FILE}:text='${s.n}':x=8:y=6:fontsize=32:fontcolor=yellow`,'-q:v','3',path.join(cwd,'lab'+String(i+1).padStart(4,'0')+'.jpg')],cwd);
}
await ff(['-i','lab%04d.jpg','-vf','tile=5x4:padding=6:color=black','-q:v','3','hoja%02d.jpg'],cwd);
const sheets=fs.readdirSync(cwd).filter((x)=>/^hoja\d+\.jpg$/.test(x)).sort();
const longList=lShots.map((s)=>`${s.n} (${lDur[s.n].toFixed(1)} s): ${lineOf(s).slice(0,160)}`).join('\n');
const shortList=sShots.map((s)=>`${s.n} (necesita ${(need[s.n]||0).toFixed(1)} s): ${lineOf(s)}`).join('\n');

// 2) Elegir tomas
const p1=`Eres editor de documentales. Vamos a armar un Short usando SOLO tomas ya hechas del video largo.
Lee ${sheets.join(', ')}: hojas con todas las tomas del largo (número amarillo = toma).
Tomas del LARGO (número, duración, lo que narra):
${longList}

Frases del SHORT (número, segundos que dura su voz, texto):
${shortList}

Para cada frase del Short elige la toma del largo cuya IMAGEN muestra exactamente lo que dice la frase (mira la imagen, no solo el texto). Reglas:
- Si la frase necesita más segundos que la toma (más de 1.4 veces su duración), elige 2 tomas seguidas o parecidas en "shots" (se ponen una detrás de otra).
- No repitas una toma en frases distintas salvo que no haya otra que sirva.
- La última frase (llamada a ver la historia completa) lleva la toma más épica del largo.
- Di también dónde está el sujeto principal en la imagen ("left","center","right"): el Short es vertical y se recorta a lo alto, así que se centra en el sujeto.
Responde SOLO JSON: {"map":[{"n":1,"shots":[12],"lado":"center","por_que":"..."}]}`;
const j1=parseJson(await runClaude(p1,{files:sheets.map((x)=>({name:x,buffer:fs.readFileSync(path.join(cwd,x))})),timeoutMin:12,log:console.log}));
let map=Object.fromEntries((j1.map||[]).map((m)=>[Number(m.n),(m.shots||[]).map(Number).filter((k)=>lClips[k])]));
const side=Object.fromEntries((j1.map||[]).map((m)=>[Number(m.n),String(m.lado||'center')]));
for(const s of sShots)if(!(map[s.n]&&map[s.n].length))throw new Error('Claude no eligió toma para la frase '+s.n);
console.log('Elección:',sShots.map((s)=>s.n+'→'+map[s.n].join('+')).join(' '));

// 3) QA: cada frase con su(s) cuadro(s)
for(let round=1;round<=2;round++){
  const files=[];const desc=[];
  for(const s of sShots){const fn='qa'+s.n+'.jpg';const ims=map[s.n].map((k)=>path.join(cwd,'L'+k+'.jpg'));
    if(ims.length>1)await ff(ims.flatMap((f)=>['-i',f]).concat(['-filter_complex',ims.map((_,i)=>`[${i}:v]scale=640:360:force_original_aspect_ratio=increase,crop=640:360[v${i}]`).join(';')+';'+ims.map((_,i)=>`[v${i}]`).join('')+`hstack=inputs=${ims.length}`,'-q:v','3',fn]),cwd);
    else await ff(['-i',ims[0],'-vf','scale=960:540:force_original_aspect_ratio=increase,crop=960:540','-q:v','3',fn],cwd);
    files.push({name:fn,buffer:fs.readFileSync(path.join(cwd,fn))});desc.push(`${fn} → frase ${s.n}: "${lineOf(s)}" (tomas ${map[s.n].join('+')})`);}
  const p2=`QA de un Short armado con tomas de un documental. Para cada imagen, ¿muestra lo que dice su frase? Sé estricto con el SUJETO (si la frase habla de investigadores en una cueva, deben verse; si habla del volcán, el volcán). Si no cuadra, propone otra toma del largo de esta lista (mira las hojas ${sheets.join(', ')}):
${longList}

${desc.join('\n')}
Si propones otra toma, di dónde está su sujeto ("left","center","right").
Responde SOLO JSON: {"tomas":[{"n":1,"ok":true,"motivo":"","cambiar_a":[],"lado":"center"}]}`;
  const j=parseJson(await runClaude(p2,{files:files.concat(sheets.map((x)=>({name:x,buffer:fs.readFileSync(path.join(cwd,x))}))),timeoutMin:10,log:console.log}));
  const bad=(j.tomas||[]).filter((t)=>!t.ok&&Array.isArray(t.cambiar_a)&&t.cambiar_a.map(Number).some((k)=>lClips[k]));
  for(const t of j.tomas||[])if(!t.ok)console.log(`QA frase ${t.n}: ${t.motivo}${t.cambiar_a&&t.cambiar_a.length?' → toma '+t.cambiar_a.join('+'):''}`);
  if(!bad.length){console.log('QA: todas las frases muestran lo que se narra ✅');break;}
  for(const t of bad){map[Number(t.n)]=t.cambiar_a.map(Number).filter((k)=>lClips[k]);if(t.lado)side[Number(t.n)]=String(t.lado);}
}

// 4) Tomas verticales a pantalla completa
// Pantalla COMPLETA 9:16 (Franklin: "que ocupen el teléfono completo, aunque corte los lados"): se escala a lo alto y
// se recorta centrado en el sujeto (lado que dijo Claude).
const vertFor=(sd)=>{const x=sd==='left'?'0':sd==='right'?'iw-1080':'(iw-1080)/2';return `[0:v]scale=-2:1920:flags=lanczos,crop=1080:1920:${x}:0,unsharp=5:5:0.5,setsar=1,fps=24[v]`;};
const {uploadFile}=require(F+'/_storage');
const now=new Date().toISOString();const rows=[];
for(const s of sShots){
  const parts=[];
  for(const [k,ln] of map[s.n].entries()){const src='S'+s.n+'_'+k+'.mp4';fs.writeFileSync(path.join(cwd,src),Buffer.from(await (await fetch(lClips[ln].storage_path)).arrayBuffer()));parts.push(src);}
  const out='V'+s.n+'.mp4';
  const inArgs=parts.flatMap((p)=>['-i',p]);
  const pre=parts.length>1?parts.map((_,i)=>`[${i}:v]setsar=1,fps=24,scale=1280:720[c${i}]`).join(';')+';'+parts.map((_,i)=>`[c${i}]`).join('')+`concat=n=${parts.length}:v=1:a=0[cat];`+vertFor(side[s.n]).replace('[0:v]','[cat]'):vertFor(side[s.n]);
  await ff(inArgs.concat(['-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000','-filter_complex',pre,'-map','[v]','-map',parts.length+':a','-shortest','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac',out]),cwd);
  await ff(['-i',out,'-frames:v','1','-q:v','2','F'+s.n+'.jpg'],cwd);
  const key=`${series.slug}/ep${ep.episode_number}/shot-${String(s.n).padStart(2,'0')}-largo-v${Date.now()}`;
  const vurl=await uploadFile(sb,{path:key+'.mp4',buffer:fs.readFileSync(path.join(cwd,out)),contentType:'video/mp4'});
  const iurl=await uploadFile(sb,{path:key+'.jpg',buffer:fs.readFileSync(path.join(cwd,'F'+s.n+'.jpg')),contentType:'image/jpeg'});
  const note='del largo: toma '+map[s.n].join('+');
  rows.push({episode_id:epId,kind:'video_clip',model:lClips[map[s.n][0]].model,shot_number:s.n,storage_path:vurl,prompt:note,cost_usd:0,created_at:now,updated_at:now});
  rows.push({episode_id:epId,kind:'image',model:lImgs[map[s.n][0]].model,shot_number:s.n,storage_path:iurl,prompt:note,cost_usd:0,created_at:now,updated_at:now});
  console.log(`frase ${s.n}: ${note} → vertical lista`);
}
const ins=await sb.from('assets').insert(rows);if(ins.error)throw new Error('assets: '+ins.error.message);
const {data:fr}=await sb.from('episodes').select('continuity').eq('id',epId).single();
await sb.from('episodes').update({status:'en_revision',continuity:Object.assign({},fr.continuity||{},{reused_from_long:{long_id:longId,map,at:now}})}).eq('id',epId);
fs.rmSync(cwd,{recursive:true,force:true});

// 5) Unir el Short (voz + letras grandes + cierre)
const {data:fresh}=await sb.from('episodes').select('*, assets(*)').eq('id',epId).single();
const res=await require(F+'/_merge').mergeEpisodeVideo(sb,{episode:fresh,series,log:console.log});
console.log('LISTO. Short:',res&&res.asset&&res.asset.storage_path);
})().catch(e=>{console.log('ERROR',e.message);process.exit(1);});
