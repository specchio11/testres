// ============================================================
// MG_npc_generator.js — NPC 生成器 (函数文件夹/npc)
// 纯函数，不依赖运行时状态，不使用对象展开语法。
// ============================================================

/**
 * 生成1个随机NPC
 * @param {Object} options - { lureType: 'general'|'sword'|'alchemy' }
 * @param {Array} existingNpcs - 现有NPC列表（用于去重）
 * @returns {{ npc: Object, log: string[] }}
 */
function MG_generateRandomNpc(options, existingNpcs) {
    var lureType = (options && options.lureType) || 'general';
    var existing = existingNpcs || [];
    var log = [];

    var lure = NPC_LURE_TYPES[lureType];
    log.push('[诱饵] 使用: ' + lure.name + ' — ' + lure.desc);

    // 1. 抽取性别
    var gender = UTIL_weightedRandom(NPC_GENDER_POOL);
    log.push('[性别] ' + (gender.id === 'male' ? '男' : '女'));

    // 2. 抽取种族（含诱饵加权）
    var racePool = UTIL_applyBonus(NPC_RACE_POOL, lure.raceBonus);
    var race = UTIL_weightedRandom(racePool);
    log.push('[种族] 抽取: ' + race.name + ' (' + race.desc + ')');
    log.push('  └ 种族池权重: ' + UTIL_poolWeightsStr(racePool));

    // 3. 抽取性格
    var personality = UTIL_weightedRandom(NPC_PERSONALITY_POOL);
    log.push('[性格] 抽取: ' + personality.name);
    log.push('  └ ' + personality.desc);

    // 4. 抽取技能 — 先按种族亲和度+诱饵偏好选前缀，再从该前缀中选具体技能
    var raceAffinity = NPC_RACE_SKILL_AFFINITY[race.id] || {};
    var mergedAffinity = Object.assign({}, raceAffinity);
    var bonusPrefixes = Object.keys(lure.skillBonus);
    for (var i = 0; i < bonusPrefixes.length; i++) {
        var pfx = bonusPrefixes[i];
        mergedAffinity[pfx] = (mergedAffinity[pfx] || 0) + lure.skillBonus[pfx];
    }

    // 构建前缀抽取池
    var prefixPool = Object.keys(mergedAffinity).map(function (k) {
        return { id: k, name: NPC_SKILL_PREFIX[k].name, weight: mergedAffinity[k] };
    });
    var selectedPrefix = UTIL_weightedRandom(prefixPool);
    log.push('[技能前缀] 抽取: ' + NPC_SKILL_PREFIX[selectedPrefix.id].name +
             ' (' + NPC_SKILL_PREFIX[selectedPrefix.id].desc + ')');
    log.push('  └ 前缀池权重: ' + UTIL_poolWeightsStr(prefixPool));

    // 从该前缀的技能中选1个（优先去重）
    var skillsOfPrefix = NPC_SKILL_POOL.filter(function (s) {
        return s.prefix === selectedPrefix.id;
    });
    var existingSkillIds = existing.map(function (n) { return n.skill_id; });
    var availableSkills = skillsOfPrefix.filter(function (s) {
        return existingSkillIds.indexOf(s.id) === -1;
    });
    if (availableSkills.length === 0) {
        availableSkills = skillsOfPrefix; // 全重复则不去重
        log.push('  ⚠ 该前缀下技能已全部被持有，允许重复');
    }
    var skill = availableSkills[Math.floor(Math.random() * availableSkills.length)];
    log.push('[技能] 抽取: ' + skill.name + ' — ' + skill.desc);

    // 5. 生成姓名（去重）
    var name = MG_generateNpcName(gender.id, existing);
    log.push('[姓名] 生成: ' + name);

    // 6. 分配立绘
    var portrait = MG_assignPortrait(gender.id);
    log.push('[立绘] 分配: ' + portrait);

    // 7. 计算AI权重
    var aiWeights = MG_mergeAIWeights(race.id, personality.id);
    var aiSummary = Object.keys(aiWeights).map(function (k) {
        return (NPC_AI_DIM[k] ? NPC_AI_DIM[k].name : k) + '=' + NPC_AI_LEVEL_TEXT[aiWeights[k]];
    }).join(', ');
    log.push('[AI权重] ' + aiSummary);

    // 8. 生成UUID
    var id = UTIL_generateUUID();

    // 9. 组装NPC对象
    var npc = {
        id: id,
        type: 'random',
        name: name,
        gender: gender.id,
        portrait_id: portrait,
        race: race.id,
        personality: personality.id,
        skill_id: skill.id,
        ai_weights: aiWeights
    };

    log.push('[完成] ✔ ' + name + ' (' + race.name + '·' + personality.name + ')');

    return { npc: npc, log: log };
}

/**
 * 生成随机仙侠姓名（去重）
 */
function MG_generateNpcName(genderId, existingNpcs) {
    var existing = existingNpcs || [];
    var existingNames = existing.map(function (n) { return n.name; });
    var namePool = genderId === 'male' ? NPC_MALE_NAME_POOL : NPC_FEMALE_NAME_POOL;

    var attempts = 0;
    var name;
    do {
        var surname = NPC_SURNAME_POOL[Math.floor(Math.random() * NPC_SURNAME_POOL.length)];
        var givenName = namePool[Math.floor(Math.random() * namePool.length)];
        name = surname + givenName;
        attempts++;
    } while (existingNames.indexOf(name) !== -1 && attempts < 200);

    return name;
}

/**
 * 随机分配立绘ID
 */
function MG_assignPortrait(genderId) {
    var portraits = genderId === 'male' ? NPC_PORTRAIT_MALE : NPC_PORTRAIT_FEMALE;
    return portraits[Math.floor(Math.random() * portraits.length)].id;
}

/**
 * 合并AI权重: 默认(3) → 种族覆盖 → 性格覆盖
 * 烂漫随性特殊处理: 除种族和性格锁定的维度外，其余随机 1-5
 */
function MG_mergeAIWeights(raceId, personalityId) {
    // 全维度默认值 = 3 (中)
    var weights = {
        cash_reserve: 3, risk_control: 3, monopoly: 3,
        trade_greed: 3, attack: 3, build: 3,
        item_use: 3, trade_pawn: 3, special: 3
    };

    var raceWeights = NPC_RACE_AI_BASE[raceId] || {};
    var persWeights = NPC_PERSONALITY_AI_MOD[personalityId] || {};

    if (personalityId === 'lanman' || personalityId === 'xiaoyao') {
        // 烂漫随性/逍遥任游：先应用种族和性格的固定维度，其余全随机
        var raceKeys = Object.keys(raceWeights);
        var persKeys = Object.keys(persWeights);
        var fixedKeys = [].concat(raceKeys, persKeys);

        // 应用种族
        Object.assign(weights, raceWeights);
        // 应用性格
        Object.assign(weights, persWeights);

        // 随机化未锁定维度
        var allKeys = Object.keys(weights);
        for (var i = 0; i < allKeys.length; i++) {
            if (fixedKeys.indexOf(allKeys[i]) === -1) {
                weights[allKeys[i]] = Math.floor(Math.random() * 5) + 1;
            }
        }
    } else {
        // 常规路径：种族覆盖默认 → 性格覆盖种族
        Object.assign(weights, raceWeights);
        Object.assign(weights, persWeights);
    }

    return weights;
}
