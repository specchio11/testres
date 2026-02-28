// ============================================================
// DB_npc.js — NPC 数据池定义 (函数文件夹/npc)
// 种族、性格、技能、姓名、AI权重等全部随机池常量
// 本文件只有 const 定义，零运行时状态
// ============================================================

// --- NPC 库容量上限 ---
var NPC_MAX_RANDOM = 30;

// ===================== 性别 =====================
var NPC_GENDER_POOL = Object.freeze([
  { id: 'male', name: '男', weight: 50 },
  { id: 'female', name: '女', weight: 50 },
]);

// ===================== 种族 =====================
var NPC_RACE_POOL = Object.freeze([
  {
    id: 'xian',
    name: '仙',
    weight: 25,
    desc: '仙道修士，崇尚秩序与积累，善于经营建设',
    skillAffinity: '建筑、经济类技能',
  },
  {
    id: 'ren',
    name: '人',
    weight: 25,
    desc: '人族修士，机敏善变，长于算计与交易',
    skillAffinity: '概率、经济类技能',
  },
  {
    id: 'yao',
    name: '妖',
    weight: 25,
    desc: '妖族修士，天赋异禀，擅长道具与行动',
    skillAffinity: '卡片、行动类技能',
  },
  {
    id: 'mo',
    name: '魔',
    weight: 25,
    desc: '魔道修士，好勇斗狠，精于攻伐与行动',
    skillAffinity: '攻击、行动类技能',
  },
]);

// --- 种族 AI 基础权重 (覆盖默认值3的维度) ---
var NPC_RACE_AI_BASE = Object.freeze({
  xian: { cash_reserve: 3, risk_control: 4, monopoly: 5 },
  ren: { cash_reserve: 3, risk_control: 3, trade_pawn: 5 },
  yao: { cash_reserve: 3, risk_control: 2, item_use: 5 },
  mo: { cash_reserve: 2, risk_control: 2, item_use: 5 },
});

// --- 种族 → 技能前缀亲和度权重 ---
var NPC_RACE_SKILL_AFFINITY = Object.freeze({
  xian: { fengshan: 50, dingfen: 20, chuanfei: 15, wanshu: 10, guidao: 5 },
  ren: { dingfen: 40, fengshan: 30, wanshu: 15, chuanfei: 10, guidao: 5 },
  yao: { wanshu: 35, chuanfei: 30, guidao: 15, dingfen: 15, fengshan: 5 },
  mo: { chuanfei: 40, guidao: 20, wanshu: 20, dingfen: 10, fengshan: 10 },
});

// ===================== 性格 (10种独立性格) =====================
var NPC_PERSONALITY_POOL = Object.freeze([
  // ── 克己持重 / 清冷孤高 ──
  {
    id: 'keji',
    name: '克己持重',
    weight: 10,
    desc: '律己极严，风险厌恶，重视资源储备与防守建设',
  },
  {
    id: 'qingleng',
    name: '清冷孤高',
    weight: 10,
    desc: '离群索居，不贪蝇利，不屑交易，独善其身',
  },
  // ── 城府深阻 / 循规蹈矩 ──
  {
    id: 'chengfu',
    name: '城府深阻',
    weight: 10,
    desc: '深谋远虑，行事隐忍，谋定后动，伺机而发',
  },
  {
    id: 'xungui',
    name: '循规蹈矩',
    weight: 10,
    desc: '按部就班，不走极端，稳扎稳打，中庸之道',
  },
  // ── 磊落豪朗 / 风流倜傥 ──
  {
    id: 'leiluo',
    name: '磊落豪朗',
    weight: 10,
    desc: '慷慨大方，轻财重义，好行侠义，不计得失',
  },
  {
    id: 'fengliu',
    name: '风流倜傥',
    weight: 10,
    desc: '处事潇洒，偏好冒险，好胜争先，不畏风险',
  },
  // ── 幸灾乐祸 / 桀骜不驯 ──
  {
    id: 'xingzai',
    name: '幸灾乐祸',
    weight: 10,
    desc: '损人利己，嗜用道具，沉迷于破坏他人计划',
  },
  {
    id: 'jieao',
    name: '桀骜不驯',
    weight: 10,
    desc: '好勇斗狠，攻击欲极强，蔑视一切规则',
  },
  // ── 烂漫随性 / 逍遥任游 ──
  {
    id: 'lanman',
    name: '烂漫随性',
    weight: 10,
    desc: '行事无常，随心所欲，不可预测',
  },
  {
    id: 'xiaoyao',
    name: '逍遥任游',
    weight: 10,
    desc: '闲云野鹤，偏好特种行动，追求意外之喜',
  },
]);

// --- 性格 AI 权重修正 (覆盖种族+默认, 优先级最高) ---
var NPC_PERSONALITY_AI_MOD = Object.freeze({
  keji: { risk_control: 5, trade_greed: 1, attack: 1, build: 5 },
  qingleng: {
    risk_control: 5,
    trade_greed: 1,
    attack: 1,
    build: 4,
    trade_pawn: 1,
  },
  chengfu: { risk_control: 4, trade_greed: 3, attack: 3 },
  xungui: { risk_control: 3, trade_greed: 3, attack: 2, build: 4 },
  leiluo: { trade_greed: 1, attack: 3, cash_reserve: 2 },
  fengliu: { trade_greed: 2, attack: 4, risk_control: 2, special: 3 },
  xingzai: { item_use: 5, attack: 5, special: 3 },
  jieao: { attack: 5, item_use: 4, risk_control: 1, special: 4 },
  lanman: { special: 5 }, // 除种族确定的倾向外，其他倾向每局全随机
  xiaoyao: { special: 5, risk_control: 2 }, // 类似烂漫但偏好冒险
});

// ===================== AI 权重系统 =====================
var NPC_AI_DIM = Object.freeze({
  cash_reserve: { name: '流动资金储备', icon: '💰' },
  risk_control: { name: '风险控制系数', icon: '🛡️' },
  monopoly: { name: '地块垄断意愿', icon: '🏘️' },
  trade_greed: { name: '交易贪婪指数', icon: '🤝' },
  attack: { name: '主动攻击意愿', icon: '⚔️' },
  build: { name: '建设优先意愿', icon: '🏗️' },
  item_use: { name: '道具使用意愿', icon: '📜' },
  trade_pawn: { name: '交易典当意愿', icon: '💎' },
  special: { name: '特殊行动意愿', icon: '🎭' },
});

var NPC_AI_DIM_KEYS = Object.freeze(Object.keys(NPC_AI_DIM));

var NPC_AI_LEVEL_TEXT = Object.freeze({
  1: '极低',
  2: '低',
  3: '中',
  4: '高',
  5: '极高',
});

// ===================== 技能系统 =====================

// --- 技能前缀定义 ---
var NPC_SKILL_PREFIX = Object.freeze({
  fengshan: { name: '丰赡', desc: '数值类（经济、建筑）', color: '#c9a96e' },
  chuanfei: { name: '遄飞', desc: '行动类（行动、攻击）', color: '#e94560' },
  dingfen: { name: '定分', desc: '概率类', color: '#5fa8d3' },
  wanshu: { name: '万殊', desc: '道具类（卡片）', color: '#8ac926' },
  guidao: { name: '诡道', desc: '特种类', color: '#9b59b6' },
});

// --- 技能池 (21个技能) ---
var NPC_SKILL_POOL = Object.freeze([
  // ═══ 丰赡 · 数值/经济/建筑 ═══
  {
    id: 'fengshan_01',
    prefix: 'fengshan',
    name: '丰赡·来者不拒',
    desc: '过路费减免10%，广结善缘',
  },
  {
    id: 'fengshan_02',
    prefix: 'fengshan',
    name: '丰赡·聚宝生辉',
    desc: '经过起点时额外获得15%灵石',
  },
  {
    id: 'fengshan_03',
    prefix: 'fengshan',
    name: '丰赡·固若金汤',
    desc: '己方建筑升级费用减少20%',
  },
  {
    id: 'fengshan_04',
    prefix: 'fengshan',
    name: '丰赡·日进斗金',
    desc: '己方所有建筑收租金额+10%',
  },
  {
    id: 'fengshan_05',
    prefix: 'fengshan',
    name: '丰赡·点石成金',
    desc: '购买空地时价格减少15%',
  },

  // ═══ 遄飞 · 行动/攻击 ═══
  {
    id: 'chuanfei_01',
    prefix: 'chuanfei',
    name: '遄飞·神行百变',
    desc: '每回合可选择额外前进或后退1步',
  },
  {
    id: 'chuanfei_02',
    prefix: 'chuanfei',
    name: '遄飞·凌波微步',
    desc: '经过对手地产时20%概率免交过路费',
  },
  {
    id: 'chuanfei_03',
    prefix: 'chuanfei',
    name: '遄飞·雷霆一击',
    desc: '路过对手建筑时10%概率使其降级',
  },
  {
    id: 'chuanfei_04',
    prefix: 'chuanfei',
    name: '遄飞·风驰电掣',
    desc: '移动时无视路障与陷阱效果',
  },

  // ═══ 定分 · 概率 ═══
  {
    id: 'dingfen_01',
    prefix: 'dingfen',
    name: '定分·天命所归',
    desc: '天机阁签文抽到上上签概率+10%',
  },
  {
    id: 'dingfen_02',
    prefix: 'dingfen',
    name: '定分·否极泰来',
    desc: '连续2回合不获利时，下回合收益翻倍',
  },
  {
    id: 'dingfen_03',
    prefix: 'dingfen',
    name: '定分·逢凶化吉',
    desc: '下下签负面效果减半',
  },
  {
    id: 'dingfen_04',
    prefix: 'dingfen',
    name: '定分·妙手偶得',
    desc: '秘境检定成功率+15%',
  },

  // ═══ 万殊 · 道具/卡片 ═══
  {
    id: 'wanshu_01',
    prefix: 'wanshu',
    name: '万殊·百宝囊中',
    desc: '每5回合自动获得1张随机T1符箓',
  },
  {
    id: 'wanshu_02',
    prefix: 'wanshu',
    name: '万殊·移花接木',
    desc: '使用道具卡时20%概率不消耗',
  },
  {
    id: 'wanshu_03',
    prefix: 'wanshu',
    name: '万殊·夺人之器',
    desc: '对手使用道具卡时15%概率夺取',
  },
  {
    id: 'wanshu_04',
    prefix: 'wanshu',
    name: '万殊·藏器待时',
    desc: '手牌上限+1',
  },

  // ═══ 诡道 · 特种 ═══
  {
    id: 'guidao_01',
    prefix: 'guidao',
    name: '诡道·暗渡陈仓',
    desc: '回合结束时15%概率与随机对手交换位置',
  },
  {
    id: 'guidao_02',
    prefix: 'guidao',
    name: '诡道·浑水摸鱼',
    desc: '世界事件触发时额外获得奖励',
  },
  {
    id: 'guidao_03',
    prefix: 'guidao',
    name: '诡道·李代桃僵',
    desc: '被罚款时20%概率转嫁给随机对手',
  },
  {
    id: 'guidao_04',
    prefix: 'guidao',
    name: '诡道·无中生有',
    desc: '每局游戏开始时随机获得1个额外buff',
  },
]);

// ===================== 诱饵系统 =====================
var NPC_LURE_TYPES = Object.freeze({
  general: {
    name: '泛用·灵茶',
    desc: '不偏不倚，来者皆可',
    raceBonus: {},
    skillBonus: {},
  },
  sword: {
    name: '垂类·剑谱',
    desc: '偏向仙/妖种族，侧重行动类技能',
    raceBonus: { xian: 40, yao: 25, ren: -10, mo: -10 },
    skillBonus: { chuanfei: 60 },
  },
  alchemy: {
    name: '垂类·丹方',
    desc: '偏向人/仙种族，侧重概率/经济类技能',
    raceBonus: { ren: 40, xian: 25, yao: -10, mo: -10 },
    skillBonus: { dingfen: 50, fengshan: 40 },
  },
});

// ===================== 姓名池 =====================
var NPC_SURNAME_POOL = Object.freeze([
  '李',
  '王',
  '张',
  '陈',
  '赵',
  '周',
  '吴',
  '徐',
  '孙',
  '朱',
  '林',
  '何',
  '高',
  '梁',
  '宋',
  '唐',
  '韩',
  '曹',
  '萧',
  '冯',
  '程',
  '蔡',
  '袁',
  '苏',
  '叶',
  '吕',
  '魏',
  '蒋',
  '杜',
  '沈',
  '姜',
  '范',
  '金',
  '夏',
  '谭',
  '石',
  '龙',
  '段',
  '白',
  '秦',
  '温',
  '武',
  '楚',
  '慕容',
  '上官',
  '司马',
  '南宫',
  '公孙',
  '令狐',
  '独孤',
]);

var NPC_MALE_NAME_POOL = Object.freeze([
  '逸风',
  '云起',
  '无忌',
  '承影',
  '惊鸿',
  '玄清',
  '青阳',
  '明远',
  '天行',
  '凌霄',
  '寒川',
  '墨尘',
  '长安',
  '北辰',
  '归元',
  '少卿',
  '子虚',
  '九歌',
  '弘毅',
  '乘风',
  '御天',
  '灵均',
  '伯庸',
  '怀瑾',
  '握瑜',
  '景明',
  '凤歌',
  '问道',
  '破军',
  '听泉',
  '望舒',
  '扶摇',
  '霁月',
  '清源',
  '鹤鸣',
  '星河',
  '沧海',
  '横舟',
  '拂晓',
  '惊蛰',
]);

var NPC_FEMALE_NAME_POOL = Object.freeze([
  '若兰',
  '素衣',
  '清漪',
  '凝霜',
  '月瑶',
  '灵犀',
  '紫烟',
  '映雪',
  '飞鸾',
  '碧落',
  '如梦',
  '轻鸿',
  '听雨',
  '惜朝',
  '幽兰',
  '晚晴',
  '含章',
  '采薇',
  '玲珑',
  '锦瑟',
  '云裳',
  '倾城',
  '梦蝶',
  '落霞',
  '问心',
  '吟霜',
  '秋水',
  '琼华',
  '醉月',
  '归雁',
  '语嫣',
  '清婉',
  '素心',
  '芷若',
  '瑶光',
  '冰蝉',
  '霓裳',
  '朝露',
  '栖凤',
  '沐晴',
]);
