// TourCreator.js - backend do TOUR CREATOR VIP (Stumble Fast). Defina TOUR_ADMIN_KEY no .env / Square Cloud.
const path=require("path"),express=require("express"),cors=require("cors"),fs=require("fs"),crypto=require("crypto"),shared=require("./shared.json");
const FILE="./tourcreator-data.json";let db={seq:1000,t:{}};try{db=JSON.parse(fs.readFileSync(FILE,"utf8"))}catch{}
const save=()=>{fs.writeFileSync(FILE,JSON.stringify(db));sync()};
const eq=(a,b)=>{a=Buffer.from(a);b=Buffer.from(b);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
// Aberto por padrão. Se quiser trancar o site, crie a variável TOUR_ADMIN_KEY no Render (o site vai pedir a senha).
const KEY=process.env.TOUR_ADMIN_KEY||"";
const admin=(q,s,n)=>!KEY||eq(String(q.get("x-tour-key")||""),KEY)?n():s.status(401).json({error:"chave inválida: senha do TOUR CREATOR incorreta"});
const router=express.Router();router.use(cors());router.use(express.json({limit:"6mb"}));
const pow=n=>{let p=2;while(p<n)p*=2;return p};
const entrants=t=>{let n=t.max;for(const k of["f1","f2"])if(t.stages[k].on)n=Math.min(n,t.stages[k].qualify);return n};
const base=q=>`${q.protocol}://${q.get("host")}`;
router.get("/",(q,s)=>s.sendFile(path.join(__dirname,"TOUR CREATOR VIP.html")));
router.get("/api/catalog",(q,s)=>s.json({maps:shared.MapsConfig.Maps.map(m=>({id:m.Id,type:m.Type})),emotes:shared.ActionEmotes.ActionEmotes.map(e=>({id:e.InternalId,key:e.Id,name:e.FriendlyName}))}));
router.get("/img/:id",(q,s)=>{const m=/^data:(image\/\w+);base64,(.+)$/.exec((db.t[q.params.id]||{}).image||"");if(!m)return s.sendStatus(404);s.type(m[1]).send(Buffer.from(m[2],"base64"))});
router.get("/api/ping",(q,s)=>admin(q,s,()=>s.json({ok:true})));
router.get("/api/live",(q,s)=>admin(q,s,()=>s.json(require("./BackendUtils").TournamentXController.tournaments.filter(t=>t.tourCreator).map(t=>({id:t.id,nameKey:t.nameKey,isEnabled:t.isEnabled,rounds:t.rounds.length})))));
router.get("/api/tournaments",(q,s)=>admin(q,s,()=>s.json(Object.values(db.t))));
router.post("/api/tournaments",(q,s)=>admin(q,s,()=>{const b=q.body||{},st=b.stages||{};
  const int=(v,a,z,d)=>Math.min(z,Math.max(a,parseInt(v)||d));
  const stage=(x={})=>({on:!!x.on,rounds:int(x.rounds,1,20,1),qualify:int(x.qualify,1,256,8),per:int(x.per,2,64,16)});
  const id=b.id&&db.t[b.id]?b.id:++db.seq,o=db.t[id]||{participants:[],status:"scheduled"};
  db.t[id]=Object.assign(o,{id,name:String(b.name||"").slice(0,60)||"Torneio",image:String(b.image||"").slice(0,5e6),start:new Date(b.start||Date.now()).toISOString(),
   hours:int(b.hours,1,168,6),teamSize:int(b.teamSize,1,4,1),max:int(b.max,2,256,32),published:b.published!==false,
   maps:(b.maps||[]).map(String).slice(0,200),emotes:(b.emotes||[]).map(Number).filter(Number.isInteger),
   stages:{f1:stage(st.f1),f2:stage(st.f2),br:{on:!!(st.br||{}).on}}});save();s.json(db.t[id])}));
router.delete("/api/tournaments/:id",(q,s)=>admin(q,s,()=>{delete db.t[q.params.id];save();s.json({ok:true})}));
router.post("/api/tournaments/:id/start",(q,s)=>admin(q,s,()=>{const t=db.t[q.params.id];if(!t)return s.sendStatus(404);
  if(t.participants.length<2)return s.status(400).json({error:"mínimo 2 inscritos"});
  t.status="running";t.startedAt=new Date().toISOString();t.published=true;
  if(t.stages.br.on){const p=t.participants.map(x=>x.name).sort(()=>Math.random()-.5),z=t.teamSize,teams=[];
   for(let i=0;i+z<=p.length;i+=z)teams.push(p.slice(i,i+z).join(" + "));
   const size=pow(Math.min(teams.length,pow(entrants(t)/z))),r0=[];
   for(let i=0;i<size/2;i++)r0.push({a:teams[i]||null,b:teams[size-1-i]||null,w:null});
   const br=[r0];for(let n=size/4;n>=1;n/=2)br.push(Array.from({length:n},()=>({a:null,b:null,w:null})));t.bracket=br;
   r0.forEach((m,i)=>{if(!m.a||!m.b)adv(t,0,i,m.a?"a":"b")})}
  save();s.json(t)}));
function adv(t,r,i,side){const m=t.bracket[r][i];m.w=m[side];const nx=t.bracket[r+1];if(nx){nx[i>>1][i%2?"b":"a"]=m.w}else t.status="finished"}
router.post("/api/tournaments/:id/match",(q,s)=>admin(q,s,()=>{const t=db.t[q.params.id],{r,m,w}=q.body||{};
  const mm=t&&t.bracket&&t.bracket[r]&&t.bracket[r][m];if(!mm||!mm.a||!mm.b||!["a","b"].includes(w))return s.status(400).json({error:"partida inválida"});
  adv(t,r,m,w);save();s.json(t)}));
// ---- integração com o TournamentXController do BackendUtils.js (join/leave/finish continuam os do jogo) ----
const IMG="Punchapalooza_Background_Image_Tournaments";
function toGame(t){const tpl=(require("./BackendUtils").TournamentXController.tournaments.find(x=>!x.tourCreator)||{}),z=t.teamSize,per=2*z,R=[];let o=1;const lv=t.maps,mk=(prog,mn,mx)=>({roundOrder:o++,maxPlayersToProgress:prog,minPlayersPerMatch:mn,maxPlayersPerMatch:mx,areLevelsRestricted:lv.length>0,permittedLevels:lv});
  for(const k of["f1","f2"]){const s=t.stages[k];if(s.on)for(let i=0;i<s.rounds;i++)R.push(mk(s.qualify,Math.min(s.per,per),s.per))}
  if(t.stages.br.on)for(let n=pow(Math.ceil(entrants(t)/z));n>=2;n/=2)R.push(mk(Math.ceil(per/2),per,per));
  const all=shared.ActionEmotes.ActionEmotes.map(e=>e.InternalId),st=new Date(t.start);
  return Object.assign(JSON.parse(JSON.stringify(tpl)),{id:t.id,type:1,isEnabled:t.published&&t.status!=="finished",startTime:st,endTime:new Date(st.getTime()+t.hours*36e5),nameKey:t.name,descriptionKey:`${z}v${z} • ${t.max} jogadores`,
   listItemBackgroundImage:IMG+"_Card",detailsPanelBackgroundImage:IMG,imageUrl:t.image?"/tourcreator/img/"+t.id:"",
   listPriority:100,minPlayers:2,maxPlayers:t.max,maxRounds:R.length,minMatchmakingSeconds:10,entryCurrencyType:"gems",entryCurrencyCost:0,entryCurrencyType2:"dust",entryCurrencyCost2:0,
   areEmotesRestricted:true,prohibitedEmotes:all.filter(i=>!t.emotes.includes(i)),rounds:R,awards:[],tourCreator:true,tourPartySize:R.length?R[0].maxPlayersPerMatch:per})}
function sync(){const TX=require("./BackendUtils").TournamentXController;TX.tournaments=TX.tournaments.filter(t=>!t.tourCreator).concat(Object.values(db.t).filter(t=>t.status!=="finished").map(toGame))}
function attach(){const TX=require("./BackendUtils").TournamentXController,join=TX.join,leave=TX.leave;sync();
  TX.join=(q,s)=>{const t=db.t[parseInt(q.params.tournamentId)],u=q.user;
    if(t&&u&&!t.participants.some(p=>p.id===u.stumbleId)){
      if(t.status==="running")return s.status(403).json({message:"inscrições encerradas"});
      if(t.participants.length>=t.max)return s.status(403).json({message:"torneio lotado"});
      t.participants.push({id:u.stumbleId,name:u.username});save()}
    return join.call(TX,q,s)};
  TX.leave=(q,s)=>{const t=db.t[parseInt(q.params.tournamentId)];if(t&&q.user&&t.status!=="running"){t.participants=t.participants.filter(p=>p.id!==q.user.stumbleId);save()}return leave.call(TX,q,s)}}
// ---- Backbone (aba Clássico): por enquanto só REGISTRA o que o jogo pede, pra gente montar as respostas certas ----
const blog=[],backbone=express.Router();
backbone.use(cors());backbone.use(express.text({type:"*/*",limit:"1mb"}));
const redact=o=>JSON.parse(JSON.stringify(o||{},(k,v)=>/token|pass|secret|jwt|auth|key|code/i.test(k)?"<oculto>":v));
backbone.use((q,s,n)=>{if(q.path==="/v1/ping")return n();let b=q.body;try{b=JSON.parse(b)}catch{b=String(b||"").slice(0,300)}
  const e={t:new Date().toISOString(),m:q.method,u:q.originalUrl,ct:q.get("content-type"),temAuth:!!q.get("authorization"),b:redact(typeof b==="object"?b:{raw:b})};
  blog.unshift(e);blog.length=Math.min(blog.length,80);console.log("[BACKBONE]",JSON.stringify(e));s.status(200).json({})});
router.get("/backbone-log",(q,s)=>s.type("application/json").send(JSON.stringify(blog,null,1)));
module.exports={router,attach,backbone};
