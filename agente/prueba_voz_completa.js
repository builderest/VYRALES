// PRUEBA: narra TODO el texto de un episodio en UNA sola llamada de Gemini TTS (sin pedazos) y sube el WAV a media/pruebas/. No toca el episodio.
const path=require('path');const fs=require('fs');const ROOT=path.join(__dirname,'..');const EP=process.argv[2];
for (const l of fs.readFileSync(path.join(ROOT,'.env'),'utf8').split(/\r?\n/)){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
const F=path.join(ROOT,'netlify/functions');
const {getSupabaseClient}=require(F+'/_supabase');const {synthesize}=require(F+'/_tts');
(async()=>{const sb=getSupabaseClient();
const {data:ep}=await sb.from('episodes').select('*').eq('id',EP).single();
const {data:se}=await sb.from('series').select('id,story_bible').eq('id',ep.series_id).single();
const cfg=(se.story_bible||{}).narration||{};
const lineOf=(x)=>String(x.voice_part||(Array.isArray(x.dialogue)?x.dialogue:(x.dialogue?[x.dialogue]:[])).map(d=>d&&d.line).filter(Boolean).join(' ')).trim();
const text=(ep.shots||[]).slice().sort((a,b)=>a.n-b.n).map(lineOf).filter(Boolean).join(' ');
console.log('palabras',text.split(/\s+/).length,'voz',cfg.voice,'modelo',cfg.model);
const style=(cfg.style||'')+' Es UNA sola frase continua: dila de corrido, con naturalidad, sin cortes ni pausas raras; solo una pausa mínima en cada punto o coma.';
const t0=Date.now();
const r=await synthesize({text,voice:cfg.voice,style,model:cfg.model,log:console.log});
console.log('listo en',Math.round((Date.now()-t0)/1000),'s · duración',r.seconds,'s · costo',r.costUsd.toFixed(3),'· modelo',r.model);

// ¿Salió COMPLETA? Whisper local escucha el audio y lo compara con el guion palabra por palabra.
process.env.VYRALES_LOCAL_RUN=process.env.VYRALES_LOCAL_RUN||'1';
const nW=text.split(/\s+/).filter(Boolean).length;
const words=await require(F+'/_align').alignWords(r.wav,text,console.log);
if(words){const ok=words.filter(w=>!w.guess);const last=ok[ok.length-1];const lastIdx=words.lastIndexOf(last);
 const third=Math.floor(words.length/3);const rate=(a,b)=>{const x=words[a],y=words[b-1];return x&&y&&y.end>x.start?Math.round((b-a)/((y.end-x.start)/60)):0;};
 console.log('VERIFICACIÓN: '+ok.length+'/'+nW+' palabras escuchadas ('+Math.round(ok.length/nW*100)+'%) · última palabra escuchada #'+(lastIdx+1)+' de '+nW+': "'+words.slice(Math.max(0,lastIdx-5),lastIdx+1).map(w=>w.word||w.text).join(' ')+'"');
 console.log('VELOCIDAD (palabras/min): inicio '+rate(0,third)+' · medio '+rate(third,2*third)+' · final '+rate(2*third,words.length)+' (si el final es mucho más rápido, se aceleró)');
 console.log(ok.length>=nW*0.95&&lastIdx>=nW-3?'RESULTADO: COMPLETA ✅':'RESULTADO: INCOMPLETA o con huecos ⚠');
}else console.log('VERIFICACIÓN: no se pudo alinear (Whisper) — revisar a oído; duración esperada ~667 s');
const key='pruebas/voz_una_toma_'+Date.now()+'.wav';
const up=await sb.storage.from('media').upload(key,r.wav,{contentType:'audio/wav',upsert:true});
if(up.error) console.log('upload error',up.error.message); else console.log('URL',sb.storage.from('media').getPublicUrl(key).data.publicUrl);
try{const {logSpend}=require(F+'/_spend');await logSpend(sb,{seriesId:se.id,episodeId:ep.id,shotNumber:0,kind:'narration',model:'tts_'+r.model,costUsd:r.costUsd,note:'PRUEBA voz en una sola toma'});}catch(e){console.log('spend log:',e.message);}
})().catch(e=>{console.log('ERROR',e.status||'',e.message);process.exit(1);});
