// Pone en el episodio una voz YA generada (p. ej. la prueba de una sola toma) sin volver a pagar TTS.
// Uso: voz_instalar:<episodio>:<url wav>[:guardar]. Sin ":guardar" solo revisa (repeticiones y si cada toma alcanza).
// Procesa igual que ensureFullVoice (pausas cortas), alinea con Whisper local y guarda la voz anterior en continuity.voice_prev.
const path=require('path');const fs=require('fs');const os=require('os');const ROOT=path.join(__dirname,'..');
for (const l of fs.readFileSync(path.join(ROOT,'.env'),'utf8').split(/\r?\n/)){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
process.env.VYRALES_LOCAL_RUN=process.env.VYRALES_LOCAL_RUN||'1';
const F=path.join(ROOT,'netlify/functions');
const arg=process.argv.slice(2).join(':');const m=/^([0-9a-f-]{36}):(https?:\/\/.+?)(:guardar)?$/i.exec(arg);
if(!m){console.log('uso: <ep>:<url>[:guardar]');process.exit(1);}
const [ ,EP,URL,SAVE]=m;
const {getSupabaseClient}=require(F+'/_supabase');const VF=require(F+'/_voice_full');const {tightenSpeech,wavSeconds}=require(F+'/_tts');
const {uploadFile}=require(F+'/_storage');const {download,run}=require(F+'/_render');
(async()=>{const sb=getSupabaseClient();
const {data:ep}=await sb.from('episodes').select('*').eq('id',EP).single();
const {data:se}=await sb.from('series').select('*').eq('id',ep.series_id).single();
const cfg=(se.story_bible||{}).narration||{};
const text=VF.voiceText(ep);const nW=text.split(/\s+/).filter(Boolean).length;
const raw=Buffer.from(await (await fetch(URL)).arrayBuffer());
console.log('voz descargada:',wavSeconds(raw).toFixed(1),'s ·',nW,'palabras en el guion');
const rep=await VF.repeatedPhrase(raw,text,console.log);
console.log(rep?('⚠ REPITE una frase: "'+rep+'"'):'repeticiones: ninguna ✅');
const wav=VF.shortPauses(tightenSpeech(raw,console.log));const seconds=Math.round(wavSeconds(wav)*100)/100;
console.log('voz procesada (pausas cortas):',seconds,'s');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vy-vi-'));const f=path.join(dir,'v.wav');fs.writeFileSync(f,wav);
const spans=await VF.speechSpans(f,seconds);
const segments=VF.alignChunks(VF.textChunks(text),spans,seconds).map(x=>({text:x.text,start:Math.round(x.start*100)/100,end:Math.round(x.end*100)/100}));
const words=await require(F+'/_align').alignWords(wav,text,console.log);
console.log('palabras alineadas:',words?words.filter(w=>!w.guess).length+'/'+nW:'NO');
const voice=Object.assign({url:null,seconds,text,v:VF.VOICE_V,voice:cfg.voice||'',segments,tempo:1,one_take:true,from_url:URL,at:new Date().toISOString()},words?{words}:{});
// ¿Cada toma alcanza a cubrir su parte de la voz? (el render ralentiza máx. 25 %)
const {data:assets}=await sb.from('assets').select('*').eq('episode_id',EP).eq('kind','video_clip');
const clips={};require(F+'/_assets').latestPerShot((assets||[]).filter(a=>a.storage_path),['video_clip']).forEach(a=>{clips[a.shot_number]=a;});
const cuts=VF.shotCutsExact(voice,ep.shots||[]);const old=ep.continuity&&ep.continuity.voice?VF.shotCutsExact(ep.continuity.voice,ep.shots||[]):{};
let bad=[],slow=[],tot=0;
for(const s of (ep.shots||[]).slice().sort((a,b)=>a.n-b.n)){const c=clips[s.n];if(!c){console.log('toma',s.n,'SIN video');continue;}
 const u=/^https?:/.test(c.storage_path)?c.storage_path:(process.env.SUPABASE_URL+'/storage/v1/object/public/media/'+c.storage_path);
 let d=0;try{await run(['-hide_banner','-i',u],dir);}catch(e){const mm=String(e.stderr||'').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);if(mm)d=+mm[1]*3600+ +mm[2]*60+ +mm[3];}
 const T=cuts?cuts[s.n]:0;tot+=T;const ratio=d/T;
 if(ratio<0.75)bad.push(s.n+' (clip '+d.toFixed(1)+' s, necesita '+T.toFixed(1)+' s)');else if(ratio<1)slow.push(s.n+' ('+Math.round((1-ratio)*100)+'% más lenta)');
 }
fs.rmSync(dir,{recursive:true,force:true});
console.log('duración video con esta voz ≈',(tot/60).toFixed(2),'min');
console.log('tomas que se ralentizan un poco:',slow.length?slow.join(', '):'ninguna');
console.log(bad.length?('⚠ tomas MÁS CORTAS que su voz (no alcanzan): '+bad.join(' | ')):'todas las tomas alcanzan ✅');
if(!SAVE){console.log('SOLO REVISIÓN (sin guardar).');return;}
if(rep){console.log('NO guardo: la voz repite una frase.');process.exit(1);}
voice.url=await uploadFile(sb,{path:se.slug+'/ep'+ep.episode_number+'/voz-completa-v'+Date.now()+'.wav',buffer:wav,contentType:'audio/wav'});
const {data:fr}=await sb.from('episodes').select('continuity').eq('id',EP).single();const cont=(fr&&fr.continuity)||{};
const {data:fs2}=await sb.from('episodes').select('shots').eq('id',EP).single();
const ord=(fs2.shots||[]).slice().sort((a,b)=>a.n-b.n);const secs=VF.shotSecondsFor(voice,ord);const byN={};ord.forEach((x,i)=>{byN[x.n]=secs[i];});
await sb.from('episodes').update({shots:(fs2.shots||[]).map(x=>byN[x.n]?Object.assign({},x,{seconds:byN[x.n]}):x),continuity:Object.assign({},cont,{voice,voice_prev:cont.voice||null})}).eq('id',EP);
console.log('GUARDADA voz de una toma:',voice.url,'(la anterior quedó en voice_prev)');
})().catch(e=>{console.log('ERROR',e.message);process.exit(1);});
