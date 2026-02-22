// ============================================================
// 云津小馆 - 游戏引擎 & UI
// ============================================================

// ===== 全局状态 =====
let G = null;   // 游戏状态
let UI = {};     // UI交互状态

// ===== 工具函数 =====
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedRandom(options, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return options[0];
  let r = Math.random() * total;
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) return options[i];
  }
  return options[options.length - 1];
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getDish(id) { return DISH_MAP[id]; }

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

// ===== 初始化 =====
function initGame(mode) {
  G = {
    mode: mode || 'normal',  // 'normal' | 'omakase'
    phase: 'TITLE',
    day: 0, tick: 0,
    cash: CONFIG.INITIAL_CASH,
    rep: CONFIG.INITIAL_REPUTATION,
    hygiene: CONFIG.INITIAL_HYGIENE,
    inventory: {},
    semi: {'高汤':0,'红烧酱':0,'辣酱':0,'米饭':0},
    prof: {},  // dishId → count
    todayMenu: [],
    todayPack: null,
    assistant: null,
    queue: [],
    cooking: null,  // {customer, dish, semiChoice, isSub, cashBonus, repBonus, costExtra, ticksLeft}
    log: [],
    schedule: [],   // pre-generated day schedule
    stats: null,
    mainDone: false,
    asstDone: false,
    servedThisTick: false,
    cleanedThisTick: false,
    skipTicks: 0,
    custCounter: 0,
    usedNames: [],
    gameResult: null,
    maintDone: false,
    restockCount: 0,  // buyer assistant restock uses today
    usedEvents: [],   // events already triggered this game (each type once)
    previewSchedule: null, // pre-generated schedule from scout preview
  };
  DISHES.forEach(d => G.prof[d.id] = 0);
  UI = { mode: null, action: null, cookCust: null, availSemis: [], missingIngs: [] };
}

// ===== 客人生成 =====
function generateTags() {
  const num = rand(1, 2);
  const tags = [];
  for (let i = 0; i < num; i++) {
    const ok = TAG_POOL.filter(tp => {
      if (tags.includes(tp.tag)) return false;
      for (const c of TAG_CONFLICTS) {
        if (tags.includes(c[0]) && tp.tag === c[1]) return false;
        if (tags.includes(c[1]) && tp.tag === c[0]) return false;
      }
      return true;
    });
    if (ok.length === 0) break;
    const chosen = weightedRandom(ok, ok.map(t => t.weight));
    tags.push(chosen.tag);
  }
  return tags;
}

function isHardReject(gTags, dTags) {
  for (const r of HARD_REJECTS) {
    if (gTags.includes(r.guest) && dTags.includes(r.dish)) return true;
  }
  return false;
}

function isWeakConflict(gTags, dTags) {
  for (const r of WEAK_CONFLICTS) {
    if (gTags.includes(r.guest) && dTags.includes(r.dish)) return true;
  }
  return false;
}

function hasTagMatch(gTags, dTags) {
  const taste = gTags.filter(t => {
    const p = TAG_POOL.find(tp => tp.tag === t);
    return p && p.type === 'taste';
  });
  return taste.some(t => dTags.includes(t));
}

function generateCustomer() {
  const tags = generateTags();
  const menu = G.todayMenu.map(id => getDish(id));

  let orderId = null;
  if (G.mode !== 'omakase') {
    const weights = menu.map(d => {
      if (isHardReject(tags, d.tags)) return 0;
      let w = CONFIG.W_NORMAL;
      if (hasTagMatch(tags, d.tags)) w = CONFIG.W_MATCH;
      if (isWeakConflict(tags, d.tags)) w *= CONFIG.W_WEAK;
      return w;
    });
    if (weights.every(w => w === 0)) return null;
    const dish = weightedRandom(menu, weights);
    orderId = dish.id;
  }

  const avail = CUSTOMER_NAMES.filter(n => !G.usedNames.includes(n));
  const name = avail.length > 0 ? avail[rand(0, avail.length-1)] : CUSTOMER_NAMES[rand(0, CUSTOMER_NAMES.length-1)];
  G.usedNames.push(name);
  if (G.usedNames.length > 20) G.usedNames.shift();
  const patience = rand(3, 6);
  G.custCounter++;
  return {
    id: G.custCounter, name, order: orderId,
    patience, maxPatience: patience, tags,
  };
}

function generateDaySchedule() {
  // ============================================================
  // Advanced schedule generation with solvability guarantee
  // ============================================================
  let bestSched = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < 8; attempt++) {
    const sched = buildSchedule();
    const score = simulateSchedule(sched);
    if (score > bestScore) { bestScore = score; bestSched = sched; }
    if (score >= 10) break; // excellent schedule found
  }
  // Post-processing: if best schedule still bad, patch patience
  if (bestScore < 0) patchSchedulePatience(bestSched);
  // Place random tick-based events
  placeRandomEvents(bestSched);
  return bestSched;
}

// ===== Smart customer creation (tags fully random) =====
function createCustomer(menuDishes) {
  const tags = generateTags(); // fully random — scout prediction stays meaningful

  let orderId = null;
  if (G.mode !== 'omakase') {
    // Normal mode: customer picks a dish based on tag weights
    const weights = menuDishes.map(d => {
      if (isHardReject(tags, d.tags)) return 0;
      let w = CONFIG.W_NORMAL;
      if (hasTagMatch(tags, d.tags)) w = CONFIG.W_MATCH;
      if (isWeakConflict(tags, d.tags)) w *= CONFIG.W_WEAK;
      return w;
    });
    if (weights.every(w => w === 0)) return null;
    const dish = weightedRandom(menuDishes, weights);
    orderId = dish.id;
  }
  // Omakase: orderId stays null — player chooses dish at cook time

  const avail = CUSTOMER_NAMES.filter(n => !G.usedNames.includes(n));
  const name = avail.length > 0 ? avail[rand(0, avail.length-1)] : CUSTOMER_NAMES[rand(0, CUSTOMER_NAMES.length-1)];
  G.usedNames.push(name);
  if (G.usedNames.length > 20) G.usedNames.shift();
  G.custCounter++;
  return { id: G.custCounter, name, order: orderId, patience: 0, maxPatience: 0, tags };
}

// ===== Wave-based schedule builder =====
function buildSchedule() {
  const menuDishes = G.todayMenu.map(id => getDish(id));
  const T = CONFIG.TICKS_PER_DAY; // 12

  // --- Step 1: Decide total customers (10-14) ---
  const totalCust = rand(10, 14);

  // --- Step 2: Create wave pattern for arrivals ---
  // Arrivals only in ticks 1-10; ticks 11-12 are buffer for finishing queue / prep
  const density = [];
  for (let t = 1; t <= T; t++) {
    if (t <= 2)       density.push(1.0);  // ramp
    else if (t <= 3)  density.push(1.5);
    else if (t <= 5)  density.push(2.0);  // peak start
    else if (t <= 7)  density.push(1.8);  // peak mid — breathing room
    else if (t <= 8)  density.push(1.5);  // peak tail
    else if (t <= 10) density.push(1.0);  // cooldown
    else              density.push(0);    // ticks 11-12: NO arrivals (buffer)
  }
  const totalDensity = density.reduce((s,v) => s+v, 0);
  // Distribute customers proportionally
  let arrivals = density.map(d => Math.round(d / totalDensity * totalCust));
  // Clamp: 0-2 per tick, ticks 11-12 forced to 0
  arrivals = arrivals.map((n, i) => (i >= 10) ? 0 : clamp(n, 0, 2));
  // Adjust total to match target (only within ticks 1-10)
  let curTotal = arrivals.reduce((s,v) => s+v, 0);
  while (curTotal < totalCust) {
    const t = rand(3, 7); // add to peak ticks
    if (arrivals[t] < 2) { arrivals[t]++; curTotal++; }
    else { const t2 = rand(0, 9); if (arrivals[t2] < 2) { arrivals[t2]++; curTotal++; } }
  }
  while (curTotal > totalCust) {
    const t = rand(7, 9); // remove from cooldown ticks
    if (arrivals[t] > 0) { arrivals[t]--; curTotal--; }
    else { const t2 = rand(0, 9); if (arrivals[t2] > 0) { arrivals[t2]--; curTotal--; } }
  }
  // --- Step 2b: Ensure at least 2 breathing ticks (0 arrivals) in ticks 1-10 ---
  let zeroCount = arrivals.slice(0, 10).filter(n => n === 0).length;
  while (zeroCount < 2) {
    // Clear a ramp/cooldown tick and redistribute to peak
    const candidates = [0, 1, 7, 8, 9].filter(t => arrivals[t] > 0);
    if (candidates.length === 0) break;
    candidates.sort((a,b) => arrivals[a] - arrivals[b]);
    const pick = candidates[0];
    // Move one customer to a peak tick that has room
    let moved = false;
    for (const pt of [3, 4, 5, 6]) {
      if (arrivals[pt] < 2) { arrivals[pt]++; moved = true; break; }
    }
    if (!moved) break;
    arrivals[pick]--;
    zeroCount = arrivals.slice(0, 10).filter(n => n === 0).length;
  }

  // --- Step 3: Generate customers ---
  const allCustomers = [];
  const sched = [];
  for (let t = 0; t < T; t++) {
    const td = { customers: [], event: null };
    for (let i = 0; i < arrivals[t]; i++) {
      const c = createCustomer(menuDishes);
      if (c) {
        c._tick = t + 1;
        td.customers.push(c);
        allCustomers.push(c);
      }
    }
    sched.push(td);
  }

  // --- Step 4: Balance dish distribution (normal mode only) ---
  if (G.mode !== 'omakase') {
    // Count orders per dish; redistribute if any dish is over-represented (>40%)
    const orderCount = {};
    G.todayMenu.forEach(id => orderCount[id] = 0);
    allCustomers.forEach(c => orderCount[c.order] = (orderCount[c.order]||0) + 1);
    const maxPerDish = Math.ceil(allCustomers.length * 0.4);
    for (const c of allCustomers) {
      if (orderCount[c.order] > maxPerDish) {
        // Reassign to the least-ordered compatible dish
        const sorted = G.todayMenu
          .filter(id => !isHardReject(c.tags, getDish(id).tags))
          .sort((a,b) => (orderCount[a]||0) - (orderCount[b]||0));
        if (sorted.length > 0 && sorted[0] !== c.order) {
          orderCount[c.order]--;
          c.order = sorted[0];
          orderCount[c.order] = (orderCount[c.order]||0) + 1;
        }
      }
    }
  }

  // --- Step 5: Assign patience (dish-time-aware + position-calibrated) ---
  for (const c of allCustomers) {
    const tickPos = c._tick;
    const remaining = T - tickPos + 1; // ticks left in the day

    // Base patience by dish time: 2T dishes need more patience
    let baseMin, baseMax;
    if (G.mode === 'omakase') {
      // Omakase: no order, use general range (player decides dish)
      baseMin = 4; baseMax = 6;
    } else {
      const dish = getDish(c.order);
      const dishTime = dish.time;
      if (dishTime >= 2) { baseMin = 5; baseMax = 7; }
      else               { baseMin = 4; baseMax = 6; }
    }

    // Late arrivals: cap patience to what's useful (no point having patience > remaining ticks)
    baseMax = Math.min(baseMax, remaining);
    baseMin = Math.min(baseMin, baseMax);
    baseMin = Math.max(baseMin, 3); // absolute floor

    c.patience = rand(baseMin, baseMax);
    c.maxPatience = c.patience;
    delete c._tick;
  }

  // --- Step 6: Create 1 "crunch window" (dilemma moment) ---
  // Find a tick with 2 arrivals and set one customer's patience tight
  let crunchCount = 0;
  for (let t = 0; t < sched.length && crunchCount < 1; t++) {
    if (sched[t].customers.length === 2 && t >= 2 && t <= 7) {
      // Make one of the two have tight patience → forces prioritization
      const target = sched[t].customers[rand(0, 1)];
      if (target.patience > 4) {
        target.patience = 4;
        target.maxPatience = 4;
        crunchCount++;
      }
    }
  }

  // --- Step 7: Prevent 3+ consecutive same-dish orders (normal mode only) ---
  if (G.mode !== 'omakase') {
    const flat = [];
    sched.forEach((td, t) => td.customers.forEach(c => flat.push({c, t})));
    for (let i = 2; i < flat.length; i++) {
      if (flat[i].c.order === flat[i-1].c.order && flat[i-1].c.order === flat[i-2].c.order) {
        const others = menuDishes.filter(d => d.id !== flat[i].c.order && !isHardReject(flat[i].c.tags, d.tags));
        if (others.length > 0) flat[i].c.order = others[rand(0, others.length-1)].id;
      }
    }
  }

  return sched;
}

// ===== Multi-strategy schedule evaluation =====
// Simulates 3 strategies and returns the best score
function simulateSchedule(sched) {
  const scores = [
    greedySim(sched, 'urgent'),  // always serve most urgent
    greedySim(sched, 'fast'),    // always serve fastest dish
    greedySim(sched, 'mixed'),   // alternate between urgent and fast
  ];
  return Math.max(...scores);
}

function greedySim(sched, strategy) {
  let queue = []; // {patience, time, id}
  let served = 0, left = 0;
  let cookingTicks = 0; // remaining ticks for a 2T dish
  // Omakase: assume player picks fastest available dish (1T optimistic)
  const defaultDishTime = G.mode === 'omakase' ? 1 : null;

  for (let t = 0; t < sched.length; t++) {
    // Arrivals
    for (const c of sched[t].customers) {
      const dishTime = c.order ? getDish(c.order).time : defaultDishTime;
      queue.push({ patience: c.patience, time: dishTime || 1, id: c.id });
    }
    // Patience decay
    queue.forEach(q => q.patience--);
    // Leave
    const before = queue.length;
    queue = queue.filter(q => q.patience > 0);
    left += before - queue.length;

    // Auto-complete multi-tick cooking
    if (cookingTicks > 0) { cookingTicks--; if (cookingTicks === 0) served++; continue; }

    // Skip event ticks
    if (sched[t].event) continue;

    // Serve
    if (queue.length > 0) {
      if (strategy === 'urgent') {
        queue.sort((a,b) => a.patience - b.patience);
      } else if (strategy === 'fast') {
        queue.sort((a,b) => a.time - b.time || a.patience - b.patience);
      } else { // mixed
        if (t % 2 === 0) queue.sort((a,b) => a.patience - b.patience);
        else queue.sort((a,b) => a.time - b.time || a.patience - b.patience);
      }
      const chosen = queue.shift();
      if (chosen.time >= 2) { cookingTicks = chosen.time - 1; } // multi-tick
      else { served++; }
    }
  }
  // Score: reward serving, heavily penalize departures
  return served * 2 - left * 5;
}

// ===== Patch: if schedule is still too hard, increase patience of at-risk customers =====
function patchSchedulePatience(sched) {
  // Find customers that leave in greedy sim and bump their patience +1
  let queue = [];
  const leaveIds = new Set();
  for (let t = 0; t < sched.length; t++) {
    for (const c of sched[t].customers) {
      queue.push({ patience: c.patience, id: c.id });
    }
    queue.forEach(q => q.patience--);
    for (const q of queue) { if (q.patience <= 0) leaveIds.add(q.id); }
    queue = queue.filter(q => q.patience > 0);
    if (queue.length > 0) { queue.sort((a,b) => a.patience - b.patience); queue.shift(); }
  }
  // Bump patience for at-risk customers
  for (const td of sched) {
    for (const c of td.customers) {
      if (leaveIds.has(c.id)) { c.patience = Math.min(c.patience + 1, 7); c.maxPatience = c.patience; }
    }
  }
}

// ===== Random event placement =====
function rollTodayEvents() {
  // Determine which events trigger today
  const available = EVENT_TYPES.filter(e => !G.usedEvents.includes(e.type));
  if (available.length === 0) return [];

  const today = [];
  if (EVENT_TEST_MODE && G.day <= 2) {
    // TEST MODE: force 2 events per day on Day 1-2
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const count = Math.min(2, shuffled.length);
    for (let i = 0; i < count; i++) today.push(shuffled[i]);
  } else {
    // Normal mode: each unused event has ~25% chance per day
    for (const e of available) {
      if (Math.random() < 0.25) today.push(e);
    }
    // Cap at 2 events per day
    while (today.length > 2) today.pop();
  }
  return today;
}

function placeRandomEvents(sched) {
  const todayEvents = rollTodayEvents();
  for (const evt of todayEvents) {
    G.usedEvents.push(evt.type);
    if (evt.type === 'SHORTAGE') G._shortageToday = true; // flag for startRushHour
    if (evt.timing === 'tick') {
      // Place at a random tick (prefer mid-range: tick 4-10)
      const candidates = [];
      for (let t = 3; t <= 9; t++) {
        if (!sched[t].event) candidates.push(t);
      }
      if (candidates.length === 0) {
        for (let t = 0; t < sched.length; t++) { if (!sched[t].event) candidates.push(t); }
      }
      if (candidates.length > 0) {
        const pick = candidates[rand(0, candidates.length-1)];
        sched[pick].event = { type: evt.type };
      }
    }
    // rush_start events (SHORTAGE) handled in startRushHour
  }
}

function triggerRushStartEvents() {
  // Check if SHORTAGE was rolled for today
  if (!G.usedEvents.includes('SHORTAGE')) return;
  // Only trigger if it was rolled THIS day (check if it was just added)
  // We mark it with a flag during rollTodayEvents
  if (!G._shortageToday) return;
  delete G._shortageToday;

  // Pick a random ingredient from current inventory that has stock
  const inStock = Object.entries(G.inventory).filter(([k,v]) => v > 0);
  if (inStock.length === 0) return;
  const [item, amt] = inStock[rand(0, inStock.length-1)];

  // 50% full shortage (归零), 50% partial shortage (减半)
  if (Math.random() < 0.5) {
    G.inventory[item] = 0;
    addLog(`⚠️ 紧急断货！${item}供应中断，库存归零！`);
  } else {
    const lost = Math.ceil(amt / 2);
    G.inventory[item] = amt - lost;
    addLog(`⚠️ 供货不足！${item}到货量不足，库存 ${amt} → ${amt - lost}！`);
  }
}

// ===== 天管理 =====
function startNewGame(mode) {
  initGame(mode);
  G.day = 1;
  G.log = [];
  const modeLabel = G.mode === 'omakase' ? '【Omakase 主厨推荐模式】' : '【常规点单模式】';
  addLog(`=== 欢迎来到云津小馆！${modeLabel} ===`);
  addLog(`目标：7天内 现金≥${CONFIG.WIN_CASH} 口碑≥${CONFIG.WIN_REPUTATION} 卫生≥${CONFIG.WIN_HYGIENE}`);
  if (G.mode === 'omakase') addLog('📋 Omakase 模式：客人不点菜，由你决定上什么！');
  startNewDay();
}

function startNewDay() {
  G.tick = 0;
  G.phase = 'PLANNING';
  G.todayMenu = [];
  G.todayPack = null;
  G.assistant = null;
  G.queue = [];
  G.cooking = null;
  G.mainDone = false;
  G.asstDone = false;
  G.servedThisTick = false;
  G.cleanedThisTick = false;
  G.skipTicks = 0;
  G.maintDone = false;
  // Daily semi reset
  G.semi = {'高汤':0,'红烧酱':0,'辣酱':0,'米饭':0};
  G.restockCount = 0;
  G.stats = {
    served:0, left:0, revenue:0, repChange:0, hygChange:0,
    startCash:G.cash, startRep:G.rep, startHyg:G.hygiene
  };
  UI = { mode:null, action:null, cookCust:null, availSemis:[], missingIngs:[] };
  addLog(`\n========== Day ${G.day} ==========`);
  showScreen('planning');
  renderPlanning();
  renderStats();
}

// ===== 筹划阶段 =====
function selectPack(packId) {
  const pack = SUPPLY_PACKS.find(p => p.id === packId);
  if (!pack) return;
  // Clicking already-selected pack → deselect
  if (G.todayPack && G.todayPack.id === packId) {
    G.cash += G.todayPack.cost;
    G.todayPack = null;
    G.inventory = {};
    G.semi = {'高汤':0,'红烧酱':0,'辣酱':0,'米饭':0};
    addLog('🔄 取消了进货包');
    renderPlanning(); renderStats(); return;
  }
  // Switching from another pack → refund old first
  if (G.todayPack) {
    G.cash += G.todayPack.cost;
    addLog(`🔄 退回了 ${G.todayPack.name}`);
  }
  if (G.cash < pack.cost) { addLog('❌ 现金不足！'); renderPlanning(); return; }
  G.todayPack = pack;
  G.cash -= pack.cost;
  G.inventory = {};
  for (const [k,v] of Object.entries(pack.items)) {
    // Buyer assistant gives +20% ingredients
    G.inventory[k] = G.assistant === 'buyer' ? Math.ceil(v * 1.2) : v;
  }
  G.semi = {'高汤':0,'红烧酱':0,'辣酱':0,'米饭':0};
  addLog(`📦 选择了 ${pack.name}（花费 ${pack.cost}）`);
  if (G.assistant === 'buyer') addLog('📦 采购助手加成：所有食材 +20%');
  renderPlanning();
  renderStats();
}

function toggleMenuDish(dishId) {
  const idx = G.todayMenu.indexOf(dishId);
  if (idx >= 0) { G.todayMenu.splice(idx, 1); }
  else if (G.todayMenu.length < CONFIG.MENU_SIZE) { G.todayMenu.push(dishId); }
  renderPlanning();
}

function setAssistant(type) {
  const oldAsst = G.assistant;
  G.assistant = type;
  // Re-apply buyer bonus if pack already selected
  if (G.todayPack && (oldAsst === 'buyer' || type === 'buyer')) {
    G.inventory = {};
    for (const [k,v] of Object.entries(G.todayPack.items)) {
      G.inventory[k] = G.assistant === 'buyer' ? Math.ceil(v * 1.2) : v;
    }
  }
  renderPlanning();
}

function doMaintenance() {
  if (G.maintDone) return;
  G.hygiene = clamp(G.hygiene + CONFIG.MAINT_HYGIENE, 0, 100);
  G.maintDone = true;
  addLog(`🧹 清洁备场：卫生 +${CONFIG.MAINT_HYGIENE}`);
  renderPlanning();
  renderStats();
}

function canStartRush() {
  return G.todayPack && G.todayMenu.length === CONFIG.MENU_SIZE;
}

function startRushHour() {
  if (!canStartRush()) return;
  G.phase = 'RUSH';
  G.tick = 0;
  // Use pre-generated schedule from scout preview if available, otherwise generate fresh
  G.schedule = G.previewSchedule || generateDaySchedule();
  G.previewSchedule = null;
  addLog(`\n🔔 Day ${G.day} 午晚高峰开始！`);
  addLog(`📋 今日菜单: ${G.todayMenu.map(id=>getDish(id).name).join('、')}`);
  if (G.assistant) {
    const asstDef = ASSISTANTS.find(a => a.id === G.assistant);
    addLog(`👨‍🍳 ${asstDef ? asstDef.name : '助手'}已上岗`);
  }
  // Scout assistant: log tag info (already shown in planning)
  if (G.assistant === 'scout') {
    const tagCount = {};
    for (const tick of G.schedule) {
      for (const c of tick.customers) {
        for (const t of c.tags) {
          tagCount[t] = (tagCount[t]||0) + 1;
        }
      }
    }
    const sorted = Object.entries(tagCount).sort((a,b) => b[1]-a[1]).slice(0,3);
    if (sorted.length > 0) {
      addLog(`🔮 探子情报：今日客人标签 Top3 → ${sorted.map(([t,n])=>t+'('+n+'人)').join('、')}`);
    }
  }
  // Trigger rush-start events (SHORTAGE)
  triggerRushStartEvents();
  showScreen('rush');
  renderRush();
  renderStats();
}

// ===== Tick处理 =====
function nextTick() {
  G.tick++;
  G.mainDone = false;
  G.asstDone = false;
  G.servedThisTick = false;
  G.cleanedThisTick = false;
  UI = { mode:null, action:null, cookCust:null, availSemis:[], missingIngs:[] };

  if (G.tick > CONFIG.TICKS_PER_DAY) { endDay(); return; }

  // Skip ticks from inspection
  if (G.skipTicks > 0) {
    G.skipTicks--;
    addLog(`⏭️ Tick ${G.tick}: 停业整改中…`);
    UI.mode = 'TICK_END';
    renderRush(); renderStats();
    return;
  }

  const td = G.schedule[G.tick - 1];
  addLog(`\n--- Tick ${G.tick}/12 ---`);

  // 1. Arrivals
  for (const c of td.customers) {
    if (G.queue.length < CONFIG.MAX_QUEUE) {
      G.queue.push(c);
      const d = c.order ? getDish(c.order) : null;
      const orderText = d ? `点单:${d.name}` : '主厨推荐';
      addLog(`👤 ${c.name} 入店 | ${orderText} | 耐心:${c.patience} | 标签:${c.tags.join('/')}`);
    } else {
      addLog(`👤 ${c.name} 看到满座，走了`);
    }
  }

  // 2. Patience decay
  G.queue.forEach(c => c.patience--);

  // 3. Leave check
  const leaving = G.queue.filter(c => c.patience <= 0);
  for (const c of leaving) {
    const isPicky = c.tags.includes('挑剔') || c.tags.includes('VIP');
    const pen = isPicky ? CONFIG.LEAVE_REP_PICKY : CONFIG.LEAVE_REP;
    G.rep = clamp(G.rep + pen, 0, 100);
    G.stats.repChange += pen;
    G.stats.left++;
    addLog(`💢 ${c.name} 等不及离店！口碑 ${pen}`);
  }
  G.queue = G.queue.filter(c => c.patience > 0);

  // 4. Auto-complete cooking
  if (G.cooking) {
    G.cooking.ticksLeft--;
    if (G.cooking.ticksLeft <= 0) {
      completeCooking();
      G.mainDone = true;
      return; // afterMainAction handles assistant/tick-end
    }
  }

  // 5. Event check
  if (td.event) {
    handleEvent(td.event);
    return;
  }

  // 6. Show actions
  renderRush(); renderStats();
}

// ===== 玩家动作 =====
function actionCook() {
  if (G.mainDone || G.queue.length === 0) return;
  UI.mode = 'SELECT_COOK';
  renderRush();
}

function actionPrep() {
  if (G.mainDone) return;
  UI.mode = 'SELECT_PREP';
  renderRush();
}

function actionSoothe() {
  if (G.mainDone || G.queue.length === 0) return;
  UI.mode = 'SELECT_SOOTHE';
  renderRush();
}

function actionClean() {
  if (G.mainDone) return;
  G.hygiene = clamp(G.hygiene + CONFIG.CLEAN_AMT, 0, 100);
  G.stats.hygChange += CONFIG.CLEAN_AMT;
  G.cleanedThisTick = true;
  G.mainDone = true;
  addLog(`🧹 清洁：卫生 +${CONFIG.CLEAN_AMT}`);
  afterMainAction();
}

function selectCustomer(custId) {
  const c = G.queue.find(x => x.id === custId);
  if (!c) return;
  if (UI.mode === 'SELECT_COOK') {
    if (G.mode === 'omakase' && !c.order) {
      // Omakase: player picks which dish to serve
      UI.mode = 'OMAKASE_SELECT';
      UI.cookCust = c;
      renderRush();
    } else {
      startCookFlow(c);
    }
  }
  else if (UI.mode === 'SELECT_SOOTHE') doSoothe(c);
  else if (UI.mode === 'ASST_SOOTHE') doAsstSoothe(c);
}

function selectOmakaseDish(dishId) {
  if (!UI.cookCust) return;
  UI.cookCust.order = dishId;
  UI.mode = null;
  startCookFlow(UI.cookCust);
}

// ===== 制作出餐流程 =====
function startCookFlow(customer) {
  const dish = getDish(customer.order);
  // Check ingredients
  let missing = [];
  for (const [ing, amt] of Object.entries(dish.ingredients)) {
    if ((G.inventory[ing]||0) < amt) missing.push(ing);
  }
  if (missing.length > 0) {
    UI.mode = 'COOK_MISSING';
    UI.cookCust = customer;
    UI.missingIngs = missing;
    renderRush();
    return;
  }
  // Check semi options
  let effTime = getEffectiveTime(dish);
  let semis = [];
  for (const opt of (dish.semi||[])) {
    if (G.semi[opt.type] > 0) {
      if ((opt.speedUp && effTime > 1) || (opt.bonus)) {
        semis.push(opt);
      }
    }
  }
  if (semis.length > 0) {
    UI.mode = 'COOK_SEMI';
    UI.cookCust = customer;
    UI.availSemis = semis;
    renderRush();
    return;
  }
  // Direct cook
  executeCook(customer, null, false);
}

function getEffectiveTime(dish) {
  let t = dish.time;
  if (G.prof[dish.id] >= CONFIG.PROF_SPEED && t > 1) t--;
  return t;
}

function executeCook(customer, semiChoice, isSub) {
  const dish = getDish(customer.order);
  let effTime = getEffectiveTime(dish);
  let cashBonus = 0, repBonus = 0;
  let costExtra = isSub ? CONFIG.SUB_COST_EXTRA : 0;
  // Substitute adds +1T cooking time
  if (isSub) effTime++;

  // Deduct ingredients
  if (!isSub) {
    for (const [ing, amt] of Object.entries(dish.ingredients)) {
      G.inventory[ing] = (G.inventory[ing]||0) - amt;
    }
  } else {
    for (const [ing, amt] of Object.entries(dish.ingredients)) {
      const have = G.inventory[ing]||0;
      G.inventory[ing] = Math.max(0, have - amt);
    }
  }

  // Semi effect
  if (semiChoice) {
    G.semi[semiChoice.type]--;
    if (semiChoice.speedUp && effTime > 1) effTime = 1;
    if (semiChoice.bonus) {
      if (semiChoice.bonus.cash) cashBonus = semiChoice.bonus.cash;
      if (semiChoice.bonus.rep) repBonus = semiChoice.bonus.rep;
    }
  }

  if (effTime > 1) {
    // Multi-tick
    G.cooking = {
      customer, dish, semiChoice, isSub,
      cashBonus, repBonus, costExtra,
      ticksLeft: effTime - 1
    };
    G.mainDone = true;
    addLog(`🍳 开始制作 ${dish.name}…（还需 ${effTime-1} Tick）`);
    UI.mode = null;
    afterMainAction();
    return;
  }

  // Instant
  settleCook(customer, dish, semiChoice, isSub, cashBonus, repBonus, costExtra);
}

function completeCooking() {
  if (!G.cooking) return;
  const c = G.cooking;
  G.cooking = null; // Clear before settlement to avoid stale UI
  addLog(`🍳 ${c.dish.name} 制作完成！`);
  settleCook(c.customer, c.dish, c.semiChoice, c.isSub, c.cashBonus, c.repBonus, c.costExtra);
}

function settleCook(customer, dish, semiChoice, isSub, cashBonus, repBonus, costExtra) {
  // Remove from queue
  G.queue = G.queue.filter(c => c.id !== customer.id);

  // Cash (VIP doubles revenue)
  let revenue = dish.price - dish.cost - costExtra + cashBonus;
  const isVIP = customer.tags.includes('VIP');
  if (isVIP) revenue *= 2;
  G.cash += revenue;
  G.stats.revenue += revenue;

  // Reputation
  let rep = dish.baseRep;
  // C pack spirit bonus
  if (dish.isSpirit && G.todayPack && G.todayPack.spiritBonus) rep++;
  // Proficiency quality
  if (G.prof[dish.id] >= CONFIG.PROF_QUALITY) rep++;
  // Semi bonus
  rep += repBonus;
  // Wait penalty
  if (customer.patience <= 1) rep += CONFIG.WAIT_PENALTY;
  // Substitute penalty
  if (isSub) rep += CONFIG.SUB_PENALTY;
  // Tag match
  let matched = hasTagMatch(customer.tags, dish.tags);
  if (matched) rep += CONFIG.TAG_MATCH_REP;
  // VIP base rep +1
  if (isVIP) rep++;
  // VIP extra bonus for D09
  if (isVIP && dish.special === 'vipBonus') rep++;
  // Lobby assistant: +1 rep when rep is positive
  if (G.assistant === 'lobby' && rep > 0) {
    rep++;
  }

  G.rep = clamp(G.rep + rep, 0, 100);
  G.stats.repChange += rep;
  G.stats.served++;
  G.servedThisTick = true;

  // Hygiene from serving (kitchen assistant reduces by 1)
  const hygLoss = G.assistant === 'kitchen' ? 1 : 2;
  G.hygiene -= hygLoss;
  G.stats.hygChange -= hygLoss;

  // Proficiency (substitutes don't count)
  if (!isSub) {
    G.prof[dish.id]++;
  }
  const profCount = G.prof[dish.id];
  if (profCount === CONFIG.PROF_SPEED) addLog(`⭐ ${dish.name} 熟练度达到${CONFIG.PROF_SPEED}次，以后耗时-1！`);
  if (profCount === CONFIG.PROF_QUALITY) addLog(`⭐ ${dish.name} 熟练度达到${CONFIG.PROF_QUALITY}次，基础口碑+1！`);

  // D12 tea soothe
  if (dish.special === 'teaSoothe' && G.queue.length > 0) {
    const most = G.queue.reduce((a,b) => a.patience < b.patience ? a : b);
    most.patience++;
    addLog(`🍵 茶香安抚了 ${most.name}（耐心+1）`);
  }

  // Log
  let msg = `🍽️ 为 ${customer.name} 出餐【${dish.name}】`;
  if (isSub) msg += '（替代料）';
  if (semiChoice) msg += `（${semiChoice.type}）`;
  msg += ` | 现金+${revenue}`;
  msg += ` 口碑${rep>=0?'+':''}${rep}`;
  if (matched) msg += '（标签命中✓）';
  addLog(msg);

  G.mainDone = true;
  UI.mode = null;
  afterMainAction();
}

function cookWithSub() {
  if (!UI.cookCust) return;
  executeCook(UI.cookCust, null, true);
}

function cookRefuse() {
  if (!UI.cookCust) return;
  const c = UI.cookCust;
  G.queue = G.queue.filter(x => x.id !== c.id);
  G.rep = clamp(G.rep + CONFIG.REFUSE_REP, 0, 100);
  G.stats.repChange += CONFIG.REFUSE_REP;
  G.stats.left++;
  G.mainDone = true;
  addLog(`❌ 拒单：${c.name} 离店（口碑 ${CONFIG.REFUSE_REP}）`);
  UI.mode = null;
  afterMainAction();
}

function cookUseSemi(idx) {
  if (!UI.cookCust || !UI.availSemis[idx]) return;
  executeCook(UI.cookCust, UI.availSemis[idx], false);
}

function cookNoSemi() {
  if (!UI.cookCust) return;
  executeCook(UI.cookCust, null, false);
}

function doSoothe(customer) {
  customer.patience += CONFIG.SOOTHE_AMT;
  G.mainDone = true;
  addLog(`😊 安抚 ${customer.name}：耐心 +${CONFIG.SOOTHE_AMT}`);
  UI.mode = null;
  afterMainAction();
}

function doPrep(semiId) {
  const semi = SEMI_PRODUCTS.find(s => s.id === semiId);
  if (!semi) return;
  for (const [ing, amt] of Object.entries(semi.cost)) {
    if ((G.inventory[ing]||0) < amt) {
      addLog(`❌ ${ing}不足，无法制作${semi.name}`);
      return;
    }
  }
  for (const [ing, amt] of Object.entries(semi.cost)) {
    G.inventory[ing] -= amt;
  }
  G.semi[semi.id] += semi.yield;
  G.mainDone = true;
  addLog(`🥘 备制 ${semi.name} ×${semi.yield}`);
  UI.mode = null;
  afterMainAction();
}

// ===== 助手动作 =====
function afterMainAction() {
  if (G.assistant && !G.asstDone) {
    UI.mode = 'ASSISTANT';
    renderRush(); renderStats();
  } else {
    endTickHygiene();
  }
}

function asstSoothe() {
  if (G.asstDone || G.queue.length === 0) return;
  UI.mode = 'ASST_SOOTHE';
  renderRush();
}

function doAsstSoothe(customer) {
  customer.patience += CONFIG.LIGHT_SOOTHE;
  G.asstDone = true;
  addLog(`👨‍🍳助手安抚 ${customer.name}：耐心 +${CONFIG.LIGHT_SOOTHE}`);
  UI.mode = null;
  endTickHygiene();
}

function asstClean() {
  if (G.asstDone) return;
  G.hygiene = clamp(G.hygiene + CONFIG.LIGHT_CLEAN, 0, 100);
  G.stats.hygChange += CONFIG.LIGHT_CLEAN;
  G.cleanedThisTick = true;
  G.asstDone = true;
  addLog(`👨‍🍳助手清洁：卫生 +${CONFIG.LIGHT_CLEAN}`);
  UI.mode = null;
  endTickHygiene();
}

function asstServe() {
  // Removed — no longer available
  asstSkip();
}

function asstRestock() {
  if (G.asstDone) return;
  if (G.assistant !== 'buyer') return;
  if (G.restockCount >= BUYER_RESTOCK_MAX) {
    addLog('📦 今日补货次数已用完');
    return;
  }
  UI.mode = 'ASST_RESTOCK';
  renderRush();
}

function doAsstRestock(ingName) {
  if (G.cash < BUYER_RESTOCK_COST) {
    addLog('❌ 现金不足，无法补货');
    UI.mode = 'ASSISTANT';
    renderRush();
    return;
  }
  G.cash -= BUYER_RESTOCK_COST;
  G.inventory[ingName] = (G.inventory[ingName]||0) + BUYER_RESTOCK_AMT;
  G.restockCount++;
  G.asstDone = true;
  addLog(`📦 紧急补货：${ingName} +${BUYER_RESTOCK_AMT}（花费 ${BUYER_RESTOCK_COST}，剩余 ${BUYER_RESTOCK_MAX - G.restockCount} 次）`);
  UI.mode = null;
  endTickHygiene();
  renderStats();
}

function asstSkip() {
  G.asstDone = true;
  UI.mode = null;
  endTickHygiene();
}

// ===== Tick结束 =====
function endTickHygiene() {
  // Extra hygiene loss: queue>=5 and no clean this tick
  if (G.queue.length >= 5 && !G.cleanedThisTick) {
    G.hygiene--;
    G.stats.hygChange--;
    addLog('⚠️ 店内拥挤未清洁，卫生 -1');
  }
  G.hygiene = clamp(G.hygiene, 0, 100);
  // E: Low hygiene penalty — dirty kitchen hurts reputation
  if (G.hygiene < 40) {
    G.rep--;
    G.stats.repChange--;
    addLog('🤢 厨房脏乱，客人闻到异味，口碑 -1');
  }
  G.rep = clamp(G.rep, 0, 100);

  // Check mid-day fail
  if (G.rep <= 0) {
    G.gameResult = 'FAIL_REP';
    endGame();
    return;
  }

  UI.mode = 'TICK_END';
  renderRush(); renderStats();
}

// ===== 事件处理 =====
function handleEvent(evt) {
  UI.mode = 'EVENT';
  // Pre-roll CRITIC result so UI can display it
  if (evt.type === 'CRITIC' && evt._result === undefined) {
    if (Math.random() < 0.5) {
      evt._result = 'good';
      evt._amount = rand(2, 4);
    } else {
      evt._result = 'bad';
      evt._amount = rand(2, 4);
    }
  }
  UI.event = evt;
  renderRush(); renderStats();
}

function resolveEvent(choice) {
  const evt = UI.event;
  if (!evt) return;

  if (evt.type === 'FIRE') {
    if (choice === 'A') {
      // Extinguish = clean, can't cook
      G.hygiene = clamp(G.hygiene + 2, 0, 100);
      G.stats.hygChange += 2;
      G.cleanedThisTick = true;
      G.mainDone = true;
      addLog('🔥 灶台失火！选择灭火：卫生+2，本Tick不能出餐');
    } else {
      // Push through
      G.hygiene = clamp(G.hygiene - 6, 0, 100);
      G.rep = clamp(G.rep - 2, 0, 100);
      G.stats.hygChange -= 6;
      G.stats.repChange -= 2;
      addLog('🔥 灶台失火！硬扛出餐：卫生-6 口碑-2');
      // Player can still cook this tick
    }
  } else if (evt.type === 'INSPECTION') {
    if (choice === 'A') {
      G.skipTicks = 3;
      G.hygiene = clamp(G.hygiene + 15, 0, 100);
      G.rep = clamp(G.rep - 1, 0, 100);
      G.stats.hygChange += 15;
      G.stats.repChange -= 1;
      G.mainDone = true;
      addLog('🏛️ 食安抽检！停业整改：跳过3个Tick，卫生+15，口碑-1');
    } else if (choice === 'B') {
      G.cash -= 200;
      G.mainDone = false; // player can still act
      addLog('🏛️ 食安抽检！交罚款：现金-200');
    } else {
      G.cash -= 120;
      if (G.hygiene < 50) {
        G.rep = clamp(G.rep - 5, 0, 100);
        G.stats.repChange -= 5;
        addLog('🏛️ 食安抽检！行贿：现金-120，卫生不达标被传出去 口碑-5');
      } else {
        addLog('🏛️ 食安抽检！行贿：现金-120');
      }
    }
  } else if (evt.type === 'SHORTAGE') {
    // SHORTAGE is handled at rush start; this is a fallback
    const item = evt.item || '香料';
    G.inventory[item] = 0;
    addLog(`⚠️ 紧急断货！${item}供应中断，库存归零`);
  } else if (evt.type === 'CRITIC') {
    // 美食博主探店 — result was pre-rolled in handleEvent
    if (evt._result === 'good') {
      G.rep = clamp(G.rep + evt._amount, 0, 100);
      G.stats.repChange += evt._amount;
      addLog(`📝 美食博主探店！发了一篇好评：口碑+${evt._amount}`);
    } else {
      G.rep = clamp(G.rep - evt._amount, 0, 100);
      G.stats.repChange -= evt._amount;
      addLog(`📝 美食博主探店！发了一篇差评：口碑-${evt._amount}`);
    }
  }

  UI.mode = null;
  UI.event = null;

  if (evt.type === 'FIRE' && choice === 'A') {
    afterMainAction();
  } else if (evt.type === 'INSPECTION' && choice === 'A') {
    afterMainAction();
  } else if (evt.type === 'INSPECTION' && choice === 'PASS') {
    renderRush(); renderStats();
  } else {
    renderRush(); renderStats();
  }
}

// ===== 天结束 =====
function endDay() {
  // Auto-complete any in-progress cooking before settlement
  if (G.cooking) {
    addLog(`🍳 打烊前完成了 ${G.cooking.dish.name}！`);
    const c = G.cooking;
    G.cooking = null;
    settleCook(c.customer, c.dish, c.semiChoice, c.isSub, c.cashBonus, c.repBonus, c.costExtra);
  }
  G.phase = 'DAY_END';
  const s = G.stats;
  addLog(`\n=== Day ${G.day} 打烊结算 ===`);
  addLog(`🍽️ 出餐 ${s.served} 份 | 💢 离店 ${s.left} 人`);
  addLog(`💰 现金 ${s.startCash} → ${G.cash}（收入 ${s.revenue}）`);
  addLog(`⭐ 口碑 ${s.startRep} → ${G.rep}（变化 ${s.repChange>=0?'+':''}${s.repChange}）`);
  addLog(`🧹 卫生 ${s.startHyg} → ${G.hygiene}`);

  // Check fail
  if (G.cash < 0) { G.gameResult = 'FAIL_CASH'; endGame(); return; }
  if (G.rep <= 0) { G.gameResult = 'FAIL_REP'; endGame(); return; }

  // Check win (day 7)
  if (G.day >= CONFIG.TOTAL_DAYS) {
    if (G.cash >= CONFIG.WIN_CASH && G.rep >= CONFIG.WIN_REPUTATION && G.hygiene >= CONFIG.WIN_HYGIENE) {
      G.gameResult = 'WIN';
    } else {
      G.gameResult = 'FAIL_TARGET';
    }
    endGame();
    return;
  }

  showScreen('dayend');
  renderDayEnd();
  renderStats();
}

function goNextDay() {
  G.day++;
  startNewDay();
}

function endGame() {
  G.phase = 'GAME_OVER';
  showScreen('gameover');
  renderGameOver();
}

function restartGame() {
  showScreen('title');
}

// ===== UI 工具 =====
function addLog(msg) {
  G.log.push(msg);
  // Keep last 200
  if (G.log.length > 200) G.log = G.log.slice(-200);
}

function showScreen(name) {
  $$('.screen').forEach(s => s.classList.add('hidden'));
  const el = $(`#screen-${name}`);
  if (el) el.classList.remove('hidden');
  // Stats bar
  const sb = $('#stats-bar');
  if (name === 'title') sb.classList.add('hidden');
  else sb.classList.remove('hidden');
}

// ===== 渲染：统计栏 =====
function renderStats() {
  if (!G) return;
  $('#stat-day').textContent = `Day ${G.day}`;
  $('#stat-tick').textContent = G.phase === 'RUSH' ? `Tick ${G.tick}/12` : '';
  $('#stat-cash').innerHTML = `💰 ${G.cash}`;
  $('#stat-rep').innerHTML = `⭐ ${G.rep}`;
  $('#stat-hyg').innerHTML = `🧹 ${G.hygiene}`;

  // Color coding
  $('#stat-cash').className = G.cash >= CONFIG.WIN_CASH ? 'stat-good' : G.cash < 300 ? 'stat-bad' : '';
  $('#stat-rep').className = G.rep >= CONFIG.WIN_REPUTATION ? 'stat-good' : G.rep < 20 ? 'stat-bad' : '';
  $('#stat-hyg').className = G.hygiene >= CONFIG.WIN_HYGIENE ? 'stat-good' : G.hygiene < 30 ? 'stat-bad' : '';
}

// ===== 渲染：筹划阶段 =====
function renderPlanning() {
  const el = $('#planning-content');
  const modeTag = G.mode === 'omakase' ? ' <span class="mode-badge oma-badge">Omakase</span>' : '';
  let html = `<h2>📋 Day ${G.day} — 开门筹划${modeTag}</h2>`;

  // Step 1: Pack
  html += `<div class="plan-section"><h3>1. 选择今日进货包</h3><div class="pack-grid">`;
  for (const p of SUPPLY_PACKS) {
    const selected = G.todayPack && G.todayPack.id === p.id;
    const affordable = G.cash >= p.cost || selected;
    html += `<div class="pack-card ${selected?'selected':''} ${!affordable?'unaffordable':''}"
      onclick="selectPack('${p.id}')">
      <div class="pack-name">${p.name}</div>
      <div class="pack-cost">💰 ${p.cost}</div>
      <div class="pack-desc">${p.desc}</div>
      ${p.spiritBonus?'<div class="pack-bonus">✨ 灵材菜口碑+1</div>':''}
    </div>`;
  }
  html += `</div></div>`;

  // Step 2: Menu
  html += `<div class="plan-section"><h3>2. 设置今日菜单（${G.todayMenu.length}/${CONFIG.MENU_SIZE}）</h3><div class="dish-grid">`;
  for (const d of DISHES) {
    const selected = G.todayMenu.includes(d.id);
    const full = G.todayMenu.length >= CONFIG.MENU_SIZE && !selected;
    // Ingredient coverage check
    let ingLine = '';
    let coverCls = '';
    if (G.todayPack) {
      const entries = Object.entries(d.ingredients);
      const parts = entries.map(([k,v]) => {
        const have = G.inventory[k] || 0;
        const ok = have >= v;
        const emoji = (typeof ING_EMOJI !== 'undefined' && ING_EMOJI[k]) ? ING_EMOJI[k] : '';
        return `<span style="color:${ok?'#4CAF50':'#e74c3c'}">${emoji}${k}×${v}</span>`;
      });
      const covCount = entries.filter(([k,v]) => (G.inventory[k]||0) >= v).length;
      if (covCount === entries.length) coverCls = 'cover-all';
      else if (covCount === 0) coverCls = 'cover-none';
      else coverCls = 'cover-partial';
      ingLine = `<div class="dish-ings">${parts.join(' ')}</div>`;
    }
    html += `<div class="dish-select-card ${selected?'selected':''} ${full?'disabled':''} ${coverCls}"
      onclick="toggleMenuDish('${d.id}')">
      <div class="dish-header">
        <span class="dish-emoji">${DISH_EMOJI[d.id]||'🍽'}</span>
        <span class="dish-name-sm">${d.name}</span>
      </div>
      <div class="dish-stats-row">
        <span>💰${d.price}</span>
        <span>成本${d.cost}</span>
        <span>⏱${d.time}T</span>
        <span>⭐+${d.baseRep}</span>
      </div>
      <div class="dish-tags-row">${d.tags.map(t=>`<span class="tag-sm" style="background:${TAG_COLORS[t]||'#999'}">${t}</span>`).join('')}</div>
      ${ingLine}
      ${ingLine && d.semi && d.semi.length > 0 ? '<hr class="dish-divider">' : ''}
      ${d.semi && d.semi.length > 0 ? '<div class="dish-semi-hint">' + d.semi.map(s => {
        let label = s.type;
        let effects = [];
        if (s.speedUp) effects.push('加速→1T');
        if (s.bonus) {
          if (s.bonus.rep) effects.push('口碑+' + s.bonus.rep);
          if (s.bonus.cash) effects.push('现金+' + s.bonus.cash);
        }
        if (effects.length === 0) effects.push('可选');
        const hEmoji = (typeof SEMI_EMOJI !== 'undefined' && SEMI_EMOJI[label]) ? SEMI_EMOJI[label] : '🍲';
        return hEmoji + label + '(' + effects.join(',') + ')';
      }).join(' ') + '</div>' : ''}
      <div class="dish-note">${d.note}</div>
      ${G.prof[d.id]>=CONFIG.PROF_SPEED?'<div class="prof-badge">🔥耗时-1</div>':''}
      ${G.prof[d.id]>=CONFIG.PROF_QUALITY?'<div class="prof-badge">⭐口碑+1</div>':''}
    </div>`;
  }
  html += `</div></div>`;

  // Step 3: Assistant
  html += `<div class="plan-section"><h3>3. 排班</h3><div class="asst-options">
    <button class="btn-asst ${G.assistant===null?'selected':''}" onclick="setAssistant(null)">不上岗</button>`;
  for (const a of ASSISTANTS) {
    html += `<button class="btn-asst ${G.assistant===a.id?'selected':''}" onclick="setAssistant('${a.id}')">
      ${a.name}<br><small>${a.passive}</small>
    </button>`;
  }
  html += `</div>`;

  // Scout preview: show tag distribution when scout selected + menu full
  if (G.assistant === 'scout' && G.todayMenu.length === CONFIG.MENU_SIZE) {
    // Pre-generate schedule for preview (will be regenerated at rush start)
    const previewSched = generateDaySchedule();
    G.previewSchedule = previewSched;
    const tagCount = {};
    let totalCust = 0;
    for (const tick of previewSched) {
      for (const c of tick.customers) {
        totalCust++;
        for (const t of c.tags) {
          tagCount[t] = (tagCount[t]||0) + 1;
        }
      }
    }
    const sorted = Object.entries(tagCount).sort((a,b) => b[1]-a[1]).slice(0,5);
    if (sorted.length > 0) {
      html += `<div class="scout-preview">
        <div class="scout-title">🔮 探子情报（预计 ${totalCust} 位客人）</div>
        <div class="scout-tags">${sorted.map(([t,n]) =>
          `<span class="scout-tag" style="background:${TAG_COLORS[t]||'#999'}">${t} ×${n}</span>`
        ).join('')}</div>
        <div class="scout-hint">💡 根据标签分布选择菜单以获得更多口碑匹配</div>
      </div>`;
    }
  }
  html += `</div>`;

  // Step 4: Maintenance
  html += `<div class="plan-section"><h3>4. 维护</h3>
    <button class="btn-maint" ${G.maintDone?'disabled':''} onclick="doMaintenance()">
      ${G.maintDone?'✅ 已清洁':'🧹 清洁备场（卫生+6）'}
    </button>
  </div>`;

  // Start button
  const ready = canStartRush();
  html += `<div class="plan-start">
    <button class="btn-start-rush ${ready?'':'disabled'}" ${ready?'':'disabled'} onclick="startRushHour()">
      🔔 开门迎客！
    </button>
    ${!ready?'<p class="hint">请先选择进货包并选满4道菜</p>':''}
  </div>`;

  el.innerHTML = html;
}

// ===== 渲染：高峰阶段 =====
function renderRush() {
  renderQueue();
  renderActions();
  renderSidePanel();
  renderLog();
}

function renderQueue() {
  const el = $('#queue-panel');
  if (G.queue.length === 0 && !G.cooking) {
    el.innerHTML = '<div class="queue-empty">暂无客人在排队</div>';
    return;
  }
  let html = '<div class="queue-title">📋 客人队列</div><div class="queue-cards">';
  for (const c of G.queue) {
    const dish = c.order ? getDish(c.order) : null;
    const patiencePct = (c.patience / c.maxPatience) * 100;
    const pColor = c.patience <= 1 ? '#e74c3c' : c.patience <= 2 ? '#f39c12' : '#27ae60';
    const selectable = (UI.mode === 'SELECT_COOK' || UI.mode === 'SELECT_SOOTHE' || UI.mode === 'ASST_SOOTHE');
    const isCooking = G.cooking && G.cooking.customer.id === c.id;
    const orderText = dish
      ? `${DISH_EMOJI[c.order]||''} ${dish.name}`
      : '🍽️ 主厨推荐';
    html += `<div class="cust-card ${selectable?'selectable':''} ${isCooking?'cooking':''}${!dish?' omakase-cust':''}"
      ${selectable?`onclick="selectCustomer(${c.id})"`:''}>
      <div class="cust-name">${c.name}</div>
      <div class="cust-order">${orderText}</div>
      <div class="cust-patience">
        <div class="patience-bar" style="width:${patiencePct}%;background:${pColor}"></div>
        <span class="patience-text">耐心 ${c.patience}/${c.maxPatience}</span>
      </div>
      <div class="cust-tags">${c.tags.map(t=>`<span class="tag" style="background:${TAG_COLORS[t]||'#999'}">${t}</span>`).join('')}</div>
    </div>`;
  }
  if (G.cooking) {
    const cd = G.cooking;
    html += `<div class="cust-card cooking">
      <div class="cust-name">${cd.customer.name}</div>
      <div class="cust-order">🍳 制作中：${cd.dish.name}</div>
      <div class="cook-progress">还需 ${cd.ticksLeft} Tick</div>
    </div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

function renderActions() {
  const el = $('#action-panel');
  let html = '';

  // If tick not started yet
  if (G.tick === 0 || UI.mode === 'TICK_END') {
    const isEnd = G.tick >= CONFIG.TICKS_PER_DAY;
    html = `<div class="action-center">
      <button class="btn-action btn-next" onclick="${isEnd?'endDay()':'nextTick()'}">
        ${G.tick===0?'▶ 开始 Tick 1':isEnd?'📊 打烊结算':`▶ 下一个 Tick (${G.tick+1}/12)`}
      </button>
    </div>`;
    el.innerHTML = html;
    return;
  }

  // Skip tick
  if (G.skipTicks > 0) {
    html = `<div class="action-center">
      <p>🚧 停业整改中…</p>
      <button class="btn-action btn-next" onclick="nextTick()">▶ 下一个 Tick</button>
    </div>`;
    el.innerHTML = html;
    return;
  }

  // Event
  if (UI.mode === 'EVENT') {
    html = renderEventActions();
    el.innerHTML = html;
    return;
  }

  // Main action
  if (!G.mainDone && UI.mode !== 'ASSISTANT' && UI.mode !== 'ASST_SOOTHE' && UI.mode !== 'ASST_RESTOCK') {
    if (UI.mode === null || UI.mode === 'SELECT_COOK' || UI.mode === 'SELECT_SOOTHE') {
      html += '<div class="action-row"><span class="action-label">主动作：</span>';
      html += `<button class="btn-action ${UI.mode==='SELECT_COOK'?'active':''}" onclick="actionCook()" ${G.queue.length===0?'disabled':''}>🍳 制作出餐</button>`;
      html += `<button class="btn-action" onclick="actionPrep()">🥘 批量备制</button>`;
      html += `<button class="btn-action ${UI.mode==='SELECT_SOOTHE'?'active':''}" onclick="actionSoothe()" ${G.queue.length===0?'disabled':''}>😊 安抚</button>`;
      html += `<button class="btn-action" onclick="actionClean()">🧹 清洁(+${CONFIG.CLEAN_AMT})</button>`;
      html += '</div>';
      if (UI.mode === 'SELECT_COOK') html += `<div class="action-hint">👆 点击一位客人${G.mode==='omakase'?'选择上菜':'进行制作'}</div>`;
      if (UI.mode === 'SELECT_SOOTHE') html += '<div class="action-hint">👆 点击一位客人进行安抚</div>';
    } else if (UI.mode === 'SELECT_PREP') {
      html += '<div class="action-row"><span class="action-label">选择备制：</span>';
      for (const sp of SEMI_PRODUCTS) {
        let canMake = true;
        for (const [ing, amt] of Object.entries(sp.cost)) {
          if ((G.inventory[ing]||0) < amt) canMake = false;
        }
        const spEmoji = (typeof SEMI_EMOJI !== 'undefined' && SEMI_EMOJI[sp.id]) ? SEMI_EMOJI[sp.id] : '🍲';
        html += `<button class="btn-action btn-prep" onclick="doPrep('${sp.id}')" ${canMake?'':'disabled'}>
          ${spEmoji} ${sp.name}×${sp.yield}<br><small>${sp.desc}</small>
        </button>`;
      }
      html += `<button class="btn-action btn-cancel" onclick="UI.mode=null;renderRush()">取消</button>`;
      html += '</div>';
    } else if (UI.mode === 'COOK_MISSING') {
      const c = UI.cookCust;
      const d = getDish(c.order);
      const isPicky = c.tags && c.tags.includes('挑剔');
      const subTime = getEffectiveTime(d) + 1;
      html += `<div class="action-row event-actions"><span class="action-label">⚠️ 制作${d.name}缺少食材（${UI.missingIngs.join('、')}）：</span>
        <button class="btn-action btn-warn" onclick="cookWithSub()" ${isPicky?'disabled':''}>${isPicky?'🚫 挑剔客不接受替代':'替代料（口碑-1，成本+1，耗时→'+subTime+'T，不计熟练度）'}</button>
        <button class="btn-action btn-danger" onclick="cookRefuse()">拒单（客人离店，口碑-2）</button>
        <button class="btn-action btn-cancel" onclick="UI.mode=null;renderRush()">取消</button>
      </div>`;
    } else if (UI.mode === 'COOK_SEMI') {
      const c = UI.cookCust;
      const d = getDish(c.order);
      let effT = getEffectiveTime(d);
      html += `<div class="action-row event-actions"><span class="action-label">制作${d.name}（基础耗时${effT}T）可使用半成品：</span>`;
      UI.availSemis.forEach((opt, i) => {
        let desc = '';
        if (opt.speedUp && effT > 1) desc += '加速→1T ';
        if (opt.bonus) {
          if (opt.bonus.cash) desc += `现金+${opt.bonus.cash} `;
          if (opt.bonus.rep) desc += `口碑+${opt.bonus.rep} `;
        }
        const csEmoji = (typeof SEMI_EMOJI !== 'undefined' && SEMI_EMOJI[opt.type]) ? SEMI_EMOJI[opt.type] : '🍲';
        html += `<button class="btn-action btn-good" onclick="cookUseSemi(${i})">${csEmoji} 使用${opt.type}（${desc}）[剩${G.semi[opt.type]}]</button>`;
      });
      html += `<button class="btn-action" onclick="cookNoSemi()">不使用半成品</button>`;
      html += `<button class="btn-action btn-cancel" onclick="UI.mode=null;renderRush()">取消</button>`;
      html += '</div>';
    } else if (UI.mode === 'OMAKASE_SELECT') {
      const c = UI.cookCust;
      html += `<div class="action-row omakase-dish-row"><span class="action-label">🍽️ 为 ${c.name} 选择上菜（标签：${c.tags.join('、')}）：</span><div class="omakase-dish-grid">`;
      for (const did of G.todayMenu) {
        const d = getDish(did);
        const matched = hasTagMatch(c.tags, d.tags);
        const hardReject = isHardReject(c.tags, d.tags);
        const weakConflict = isWeakConflict(c.tags, d.tags);
        // Check ingredients
        let hasMissing = false;
        for (const [ing, amt] of Object.entries(d.ingredients)) {
          if ((G.inventory[ing]||0) < amt) hasMissing = true;
        }
        let matchHint = '';
        if (hardReject) matchHint = '<span class="oma-reject">🚫 排斥</span>';
        else if (matched) matchHint = '<span class="oma-match">✅ 匹配</span>';
        else if (weakConflict) matchHint = '<span class="oma-weak">⚠️ 弱冲突</span>';
        html += `<button class="btn-action btn-omakase-dish ${matched?'oma-good':''} ${hardReject?'oma-bad':''}" onclick="selectOmakaseDish('${d.id}')">
          <div>${DISH_EMOJI[d.id]||'🍽'} ${d.name} ⏱${d.time}T ⭐+${d.baseRep}</div>
          <div class="oma-tags">${d.tags.map(t=>`<span class="tag-sm" style="background:${TAG_COLORS[t]||'#999'}">${t}</span>`).join('')}</div>
          <div>${matchHint} ${hasMissing?'<span class="oma-missing">❌ 缺货</span>':''}</div>
        </button>`;
      }
      html += `</div><button class="btn-action btn-cancel" onclick="UI.mode='SELECT_COOK';UI.cookCust=null;renderRush()">取消</button>`;
      html += '</div>';
    }
  }

  // Cooking in progress message
  if (G.mainDone && G.cooking) {
    html += `<div class="action-hint">🍳 正在制作 ${G.cooking.dish.name}…剩余 ${G.cooking.ticksLeft} Tick</div>`;
  }

  // Assistant action
  if (UI.mode === 'ASSISTANT' || UI.mode === 'ASST_SOOTHE' || UI.mode === 'ASST_RESTOCK') {
    const asstDef = ASSISTANTS.find(a => a.id === G.assistant);
    const asstLabel = asstDef ? asstDef.name : '助手';
    html += `<div class="action-row asst-row"><span class="action-label">${asstLabel} 轻动作：</span>`;
    if (UI.mode === 'ASST_SOOTHE') {
      html += '<div class="action-hint">👆 点击一位客人进行轻安抚</div>';
      html += `<button class="btn-action btn-cancel" onclick="UI.mode='ASSISTANT';renderRush()">取消</button>`;
    } else if (UI.mode === 'ASST_RESTOCK') {
      html += '<div class="action-hint">选择要补货的食材（花费💰' + BUYER_RESTOCK_COST + '，+' + BUYER_RESTOCK_AMT + '份）：</div>';
      const allIngs = ['米','面','鸡','猪','豆腐','青菜','香料','鱼','虾','灵菇','灵葱'];
      for (const ing of allIngs) {
        if (G.todayPack && G.todayPack.items[ing] !== undefined) {
          const emoji = (typeof ING_EMOJI !== 'undefined' && ING_EMOJI[ing]) ? ING_EMOJI[ing] : '';
          const have = G.inventory[ing] || 0;
          html += `<button class="btn-action btn-prep" onclick="doAsstRestock('${ing}')" ${G.cash<BUYER_RESTOCK_COST?'disabled':''}>${emoji}${ing}(现有${have})</button>`;
        }
      }
      html += `<button class="btn-action btn-cancel" onclick="UI.mode='ASSISTANT';renderRush()">取消</button>`;
    } else {
      html += `<button class="btn-action" onclick="asstSoothe()" ${G.queue.length===0?'disabled':''}>轻安抚(+${CONFIG.LIGHT_SOOTHE})</button>`;
      if (G.assistant === 'buyer') {
        const canRestock = G.restockCount < BUYER_RESTOCK_MAX && G.cash >= BUYER_RESTOCK_COST;
        html += `<button class="btn-action" onclick="asstRestock()" ${canRestock?'':'disabled'}>📦补货(${BUYER_RESTOCK_MAX - G.restockCount}次)</button>`;
      } else {
        html += `<button class="btn-action" onclick="asstClean()">轻清洁(+${CONFIG.LIGHT_CLEAN})</button>`;
      }
      html += `<button class="btn-action btn-cancel" onclick="asstSkip()">跳过</button>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

function renderEventActions() {
  const evt = UI.event;
  let html = '<div class="event-box">';
  if (evt.type === 'FIRE') {
    html += `<div class="event-title">🔥 灶台失火！</div>
      <div class="event-desc">灶台突然起火，需要立即处理！</div>
      <div class="event-choices">
        <button class="btn-action btn-good" onclick="resolveEvent('A')">A. 立刻灭火（卫生+2，不能出餐）</button>
        <button class="btn-action btn-danger" onclick="resolveEvent('B')">B. 硬扛出餐（卫生-6，口碑-2）</button>
      </div>`;
  } else if (evt.type === 'INSPECTION') {
    const passable = G.hygiene >= 60;
    html += `<div class="event-title">🏛️ 城主府食安抽检！</div>
      <div class="event-desc">官差来检查卫生了！当前卫生：${G.hygiene}${passable ? ' ✅ 达标' : ' ❌ 不达标（≥60才能通过）'}</div>
      <div class="event-choices">
        ${passable ? '<button class="btn-action btn-good" onclick="resolveEvent(\'PASS\')">✅ 检查通过！（口碑+2，不耗操作）</button>' : ''}
        <button class="btn-action btn-warn" onclick="resolveEvent('A')">A. 停业整改（跳过2Tick，卫生+15）</button>
        <button class="btn-action btn-danger" onclick="resolveEvent('B')">B. 交罚款（现金-80）</button>
        <button class="btn-action btn-danger" onclick="resolveEvent('C')">C. 行贿（现金-60${G.hygiene<50?'，卫生不达标口碑-3':''}）</button>
      </div>`;
  } else if (evt.type === 'SHORTAGE') {
    const item = evt.item || '食材';
    html += `<div class="event-title">⚠️ 紧急断货！</div>
      <div class="event-desc">${item}供应中断，库存归零！</div>
      <div class="event-choices">
        <button class="btn-action" onclick="resolveEvent('OK')">确认</button>
      </div>`;
  } else if (evt.type === 'CRITIC') {
    if (evt._result === 'good') {
      html += `<div class="event-title">📝 美食博主探店！</div>
        <div class="event-desc">博主品尝后赞不绝口，发了一篇好评！口碑+${evt._amount}</div>
        <div class="event-choices">
          <button class="btn-action btn-good" onclick="resolveEvent('OK')">太好了！</button>
        </div>`;
    } else {
      html += `<div class="event-title">📝 美食博主探店！</div>
        <div class="event-desc">博主觉得一般，发了一篇差评…口碑-${evt._amount}</div>
        <div class="event-choices">
          <button class="btn-action btn-danger" onclick="resolveEvent('OK')">唉…</button>
        </div>`;
    }
  }
  html += '</div>';
  return html;
}

function renderSidePanel() {
  const el = $('#side-panel');
  let html = '';

  // Today's menu
  html += '<div class="side-section"><div class="side-title">📋 今日菜单</div>';
  for (const id of G.todayMenu) {
    const d = getDish(id);
    let effT = getEffectiveTime(d);
    html += `<div class="menu-item">
      <span>${DISH_EMOJI[d.id]||''} ${d.name}</span>
      <span class="mi-stats">💰${d.price-d.cost} ⏱${effT}T ⭐${d.baseRep}${G.prof[d.id]>=CONFIG.PROF_QUALITY?'+1':''}</span>
    </div>`;
  }
  html += '</div>';

  // Inventory
  html += '<div class="side-section"><div class="side-title">📦 库存</div><div class="inv-grid">';
  const allIngs = ['米','面','鸡','猪','豆腐','青菜','香料','鱼','虾','灵菇','灵葱'];
  for (const ing of allIngs) {
    const amt = G.inventory[ing] || 0;
    if (amt > 0 || (G.todayPack && G.todayPack.items[ing])) {
      const emoji = (typeof ING_EMOJI !== 'undefined' && ING_EMOJI[ing]) ? ING_EMOJI[ing] : '';
      html += `<span class="inv-item ${amt===0?'empty':''}">${emoji}${ing}:${amt}</span>`;
    }
  }
  html += '</div></div>';

  // Semi-finished
  html += '<div class="side-section"><div class="side-title">🍲 半成品</div><div class="semi-grid">';
  for (const [k,v] of Object.entries(G.semi)) {
    const sEmoji = (typeof SEMI_EMOJI !== 'undefined' && SEMI_EMOJI[k]) ? SEMI_EMOJI[k] : '🍲';
    html += `<span class="semi-item ${v===0?'empty':''}">${sEmoji}${k}:${v}</span>`;
  }
  html += '</div></div>';

  // Proficiency highlights
  const profs = DISHES.filter(d => G.prof[d.id] > 0);
  if (profs.length > 0) {
    html += '<div class="side-section"><div class="side-title">📈 熟练度</div>';
    for (const d of profs) {
      const cnt = G.prof[d.id];
      const s1 = cnt >= CONFIG.PROF_SPEED ? '✅' : `${cnt}/${CONFIG.PROF_SPEED}`;
      const s2 = cnt >= CONFIG.PROF_QUALITY ? '✅' : `${cnt}/${CONFIG.PROF_QUALITY}`;
      html += `<div class="prof-item">${d.name}: ${cnt}次 (速${s1} 质${s2})</div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

function renderLog() {
  const el = $('#log-panel');
  const recent = G.log.slice(-30);
  el.innerHTML = '<div class="log-title">📜 日志</div>' +
    recent.map(m => `<div class="log-line">${m}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

// ===== 渲染：打烊 =====
function renderDayEnd() {
  const el = $('#dayend-content');
  const s = G.stats;
  let html = `<h2>📊 Day ${G.day} 打烊结算</h2>
    <div class="dayend-grid">
      <div class="de-item"><div class="de-label">出餐</div><div class="de-val">${s.served} 份</div></div>
      <div class="de-item"><div class="de-label">离店</div><div class="de-val de-bad">${s.left} 人</div></div>
      <div class="de-item"><div class="de-label">收入</div><div class="de-val">+${s.revenue}</div></div>
      <div class="de-item"><div class="de-label">现金</div><div class="de-val">${s.startCash} → ${G.cash}</div></div>
      <div class="de-item"><div class="de-label">口碑</div><div class="de-val">${s.startRep} → ${G.rep}</div></div>
      <div class="de-item"><div class="de-label">卫生</div><div class="de-val">${s.startHyg} → ${G.hygiene}</div></div>
    </div>
    <div class="de-targets">
      <h3>通关目标</h3>
      <div class="target ${G.cash>=CONFIG.WIN_CASH?'met':''}">💰 现金 ${G.cash}/${CONFIG.WIN_CASH} ${G.cash>=CONFIG.WIN_CASH?'✅':'❌'}</div>
      <div class="target ${G.rep>=CONFIG.WIN_REPUTATION?'met':''}">⭐ 口碑 ${G.rep}/${CONFIG.WIN_REPUTATION} ${G.rep>=CONFIG.WIN_REPUTATION?'✅':'❌'}</div>
      <div class="target ${G.hygiene>=CONFIG.WIN_HYGIENE?'met':''}">🧹 卫生 ${G.hygiene}/${CONFIG.WIN_HYGIENE} ${G.hygiene>=CONFIG.WIN_HYGIENE?'✅':'❌'}</div>
    </div>`;
  if (G.day < CONFIG.TOTAL_DAYS) {
    html += `<button class="btn-next-day" onclick="goNextDay()">☀️ 开始 Day ${G.day+1}</button>`;
  }
  el.innerHTML = html;
}

// ===== 渲染：游戏结束 =====
function renderGameOver() {
  const el = $('#gameover-content');
  let title, desc, cls;
  if (G.gameResult === 'WIN') {
    title = '🎉 经营成功！';
    desc = '恭喜你，云津小馆声名远扬！';
    cls = 'win';
  } else if (G.gameResult === 'FAIL_CASH') {
    title = '💸 破产了…';
    desc = '现金归零，小馆无法继续经营。';
    cls = 'lose';
  } else if (G.gameResult === 'FAIL_REP') {
    title = '😱 爆雷关店！';
    desc = '口碑降至零，食客不再光顾。';
    cls = 'lose';
  } else {
    title = '😔 未达目标';
    desc = `7天结束，未能同时达成所有目标。`;
    cls = 'lose';
  }
  el.innerHTML = `<div class="go-box ${cls}">
    <h1>${title}</h1>
    <p>${desc}</p>
    <div class="go-stats">
      <div>💰 最终现金：${G.cash} ${G.cash>=CONFIG.WIN_CASH?'✅':'❌ 需要'+CONFIG.WIN_CASH}</div>
      <div>⭐ 最终口碑：${G.rep} ${G.rep>=CONFIG.WIN_REPUTATION?'✅':'❌ 需要'+CONFIG.WIN_REPUTATION}</div>
      <div>🧹 最终卫生：${G.hygiene} ${G.hygiene>=CONFIG.WIN_HYGIENE?'✅':'❌ 需要'+CONFIG.WIN_HYGIENE}</div>
      <div>📅 经营了 ${G.day} 天</div>
    </div>
    <button class="btn-restart" onclick="restartGame()">🔄 重新开始</button>
  </div>`;
}

// ===== 初始化入口 =====
document.addEventListener('DOMContentLoaded', () => {
  showScreen('title');
});
