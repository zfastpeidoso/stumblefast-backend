// TourCreator.js - backend do TOUR CREATOR VIP (Stumble Fast). Defina TOUR_ADMIN_KEY no .env / Square Cloud.
const express=require("express"),cors=require("cors"),fs=require("fs"),crypto=require("crypto"),shared=require("./shared.json");
const FILE="./tourcreator-data.json";let db={seq:1000,t:{}};try{db=JSON.parse(fs.readFileSync(FILE,"utf8"))}catch{}
const save=()=>fs.writeFileSync(FILE,JSON.stringify(db));
const eq=(a,b)=>{a=Buffer.from(a);b=Buffer.from(b);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const admin=(q,s,n)=>{const k=process.env.TOUR_ADMIN_KEY||"";return k&&eq(String(q.get("x-tour-key")||""),k)?n():s.status(401).json({error:"chave inválida"})};
const router=express.Router();router.use(cors());router.use(express.json({limit:"6mb"}));
const pow=n=>{let p=2;while(p<n)p*=2;return p};
const entrants=t=>{let n=t.max;for(const k of["f1","f2"])if(t.stages[k].on)n=Math.min(n,t.stages[k].qualify);return n};
const base=q=>`${q.protocol}://${q.get("host")}`;
router.get("/api/catalog",(q,s)=>s.json({maps:shared.MapsConfig.Maps.map(m=>({id:m.Id,type:m.Type})),emotes:shared.ActionEmotes.ActionEmotes.map(e=>({id:e.InternalId,key:e.Id,name:e.FriendlyName}))}));
router.get("/img/:id",(q,s)=>{const m=/^data:(image\/\w+);base64,(.+)$/.exec((db.t[q.params.id]||{}).image||"");if(!m)return s.sendStatus(404);s.type(m[1]).send(Buffer.from(m[2],"base64"))});
router.get("/api/ping",(q,s)=>admin(q,s,()=>s.json({ok:true})));
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
// ---- rotas do JOGO (substituem TournamentXController.getActive/join/leave) ----
function toGame(t,q){const z=t.teamSize,per=2*z,levels=t.maps,R=[];let o=1;
  for(const k of["f1","f2"]){const s=t.stages[k];if(!s.on)continue;for(let i=0;i<s.rounds;i++)R.push({RoundOrder:o++,MaxPlayersToProgress:s.qualify,MinPlayersPerMatch:Math.min(s.per,per),MaxPlayersPerMatch:s.per,AreLevelsRestricted:levels.length>0,PermittedLevels:levels})}
  if(t.stages.br.on)for(let n=pow(Math.ceil(entrants(t)/z));n>=2;n/=2)R.push({RoundOrder:o++,MaxPlayersToProgress:Math.ceil(per/2),MinPlayersPerMatch:per,MaxPlayersPerMatch:per,AreLevelsRestricted:levels.length>0,PermittedLevels:levels});
  const all=shared.ActionEmotes.ActionEmotes.map(e=>e.InternalId),st=new Date(t.start);
  const img=t.image?`${base(q)}/tourcreator/img/${t.id}`:"";
  return{Id:t.id,Type:1,IsEnabled:t.published&&t.status!=="finished",StartTime:st.toISOString(),EndTime:new Date(st.getTime()+t.hours*36e5).toISOString(),
   NameKey:t.name,DescriptionKey:`${z}v${z} • ${t.max} jogadores`,ListItemBackgroundImage:img,DetailsPanelBackgroundImage:img,
   ColourData:{DetailsPanelMainColour:"#2b1a5a",DetailsPanelBorderColour:"#ffcc00",HeaderGradientLeft:"#7a2cff",HeaderGradientRight:"#ff2c8f",InfoWidgetsGradientLeft:"#3a2a8a",InfoWidgetsGradientRight:"#5a2a9a",InfoWidgetsBorderColour:"#ffcc00"},
   ListPriority:100,MinPlayers:2,MaxPlayers:t.max,MaxRounds:R.length,MinMatchmakingSeconds:10,EntryCurrencyType:"",EntryCurrencyCost:0,EntryCurrencyType2:"",EntryCurrencyCost2:0,
   AreEmotesRestricted:true,ProhibitedEmotes:all.filter(i=>!t.emotes.includes(i)),Rounds:R,Awards:[],SeasonXPAwards:[],OtherAwards:[]}}
const who=q=>{const u=q.user||{},n=u.Username||u.username||u.Name||u.name||(q.body||{}).username||"Jogador";return{id:String(u.Id||u._id||u.id||u.StumbleId||n),name:String(n)}};
const getActive=(q,s)=>s.json({AreAdditionalTournamentsVersionRestricted:false,UserActiveTournaments:Object.values(db.t).filter(t=>t.published&&t.status!=="finished").map(t=>toGame(t,q))});
const join=(q,s)=>{const t=db.t[q.params.tournamentId],u=who(q);if(!t||t.status==="finished")return s.sendStatus(404);
  if(!t.participants.some(p=>p.id===u.id)){if(t.status==="running"||t.participants.length>=t.max)return s.status(403).json({error:"inscrições encerradas"});t.participants.push(u);save()}
  s.json({MatchmakerTag:`tourx_${t.id}`,EntryToken:crypto.randomBytes(12).toString("hex")})};
const leave=(q,s)=>{const t=db.t[q.params.tournamentId],u=who(q);if(t&&t.status!=="running"){t.participants=t.participants.filter(p=>p.id!==u.id);save()}s.json({})};
module.exports={router,getActive,join,leave};
