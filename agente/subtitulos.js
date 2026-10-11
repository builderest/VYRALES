// Subtítulos CC ES/EN del documental largo: "subtitulos:<ep>[:<videoId de YouTube>]". Sin videoId usa el del último
// video subido (publish_package.video_id). Arma las pistas y, si hay video, las sube a YouTube ($0).
const path=require('path');const fs=require('fs');const ROOT=path.join(__dirname,'..');
for (const l of fs.readFileSync(path.join(ROOT,'.env'),'utf8').split(/\r?\n/)){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
process.env.VYRALES_LOCAL_RUN=process.env.VYRALES_LOCAL_RUN||'1';
const F=path.join(ROOT,'netlify/functions');
(async()=>{const [epId,vid0]=process.argv.slice(2);
const sb=require(F+'/_supabase').getSupabaseClient();
const {data:ep}=await sb.from('episodes').select('*').eq('id',epId).single();
const C=require(F+'/_captions');
const subs=await C.ensureSubtitles(sb,ep,console.log);
const vid=vid0||(((ep.validator_report||{}).publish_package||{}).video_id);
if(!vid){console.log('Sin video de YouTube todavía: las pistas quedan guardadas y se suben al publicar.');return;}
await C.uploadSubtitles(sb,{videoId:vid,subs,log:console.log});
console.log('LISTO: subtítulos en https://youtu.be/'+vid);
})().catch(e=>{console.log('ERROR',e.message);process.exit(1);});
