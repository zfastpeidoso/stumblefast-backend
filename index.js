require("dotenv").config();
const express = require("express");
const Console = require("./ConsoleUtils");
const CryptoUtils = require("./CryptoUtils");
const bodyParser = require('body-parser');
const AntiCheat = require('./AntiCheatUtils');
const { handlePartyUpdate } = require("./BeastRoomUtils");

const {
  BackendUtils,
  UserModel,
  UserController,
  RoundController,
  BattlePassController,
  EconomyController,
  AnalyticsController,
  FriendsController,
  NewsController,
  MissionsController,
  TournamentXController,
  MatchmakingController,
  TournamentController,
  SocialController,
  EventsController,
  CheatController,
  CreatorCodeController,
  authenticate,
  errorControll,
  sendShared,
  OnlineCheck,
  VerifyPhoton,
  getAppId,
  sendADM,
  Database,
  database
} = require("./BackendUtils");
const Bracket = require("./BracketUtils");
Bracket.init({ database, UserModel, Console, TournamentXController });

const app = express();
const Title = "StumbleBeast";
const PORT = process.env.PORT || 80;
const IsMaintenanceActive = false;
app.use(express.text({ type: "*/*" }));
app.use((req, res, next) => {
  if (typeof req.body === "string") {
    try {
      req.body = JSON.parse(req.body);
    } catch {
    }
  }
  next();
});
app.post("/party/update", handlePartyUpdate);
app.use(express.json());
/* app.use((req, res, next) => {
    if (req.path.startsWith('/') && req.path.length > 50) {
        try {
            const pathWithoutSlash = req.path.slice(1);
            let base64 = Buffer.from(pathWithoutSlash, 'utf8').toString('base64');
            const encryptedPath = base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            req.url = '/' + encryptedPath;
        } catch (e) {
          
        }
    }
    next();
}); */


app.use((req, res, next) => {
 
  if (IsMaintenanceActive) {
    return res.status(503).json({
        status: "Maintenance",
        message: "servers OFF"
      });
  }

  
  next();
});
app.get('/version/get', (req, res) => {
  const version = '1.6.1';
  const encrypted = CryptoUtils.Encrypt(version);
  res.json(encrypted);
});
// CORS só para o painel (permite abrir o site de outro lugar; as rotas continuam protegidas pela x-admin-key)
app.use("/admin/bracket", (req, res, next) => {
  res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "x-admin-key, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
// painel de torneios (site) — antes do authenticate: o navegador não manda o header do jogo, usa x-admin-key
app.get("/admin/torneios", Bracket.adminPage);
app.get("/admin/bracket/list", Bracket.adminList);
app.get("/admin/bracket/view/:bracketId", Bracket.adminBracket);
app.post("/admin/bracket/create", Bracket.adminCreate);
app.post("/admin/bracket/toggle", Bracket.adminToggle);
app.post("/admin/bracket/delete", Bracket.adminDelete);
app.post("/admin/bracket/resolve", Bracket.adminResolve);
app.use(authenticate);


app.post("/photon/auth", VerifyPhoton);
app.get("/photon/get", getAppId);
app.get("/onlinecheck", OnlineCheck);
app.get("/matchmaking/filter", MatchmakingController.getMatchmakingFilter);
app.post('/user/login', UserController.login);
app.get('/user/config', sendShared);
app.get('/usersettings', UserController.getSettings);
app.post('/user/updateusername', UserController.updateUsername);
app.post('/user/update', UserController.updateUsername);
app.put('/user/v2/updateusername', UserController.updateUsername);
app.get('/user/deleteaccount', UserController.deleteAccount);
app.post('/user/linkplatform', UserController.linkPlatform);
app.post('/user/unlinkplatform', UserController.unlinkPlatform);
app.get("/shared/:version/:type", sendShared);
app.post('/user/profile', UserController.getProfile);
app.post('/user-equipped-cosmetics/update', UserController.updateCosmetics);
app.post('/user/cosmetics/addskin', UserController.addSkin);
app.post('/user/inventory/selection', UserController.setEquippedCosmetic);
app.get('/round/finish/:round', RoundController.finishRound);
app.get('/round/finishv2/:round', RoundController.finishRound);
app.post("/round/finish/v3/:region/:appid/:jwt", RoundController.finishRound)
app.post('/round/customroundfinish/:region/:appid/:naosei', RoundController.finishCustomRound);
app.post('/round/finish/v4/:round', RoundController.finishRoundV4);
app.post('/round/eventfinish/v4/:round', RoundController.finishRoundV4);
app.post('/round/eventfinish/v3/:region/:appid/:jwt/:eventId', RoundController.finishEventRoundV3);
app.get('/battlepass', BattlePassController.getBattlePass);
app.post('/battlepass/claimv3', BattlePassController.claimReward);
app.get('/battlepass/purchasev2', BattlePassController.purchaseBattlePass);
app.post('/battlepass/complete', BattlePassController.completeBattlePass);
app.get('/economy/purchase/:item', EconomyController.purchase); 
app.get('/economy/purchasegacha/:itemId/:count', EconomyController.purchaseGasha); 
app.get('/economy/purchaseluckyspin', EconomyController.purchaseLuckySpin); 
app.get('/economy/purchasedrop/:itemId/:count', EconomyController.purchaseDrop); 
app.post('/economy/purchaseluckyspinwheel', EconomyController.purchaseLuckySpinWheel);
app.post('/economy/purchaseepicspin', EconomyController.purchaseEpicSpinWheel);
app.post('/economy/:currencyType/give/:amount', EconomyController.giveCurrency); 
app.get('/missions', MissionsController.getMissions);
app.post('/missions/:missionId/rewards/claim/v2', MissionsController.claimMissionReward);
app.post('/missions/objective/:objectiveId/:milestoneId/rewards/claim/v2', MissionsController.claimMilestoneReward);
app.post('/friends/request/accept', FriendsController.add);
app.delete('/friends/:UserId', FriendsController.remove);
app.get('/friends', FriendsController.list);
app.post('/friends/search', FriendsController.search);
app.post('/friends/request', FriendsController.request);
app.post('/friends/accept', FriendsController.accept);
app.post('/friends/request/decline', FriendsController.reject);
app.post('/friends/cancel', FriendsController.cancel);
app.get('/friends/request', FriendsController.pending);
app.get("/game-events/me", EventsController.getActive);
app.post("/game-events/join/", EventsController.join);
app.get("/user/news", NewsController.GetNews);
app.post('/analytics', AnalyticsController.analytic);
app.get('/highscore/:type/list/', UserController.getHighscore);
app.get("/social/interactions", SocialController.getInteractions);
app.post("/user/cheat", CheatController.reportCheat);
app.get("/admin/anticheat/reports", CheatController.listReports);
app.post("/admin/anticheat/ban", CheatController.banUser);
app.post("/admin/anticheat/unban", CheatController.unbanUser);
app.post("/admin/anticheat/review", CheatController.reviewReport);
app.post("/user/creator-codes", CreatorCodeController.support);
app.get("/user/creator-codes", CreatorCodeController.getCreator);
app.get("/admin/autorizados", sendADM);
app.get("/tournamentx/active", TournamentXController.getActive);
app.get("/tournamentx/active/v2", TournamentXController.getActive);
app.get("/tournamentx/seasons", TournamentXController.getSeasons);
app.get("/tournamentx/season/:seasonId/progress", TournamentXController.getSeasonProgress);
app.post("/tournamentx/season/:seasonId/claim/:awardId", TournamentXController.claimSeasonReward);
const tid = (req) => parseInt(req.params.tournamentId);
const joinH = (req, res) => (Bracket.isBracket(tid(req)) ? Bracket.join(req, res) : TournamentXController.join(req, res));
const leaveH = (req, res) => (Bracket.isBracket(tid(req)) ? Bracket.leave(req, res) : TournamentXController.leave(req, res));
app.post("/tournamentx/:tournamentId/join", joinH);
app.post("/tournamentx/:tournamentId/join/v2", joinH);
app.post("/tournamentx/:tournamentId/leave", leaveH);
app.post("/tournamentx/:tournamentId/leave/v2", leaveH);
app.post("/round/tournament/finish/v2", (req, res) =>
  Bracket.isBracket(parseInt(req.body && req.body.TournamentId)) ? Bracket.finish(req, res) : TournamentXController.finish(req, res));
app.get("/bracket/:tournamentId", Bracket.view);

app.get("/api/v1/ping", async (req, res) => {
  res.status(200).send("OK");
});

// rotas desconhecidas: loga para descobrirmos o que o jogo pede (ex.: aba Clássico dos Torneios)
app.use((req, res) => {
  Console.warn("404", `${req.method} ${req.originalUrl} body=${JSON.stringify(req.body || {}).slice(0, 400)}`);
  res.status(404).json({ message: "not found" });
});

app.listen(PORT, () => {
  const currentDate = new Date().toLocaleString().replace(",", " |");
  console.clear();
  console.clear();
  Console.log(`Server ${process.env.version}`, `[${Title}] | ${currentDate} | ${CryptoUtils.SessionToken()}`);
  Console.log(`Server ${process.env.version}`, `Current port ${PORT}`);
  const encrypted = CryptoUtils.Encrypt("Testing Encrypt");
  Console.log("Encrypted:", encrypted);
  Console.log("Encrypted length:", encrypted.length);
  const decrypted = CryptoUtils.Decrypt(encrypted);
  Console.log("Decrypted:", decrypted);
});
