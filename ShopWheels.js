// ShopWheels.js
// Roletas customizadas da loja: "Emote's Prizes" e "Soccer Skin's".
// Preço, prêmios e chances ficam SÓ aqui. O módulo injeta tudo no shared.json
// (em memória, no boot) e também faz o sorteio no servidor.

const WHEEL_SLOTS = 32;            // todas as roletas do shared.json têm 32 casas
const DUPLICATE_DUST = 20;         // dust ao cair um prêmio que o jogador já tem (igual ao EpicSpin)
// Aba "Ofertas" da loja (é a aba que existe no cliente; "Section_Wheels" não tem aba visível)
const SHOP_SECTION_ID = "Section_Offers";
const PAST = "2020-01-01T00:00:00Z";
const BULK_SUFFIX = "_x10";
const FAR_FUTURE = "2099-12-31T00:00:00Z";

// Valores copiados de uma roleta existente do shared.json (Tropical_Wheel)
const ALL_PLATFORMS = ["android", "ios", "steam", "web", "website", "xbox", "playstation", "switch"];
const WHEEL_PLATFORMS = ALL_PLATFORMS;
const OFFER_PLATFORMS = ALL_PLATFORMS;
const MIN_VERSION = "0.86";
// SEM MaxVersion: o valor "0.86" copiado da Tropical_Wheel escondia a roleta em clientes mais novos.

// Emotes ESPECIAIS (Rarity SPECIAL) não vêm de graça no começo: só saem na roleta.
const EQUAL = 5.55555556; // 100 / 18 prêmios

const WHEELS = [
  {
    id: "Emote_Prizes_Wheel_oss",
    name: "Emote's Prizes",
    description: "Win a special emote!",
    price: { currency: "gems", amount: 2000, bulkCount: 10, bulkAmount: 20000 }, // 1 giro / 10 giros
    priority: 1,
    prizes: [
      { type: "EMOTE", id: "emote_kick",                       label: "Kick",           chance: EQUAL },
      { type: "EMOTE", id: "emote_punch",                      label: "Punch",          chance: EQUAL },
      { type: "EMOTE", id: "Emote085_FirePunch",               label: "Fire Punch",     chance: EQUAL },
      { type: "EMOTE", id: "emote_hug",                        label: "Hug",            chance: EQUAL },
      { type: "EMOTE", id: "Emote055_Banana",                  label: "Banana",         chance: EQUAL },
      { type: "EMOTE", id: "Emote122_Taunt_GoldenBanana",      label: "Golden Banana",  chance: EQUAL },
      { type: "EMOTE", id: "Emote123_WaterSlideKick",          label: "Wet Kick",       chance: EQUAL },
      { type: "EMOTE", id: "Emote124_ChargedHug",              label: "Charged Hug",    chance: EQUAL },
      { type: "EMOTE", id: "Emote155_Taunt_Emote155",          label: "MrBeast Case",   chance: EQUAL },
      { type: "EMOTE", id: "Emote156_Taunt_VolleyBall",        label: "Ball",           chance: EQUAL },
      { type: "EMOTE", id: "Emote174_Invisibility",            label: "Invisibility",   chance: EQUAL },
      { type: "EMOTE", id: "Emote217_Taunt_LightningBolt",     label: "Beast Lightning",chance: EQUAL },
      { type: "EMOTE", id: "Emote218_BlockThrowAction",        label: "Toss A Block",   chance: EQUAL },
      { type: "EMOTE", id: "Emote234_SnowballThrowAction",     label: "Snowball Throw", chance: EQUAL },
      { type: "EMOTE", id: "Emote239_Taunt_SpatulaSlapAction", label: "Spatula",        chance: EQUAL },
      { type: "EMOTE", id: "Emote240_Taunt_KarateChopAction",  label: "Karate Chop",    chance: EQUAL },
      { type: "EMOTE", id: "Emote254",                         label: "Force Shield",   chance: EQUAL },
      { type: "EMOTE", id: "Emote258_Action_SprayWater",       label: "Water Spray",    chance: EQUAL }
    ]
  },
  {
    id: "Soccer_Skins_Wheel_oss",
    name: "Soccer Skin's",
    description: "Win a soccer skin!",
    price: { currency: "gems", amount: 600, bulkCount: 10, bulkAmount: 6000 }, // 1 giro / 10 giros
    priority: 2,
    // ATENÇÃO: as chances abaixo somam 80 (não 100). O sorteio normaliza (divide pelo total).
    prizes: [
      { type: "SKIN", id: "SKIN138", label: "Thomas Score",      chance: 30 },
      { type: "SKIN", id: "SKIN146", label: "Luis Baller",       chance: 9 },
      { type: "SKIN", id: "SKIN317", label: "USA Astronaut",     chance: 5 },
      { type: "SKIN", id: "SKIN319", label: "French Rex",        chance: 5 },
      { type: "SKIN", id: "SKIN321", label: "Argentinian Shark", chance: 5 },
      { type: "SKIN", id: "SKIN322", label: "Mexican Bear",      chance: 5 },
      { type: "SKIN", id: "SKIN324", label: "Senegal Lion",      chance: 5 },
      { type: "SKIN", id: "SKIN327", label: "South Korea Tiger", chance: 5 },
      { type: "SKIN", id: "SKIN328", label: "Evil Referee",      chance: 5 },
      { type: "SKIN", id: "SKIN318", label: "German Lion",       chance: 2 },
      { type: "SKIN", id: "SKIN320", label: "Spanish Boar",      chance: 2 },
      { type: "SKIN", id: "SKIN323", label: "Brazil King",       chance: 2 }
    ]
  }
];

function getWheel(id) {
  return WHEELS.find(w => w.id === id) || null;
}

// Resolve o id do item comprado => { wheel, count, cost }.
// "<id>" = 1 giro, "<id>_x10" = 10 giros. Aceita também ?count=N no item simples
// (10 giros usa o preço promocional; outras quantidades = preço unitário * N).
function resolvePurchase(itemId, queryCount) {
  let wheel = getWheel(itemId);
  let count = 1;
  if (!wheel && itemId.endsWith(BULK_SUFFIX)) {
    wheel = getWheel(itemId.slice(0, -BULK_SUFFIX.length));
    count = wheel ? wheel.price.bulkCount : 1;
  } else if (wheel) {
    const q = parseInt(queryCount);
    if (!isNaN(q) && q > 1) count = Math.min(q, 100);
  }
  if (!wheel) return null;
  const { amount, bulkCount, bulkAmount, currency } = wheel.price;
  const cost = count === bulkCount ? bulkAmount : amount * count;
  return { wheel, count, cost, currency };
}

// Sorteio ponderado. Não exige que as chances somem 100.
function rollPrize(wheel, rng = Math.random) {
  const total = wheel.prizes.reduce((s, p) => s + p.chance, 0);
  let roll = rng() * total;
  for (const p of wheel.prizes) {
    roll -= p.chance;
    if (roll < 0) return p;
  }
  return wheel.prizes[wheel.prizes.length - 1];
}

// ---------- montagem das estruturas do shared.json ----------

function buildWheelConfig(wheel) {
  const n = wheel.prizes.length;

  // distribui os prêmios pelas 32 casas em rodízio (nunca dois iguais lado a lado)
  const slotsPerPrize = new Array(n).fill(0);
  for (let i = 0; i < WHEEL_SLOTS; i++) slotsPerPrize[i % n]++;

  const wheelRewards = [];
  for (let i = 0; i < WHEEL_SLOTS; i++) {
    const idx = i % n;
    const p = wheel.prizes[idx];
    wheelRewards.push({
      RewardConfig: {
        min: 1,
        type: p.type,
        typeInfo: p.id,
        // dividido pelas casas que o prêmio ocupa => a soma por prêmio fica igual à chance definida
        chance: p.chance / slotsPerPrize[idx]
      },
      WheelPositions: [i]
    });
  }

  const flat = () => wheelRewards.map(r => ({ ...r.RewardConfig }));
  return {
    Id: wheel.id,
    Name: wheel.name,
    Description: wheel.description,
    Rewards: flat(),
    SpinnerVisuals: flat(),
    WheelRewards: wheelRewards,
    Platforms: [...WHEEL_PLATFORMS],
    MinVersion: MIN_VERSION,
    OddsDisplayMethod: "Unknown"
  };
}

function buildPurchasableItem(wheel, bulk = false) {
  return {
    Name: bulk ? wheel.id + BULK_SUFFIX : wheel.id,
    prices: [{ currency: wheel.price.currency, amount: bulk ? wheel.price.bulkAmount : wheel.price.amount }],
    SequentialPrices: [],
    analyticsPrices: [],
    rewards: [{ min: 1, type: "WHEEL", typeInfo: wheel.id, chance: 1 }],
    Source: "NewGacha"
  };
}

function buildOffer(wheel, bulk = false) {
  return {
    Name: bulk ? `${wheel.name} x${wheel.price.bulkCount}` : wheel.name,
    OfferType: "Wheel",
    Priority: wheel.priority * 2 - (bulk ? 0 : 1),
    SectionId: SHOP_SECTION_ID,
    StartDateTime: PAST,
    EndDateTime: FAR_FUTURE,
    HideEndDate: true,
    ShowRemainingPurchases: false,
    PurchasableItem: bulk ? wheel.id + BULK_SUFFIX : wheel.id,
    GachaData: { CellType: "A2", OddsDisplayMethod: "Unknown" },
    Platforms: [...OFFER_PLATFORMS],
    MinVersion: MIN_VERSION,
    Description: "",
    SetType: "Default",
    IsDisabled: false,
    ShowLandingPageWhenFree: false,
    AnalyticsTag: "",
    Important: false
  };
}

function validate(shared) {
  const emoteIds = new Set((shared.Emotes_v2 || []).map(e => e.ID));
  const skinIds = new Set((shared.Skins_v4 || []).map(s => s.SkinID));
  for (const w of WHEELS) {
    for (const p of w.prizes) {
      const ok = p.type === "EMOTE" ? emoteIds.has(p.id) : skinIds.has(p.id);
      if (!ok) throw new Error(`[ShopWheels] prêmio inexistente no shared.json: ${p.type} ${p.id} (${p.label}) em ${w.id}`);
    }
  }
}

// Idempotente: pode ser chamado mais de uma vez sem duplicar nada.
function injectIntoShared(shared) {
  validate(shared);
  const ids = new Set();
  WHEELS.forEach(w => { ids.add(w.id); ids.add(w.id + BULK_SUFFIX); });

  shared.PurchasableItems = (shared.PurchasableItems || []).filter(i => !ids.has(i.Name));
  shared.WheelsConfig.Wheels = (shared.WheelsConfig.Wheels || []).filter(w => !ids.has(w.Id));
  shared.OneStopShop.Offers = (shared.OneStopShop.Offers || []).filter(o => !ids.has(o.PurchasableItem));

  for (const w of WHEELS) {
    shared.PurchasableItems.push(buildPurchasableItem(w, false), buildPurchasableItem(w, true));
    shared.WheelsConfig.Wheels.push(buildWheelConfig(w));
    shared.OneStopShop.Offers.push(buildOffer(w, false), buildOffer(w, true));
  }

  // A aba "Ofertas" vem com a seção expirada no shared original (2025-12-30): sem isso o cliente descarta os cards.
  const section = (shared.OneStopShop.ShopSections || []).find(s => s.Id === SHOP_SECTION_ID);
  if (section) {
    section.StartTime = PAST;
    section.EndTime = FAR_FUTURE;
    section.IsDisabled = false;
  }
}

// Emotes que a conta nova já começa tendo: todos, menos os de raridade SPECIAL.
// "emote_cry" fica de fora do Emotes_v2 mas é o emote1 equipado por padrão, então entra à mão.
function getStarterEmotes(shared) {
  const ids = (shared.Emotes_v2 || []).filter(e => e.Rarity !== "SPECIAL").map(e => e.ID);
  return Array.from(new Set(["emote_cry", ...ids]));
}

module.exports = {
  WHEELS,
  DUPLICATE_DUST,
  getWheel,
  resolvePurchase,
  rollPrize,
  buildWheelConfig,
  injectIntoShared,
  getStarterEmotes
};
