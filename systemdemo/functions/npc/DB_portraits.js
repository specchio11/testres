// ============================================================
// DB_portraits.js — 立绘资源ID映射 (函数文件夹/npc)
// 模拟易次元的 $id 形式资源管理
// ============================================================

// 男性立绘
var NPC_PORTRAIT_MALE = Object.freeze([
    { id: '$img_male_001', file: 'male1.png' },
    { id: '$img_male_002', file: 'male2.png' },
    { id: '$img_male_003', file: 'male3.png' },
]);

// 女性立绘
var NPC_PORTRAIT_FEMALE = Object.freeze([
    { id: '$img_female_001', file: 'female1.png' },
    { id: '$img_female_002', file: 'female2.png' },
    { id: '$img_female_003', file: 'female3.png' },
]);

// 全部立绘查找表
var NPC_PORTRAIT_MAP = Object.freeze(
    (function () {
        var map = {};
        NPC_PORTRAIT_MALE.forEach(function (p) { map[p.id] = p; });
        NPC_PORTRAIT_FEMALE.forEach(function (p) { map[p.id] = p; });
        return map;
    })()
);

/**
 * 根据立绘ID获取本地图片路径
 * @param {string} portraitId - 立绘ID (如 '$img_male_001')
 * @param {string} basePath - 图片基础路径（相对于当前HTML文件）
 * @returns {string} 本地图片路径
 */
function MG_getPortraitPath(portraitId, basePath) {
    var base = basePath || '/npcIllu/';
    var entry = NPC_PORTRAIT_MAP[portraitId];
    if (!entry) return base + 'default.png';
    return base + entry.file;
}
