/* ============================================================
   MODELS — Comprehensive Rating Engine
   Implements the full 22-section rating specification:
   - Normalization utilities
   - Player OFF/DEF/OVR with 6 subscores + position weighting
   - Team OFF/DEF/OVR with 4 pillars + roster strength
   - Derived advanced stats (BPM, WS/48, OBPM, DBPM approx)
   ============================================================ */
const models = {

    // ==================== NORMALIZATION UTILITIES ====================

    /** Higher-is-better normalization to [0,1] */
    norm(x, min, max) {
        if (max === min) return 0.5;
        return this.clamp01((x - min) / (max - min));
    },

    /** Lower-is-better normalization to [0,1] */
    normInverse(x, min, max) {
        if (max === min) return 0.5;
        return this.clamp01((max - x) / (max - min));
    },

    /** Clamp value to [0, 1] */
    clamp01(v) {
        return Math.max(0, Math.min(1, v));
    },

    /** Winsorize an array at 5th and 95th percentile, return {min, max} */
    winsorize(values) {
        if (!values.length) return { min: 0, max: 1 };
        const sorted = [...values].sort((a, b) => a - b);
        const p05 = sorted[Math.floor(sorted.length * 0.05)] || sorted[0];
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
        return { min: p05, max: p95 };
    },

    /**
     * Compute league-wide and role-specific min/max for all stat keys from all players with real stats.
     */
    computeLeagueStats() {
        const rosters = window.store.state.rosters;
        const allStats = [];
        const roleStatsMap = { guard: [], wing: [], big: [] };

        Object.keys(rosters).forEach(teamId => {
            const roster = rosters[teamId];
            if (!roster || !roster.athletes) return;
            roster.athletes.forEach(a => {
                // Relaxed requirements to ensure normalization baseline is ALWAYS populated
                if (a.realStats && (a.realStats.gp > 0 || a.realStats.ppg > 0)) {
                    allStats.push(a.realStats);
                    
                    const posAbbrev = a.position?.abbreviation || 'G';
                    const posName = a.position?.name || '';
                    let archetype = 'wing';
                    if (/^(PG|SG|G)$/i.test(posAbbrev) || /Guard/i.test(posName)) archetype = 'guard';
                    else if (/^(PF|C)$/i.test(posAbbrev) || /Center/i.test(posName)) archetype = 'big';
                    else if (/^(SF|F|G-F|F-G)$/i.test(posAbbrev) || /Forward/i.test(posName)) archetype = 'wing';
                    
                    roleStatsMap[archetype].push(a.realStats);
                }
            });
        });

        // Proceed with normalization even with small datasets for instant superstar restoration
        if (allStats.length === 0) {
            console.warn('[Models] No players with realStats found for normalization baseline.');
            return;
        }

        const keys = Object.keys(allStats[0] || {});
        
        const buildBounds = (statsArray) => {
            const bounds = {};
            keys.forEach(key => {
                const values = statsArray.map(s => s[key]).filter(v => typeof v === 'number' && !isNaN(v));
                if (values.length < 5) return;
                const w = this.winsorize(values);
                bounds[key] = {
                    min: w.min,
                    max: w.max,
                    avg: values.reduce((s, v) => s + v, 0) / values.length,
                    stdDev: Math.sqrt(values.reduce((sq, v) => sq + Math.pow(v - (values.reduce((s, x) => s + x, 0) / values.length), 2), 0) / values.length) || 1
                };
            });
            return bounds;
        };

        window.store.state.leagueStats = buildBounds(allStats);
        window.store.state.roleStats = {
            guard: buildBounds(roleStatsMap.guard),
            wing: buildBounds(roleStatsMap.wing),
            big: buildBounds(roleStatsMap.big)
        };
        console.log(`[Models] League & Role stats computed from ${allStats.length} players.`);
    },

    /** Get normalized value for a stat, using league min/max */
    normStat(value, key, inverse = false) {
        const ls = store.state.leagueStats[key];
        if (!ls) return 0.5; // Fallback if no league data
        return inverse ? this.normInverse(value, ls.min, ls.max) : this.norm(value, ls.min, ls.max);
    },

    /** Get normalized value for a stat against a specific role */
    normRole(value, key, role, inverse = false) {
        const rs = store.state.roleStats?.[role]?.[key];
        if (!rs) return 0.5;
        return inverse ? this.normInverse(value, rs.min, rs.max) : this.norm(value, rs.min, rs.max);
    },

    /** Fair normalization (0.6 role + 0.4 league) */
    normFair(value, key, role, inverse = false) {
        const nr = this.normRole(value, key, role, inverse);
        const nl = this.normStat(value, key, inverse);
        return (0.60 * nr) + (0.40 * nl);
    },

    /** Fair normalization for derived stats */
    normFairDerived(value, mixMin, mixMax, roleMin, roleMax) {
        // approximate role vs league bounds for derived stats manually if needed
        // but simple way:
        const nl = this.norm(value, mixMin, mixMax);
        const nr = this.norm(value, roleMin, roleMax);
        return (0.60 * nr) + (0.40 * nl);
    },

    /** Normalize a derived stat directly using provided min/max bounds */
    normDerived(value, min, max) {
        return this.norm(value, min, max);
    },


    // ==================== DERIVED ADVANCED STATS ====================

    /**
     * Approximate BPM (Box Plus/Minus) from available ESPN stats.
     * Includes position adjustment to prevent center inflation.
     */
    deriveBPM(s, archetype) {
        if (!s || s.mpg < 5) return 0;
        const perComponent = (s.per - 15) * 0.12;
        const pmComponent = (s.plusMinus / Math.max(s.gp, 1)) * 0.20;
        const tsComponent = ((s.tsPct || 55) - 55) * 0.06;
        const astComponent = (s.apg || 0) * 0.08;  // playmaking adds to BPM
        const scoringComponent = (s.ppg || 0) * 0.02;  // scoring volume
        let bpm = perComponent + pmComponent + tsComponent + astComponent + scoringComponent;
        // Centers get PER inflated by rebounds — position correction
        if (archetype === 'big') bpm *= 0.65;
        return bpm;
    },

    /** Approximate OBPM/DBPM split */
    deriveOBPM(s, bpm) {
        if (!s) return 0;
        const offShare = (s.ppg + s.apg * 1.5) / (s.ppg + s.apg * 1.5 + s.rpg + s.spg * 2 + s.bpg * 2 + 0.01);
        return bpm * Math.max(0.3, Math.min(0.8, offShare));
    },

    deriveDBPM(s, bpm, obpm) {
        return bpm - obpm;
    },

    /** Approximate Win Shares per 48 from PER, TS%, team context */
    deriveWS48(s) {
        if (!s || s.mpg < 5) return 0;
        const perBonus = ((s.per || 15) - 10) * 0.005;
        const tsBonus = ((s.tsPct || 55) - 50) * 0.003;
        return Math.max(-0.05, perBonus + tsBonus);
    },

    /** Approximate Offensive/Defensive Win Shares */
    deriveOffWS(s, ws48) {
        if (!s) return 0;
        const totalWS = ws48 * (s.totalMinutes || s.mpg * s.gp) / 48;
        const offShare = (s.ppg + s.apg) / (s.ppg + s.apg + s.rpg + s.spg + s.bpg + 0.01);
        return totalWS * Math.max(0.3, Math.min(0.8, offShare));
    },

    deriveDefWS(s, ws48, offWS) {
        const totalWS = ws48 * (s.totalMinutes || s.mpg * s.gp) / 48;
        return totalWS - offWS;
    },

    /** Approximate STL% and BLK% from per-48 rates */
    deriveStlPct(s) {
        if (!s) return 0;
        return (s.stl48 || 0) / 48 * 100; // rough %
    },

    deriveBlkPct(s) {
        if (!s) return 0;
        return (s.blk48 || 0) / 48 * 100;
    },


    // ==================== PLAYER RATING SYSTEM ====================

    /**
     * Generate comprehensive player rating following the full spec.
     * Returns OVR, OFF, DEF, and all subscores.
     */
    generatePlayerRating(athlete, teamStats) {
        // ------ Position detection ------
        const posName = athlete.position?.name || athlete.position?.abbreviation || '';
        const posAbbrev = athlete.position?.abbreviation || 'G';
        let archetype = 'wing'; // default
        if (/^(PG|SG|G)$/i.test(posAbbrev) || /Guard/i.test(posName)) archetype = 'guard';
        else if (/^(PF|C)$/i.test(posAbbrev) || /Center/i.test(posName)) archetype = 'big';
        else if (/^(SF|F|G-F|F-G)$/i.test(posAbbrev) || /Forward/i.test(posName)) archetype = 'wing';

        // ------ Stats: prefer real, fallback to estimates ------
        let s = null;
        let hasRealStats = false;

        if (athlete.realStats && (athlete.realStats.gp > 0 || athlete.realStats.ppg > 0)) {
            hasRealStats = true;
            s = athlete.realStats;
        }

        if (!hasRealStats) {
            // Salary-based fallback for players without stats
            return this.generateFallbackRating(athlete, teamStats, posAbbrev, archetype);
        }

        // ------ Derive advanced metrics ------
        const bpm = this.deriveBPM(s, archetype);
        const obpm = this.deriveOBPM(s, bpm);
        const dbpm = this.deriveDBPM(s, bpm, obpm);
        const ws48 = this.deriveWS48(s);
        const offWS = this.deriveOffWS(s, ws48);
        const defWS = this.deriveDefWS(s, ws48, offWS);
        const stlPct = this.deriveStlPct(s);
        const blkPct = this.deriveBlkPct(s);

        // Points per 75 possessions (approximate)
        const ptsPer75 = s.estimatedPossessions > 0 ? (s.ppg / s.estimatedPossessions) * 75 : s.ppg;
        const astPer75 = s.estimatedPossessions > 0 ? (s.apg / s.estimatedPossessions) * 75 : s.apg;
        const rebPer75 = s.estimatedPossessions > 0 ? (s.rpg / s.estimatedPossessions) * 75 : s.rpg;
        const tovPer75 = s.estimatedPossessions > 0 ? (s.tovPg / s.estimatedPossessions) * 75 : s.tovPg;

        // FT rate (FTA per FGA)
        const ftRate = s.fga > 0 ? s.fta / s.fga : 0;
        // AST%
        const astPct = s.assistRatio || 0;
        // Foul rate
        const foulRate = s.foulsPg || 0;

        // Games played percentage (out of ~72-82 team games)
        const teamGP = teamStats?.gp || 72;
        const gpPct = Math.min(s.gp / teamGP, 1);
        const gsPct = s.gp > 0 ? s.gs / s.gp : 0;

        // ------ PLAYER OFFENSIVE RATING ------
        // A) Shot Creation
        const shotCreation = 100 * (
            0.40 * this.normFair(s.ppg, 'ppg', archetype) +
            0.35 * this.normFair(ptsPer75, 'ppg', archetype) +
            0.25 * this.normFair(s.usage || 20, 'usage', archetype)
        );

        // B) Efficiency
        const efficiency = 100 * (
            0.40 * this.normFair(s.tsPct || 55, 'tsPct', archetype) +
            0.25 * this.normFair(s.efgPct || 50, 'efgPct', archetype) +
            0.20 * this.normFair(s.threePct || 0, 'threePct', archetype) +
            0.15 * this.normFair(ftRate, 'fta', archetype)
        );

        // C) Playmaking
        const playmaking = 100 * (
            0.30 * this.normFair(s.apg, 'apg', archetype) +
            0.25 * this.normFair(astPer75, 'apg', archetype) +
            0.25 * this.normFair(astPct, 'assistRatio', archetype) +
            0.20 * this.normFair(s.astTovRatio || 0, 'astTovRatio', archetype)
        );

        // D) Ball Security
        const ballSecurity = 100 * (
            0.55 * this.normFair(tovPer75, 'tovPg', archetype, true) +
            0.45 * this.normFair(s.astTovRatio || 0, 'astTovRatio', archetype)
        );

        // E) Offensive Impact
        const offImpact = 100 * (
            0.40 * this.normFairDerived(obpm, -3, 8, -2, 7) +
            0.35 * this.normFairDerived(offWS, -0.5, 6, -0.2, 5) +
            0.25 * this.normFairDerived(obpm, -3, 8, -2, 7) // fallback for OffOnOff
        );

        // Fair Offensive Weights by Role
        let playerOffenseRaw;
        if (archetype === 'guard') {
            playerOffenseRaw = 0.24 * shotCreation + 0.20 * efficiency + 0.24 * playmaking + 0.12 * ballSecurity + 0.20 * offImpact;
        } else if (archetype === 'wing') {
            playerOffenseRaw = 0.26 * shotCreation + 0.24 * efficiency + 0.18 * playmaking + 0.10 * ballSecurity + 0.22 * offImpact;
        } else { // big
            playerOffenseRaw = 0.24 * shotCreation + 0.26 * efficiency + 0.14 * playmaking + 0.10 * ballSecurity + 0.26 * offImpact;
        }

        let playerOffenseRating = 62 + 36 * Math.pow(playerOffenseRaw / 100, 0.90);
        playerOffenseRating = Math.max(60, Math.min(99, playerOffenseRating));


        // ------ PLAYER DEFENSIVE RATING ------
        // A) Defensive Disruption
        const defDisruption = 100 * (
            0.35 * this.normFair(s.spg, 'spg', archetype) +
            0.25 * this.normFair(stlPct, 'spg', archetype) +
            0.20 * this.normFair(s.bpg, 'bpg', archetype) +
            0.20 * this.normFair(blkPct, 'bpg', archetype)
        );

        // B) Defensive Impact
        const defImpact = 100 * (
            0.40 * this.normFairDerived(dbpm, -3, 5, -2, 4.5) +
            0.35 * this.normFairDerived(defWS, -0.5, 4, -0.2, 3.5) +
            0.25 * this.normFairDerived(dbpm, -3, 5, -2, 4.5) // fallback for DefOnOff
        );

        // C) Defensive Possession Ending
        const defPossessionEnding = 100 * (
            0.55 * this.normFair(s.defRebPg || 0, 'defRebPg', archetype) +
            0.45 * this.normFair(s.rpg, 'rpg', archetype) // rebalanced to use DREB/RPG
        );

        // D) Defensive Discipline
        const defDiscipline = 100 * (
            1.0 * this.normFair(foulRate, 'foulsPg', archetype, true)
        );

        // Fair Defensive Weights by Role
        let playerDefenseRaw;
        if (archetype === 'guard') {
            playerDefenseRaw = 0.27 * defDisruption + 0.38 * defImpact + 0.15 * defPossessionEnding + 0.20 * defDiscipline;
        } else if (archetype === 'wing') {
            playerDefenseRaw = 0.25 * defDisruption + 0.38 * defImpact + 0.17 * defPossessionEnding + 0.20 * defDiscipline;
        } else { // big
            playerDefenseRaw = 0.22 * defDisruption + 0.38 * defImpact + 0.22 * defPossessionEnding + 0.18 * defDiscipline;
        }

        // High-Physicality Boost (REB, BLK, STL) — increased per user feedback
        let physicalityBoost = 1.0;
        if (archetype === 'big') physicalityBoost = 1.30; // 30% boost to physical bigs
        else if (archetype === 'wing') physicalityBoost = 1.20;
        else physicalityBoost = 1.15;

        let playerDefenseRating = 62 + 35 * Math.pow((playerDefenseRaw * physicalityBoost) / 100, 0.92);
        playerDefenseRating = Math.max(60, Math.min(99, playerDefenseRating));


        // ------ PLAYER OVERALL RATING ------
        // Impact & Versatility
        const impactScoreRaw = 100 * (
            0.30 * this.normDerived(bpm, -4, 10) +
            0.25 * this.normDerived(s.vorp || 0, 0, 5) +
            0.25 * this.normDerived(ws48, -0.02, 0.22) +
            0.20 * this.normStat(s.per || 15, 'per')
        );

        const availabilityScore = 100 * (
            0.40 * this.clamp01(gpPct) +
            0.35 * this.normStat(s.mpg, 'mpg') +
            0.15 * this.clamp01(gsPct) +
            0.10 * 1.0
        );

        const versatilityScore = 100 * (
            0.30 * this.normFair(astPct, 'assistRatio', archetype) +
            0.25 * this.normFair(s.tsPct || 55, 'tsPct', archetype) +
            0.20 * this.normFair(tovPer75, 'tovPg', archetype, true) +
            0.25 * this.normFair(s.mpg, 'mpg', archetype)
        );

        // Cap single-bucket dominance (max 15% above impact)
        // If a player is extremely one dimensional, we cap their offense/defense to not vastly exceed their overall impact
        const capLimits = (rawVal, impact) => {
            return Math.min(rawVal, impact + 15);
        }
        
        const cappedOffense = capLimits(playerOffenseRating, impactScoreRaw);
        const cappedDefense = capLimits(playerDefenseRating, impactScoreRaw);

        let playerOverallRaw;
        if (archetype === 'guard') {
            playerOverallRaw = 0.37 * cappedOffense + 0.23 * cappedDefense + 0.22 * impactScoreRaw + 0.10 * availabilityScore + 0.08 * versatilityScore;
        } else if (archetype === 'wing') {
            playerOverallRaw = 0.34 * cappedOffense + 0.26 * cappedDefense + 0.22 * impactScoreRaw + 0.10 * availabilityScore + 0.08 * versatilityScore;
        } else { // big
            playerOverallRaw = 0.32 * cappedOffense + 0.28 * cappedDefense + 0.22 * impactScoreRaw + 0.10 * availabilityScore + 0.08 * versatilityScore;
            
            // Reduced center nerf to allow ELITE centers (Jokic/Embiid) to shine while still keeping role-players down
            playerOverallRaw *= 0.92; 
        }

        // Elite Production Multiplier ("Stat Monster" Boost)
        // If pts > 25, reb > 10, or ast > 8, give a production multiplier
        let starPower = 1.0;
        if (s.ppg > 27) starPower += 0.08;
        if (s.rpg > 11) starPower += 0.05;
        if (s.apg > 9) starPower += 0.05;
        if (s.spg > 1.8 || s.bpg > 1.8) starPower += 0.04;
        
        playerOverallRaw *= starPower;

        // --- THE STAR POWER RECALIBRATION ---
        
        // 1. Efficiency Floor (TS% Penalty)
        // High volume on bad efficiency is penalized. Elite efficiency is rewarded.
        const tsPct = parseFloat(s.tsPct) || 54;
        let efficiencyMult = 1.0;
        if (tsPct < 52) efficiencyMult = 0.88;
        else if (tsPct < 54) efficiencyMult = 0.94;
        else if (tsPct > 61) efficiencyMult = 1.04;
        else if (tsPct > 64) efficiencyMult = 1.07;

        // 2. Team Success Factor (Winning Matters)
        // Stars on winning teams get a boost.
        // We use the first record item's winPercent if available.
        const winPctStat = team?.records?.[0]?.stats?.find(st => st.name === 'winPercent');
        const winPct = winPctStat ? winPctStat.value : 0.5;
        const winFactor = 0.96 + (winPct * 0.08); // Range: 0.96 to 1.04

        // 3. Specialist Penalty (The Dyson Daniels Fix)
        // If you are a defensive god but score < 15 PPG, you are a role player, not a superstar.
        const ppg = parseFloat(s.ppg) || 0;
        let specialistPenalty = 1.0;
        if (ppg < 13 && defImpact > 82) specialistPenalty = 0.87;
        else if (ppg < 16 && defImpact > 82) specialistPenalty = 0.92;

        let playerOverall = 64 + 31 * Math.pow(playerOverallRaw / 100, 1.15);
        playerOverall *= (efficiencyMult * winFactor * specialistPenalty);

        // Volume Multiplier (MPG Rewards)
        const mpg = parseFloat(s.mpg) || 0;
        let volumeMult = 1.0;
        if (mpg < 22) volumeMult = 0.80;
        else if (mpg < 28) volumeMult = 0.90;
        else if (mpg > 33) volumeMult = 1.04;
        else if (mpg > 35) volumeMult = 1.06;
        
        playerOverall *= volumeMult;

        // --- THE "RARE ELITE" BARRIERS ---
        const apg = parseFloat(s.apg) || 0;
        const rpg = parseFloat(s.rpg) || 0;

        // 90+ is reserved for the Engines (23+ PPG or 9.5+ AST)
        if (playerOverall >= 90) {
            if (ppg < 23 && apg < 9.5) {
                playerOverall = Math.min(playerOverall, 89.9);
            }
        }
        
        // 85+ is reserved for All-Star candidates (17+ PPG or elite combinations)
        if (playerOverall >= 85) {
            if (ppg < 17 && apg < 7 && rpg < 10) {
                playerOverall = Math.min(playerOverall, 84.9);
            }
        }

        // Hard cap at 96.8 per user request to avoid "peak level" 99
        playerOverall = Math.max(60, Math.min(96.8, playerOverall));

        // Strict 20 Game Qualification Floor for top tier
        if (s.gp < 20) {
            playerOverall = Math.min(playerOverall, 79.9);
            if (s.gp < 5) playerOverall = Math.min(playerOverall, 72.0);
        }

        playerOverall = Math.round(playerOverall * 10) / 10;

        // Archetype Determination
        let archetypeLabel = "Role Player";
        if (playerOverall >= 95) archetypeLabel = "Generational Talent";
        else if (playerOverall >= 90) archetypeLabel = "Superstar";
        else if (playerOverall >= 85) archetypeLabel = "All-NBA Tier";
        else if (playerOverall >= 80) archetypeLabel = "Elite Starter";

        // Specific subscore archetypes
        if (shotCreation > 85 && playmaking > 80) archetypeLabel = "Offensive Engine";
        else if (shotCreation > 85 && archetype === 'guard') archetypeLabel = "Elite Shot Creator";
        else if (shotCreation > 80 && efficiency > 80) archetypeLabel = "3-Level Scorer";
        else if (defImpact > 85 && reboundingScore > 80) archetypeLabel = "Paint Protector";
        else if (defImpact > 80 && (parseFloat(s.stl) > 1.5 || parseFloat(s.blk) > 1.5)) archetypeLabel = "Two-Way Force";
        else if (efficiency > 85 && parseFloat(s.threePct) > 38) archetypeLabel = "Sharpshooter";

        return {
            rating: playerOverall.toFixed(1),
            ratingNum: playerOverall,
            offRating: playerOffenseRating.toFixed(1),
            defRating: playerDefenseRating.toFixed(1),
            posAbbrev: posAbbrev,
            pts: s.ppg.toFixed(1),
            reb: s.rpg.toFixed(1),
            ast: s.apg.toFixed(1),
            stl: s.spg.toFixed(1),
            blk: s.bpg.toFixed(1),
            gp: s.gp,
            mpg: s.mpg.toFixed(1),
            fgPct: s.fgPct?.toFixed(2),
            threePct: s.threePct?.toFixed(2),
            efgPct: s.efgPct?.toFixed(2),
            tsPct: s.tsPct?.toFixed(2),
            per: s.per?.toFixed(1),
            shotCreation: Math.round(shotCreation),
            efficiency: Math.round(efficiency),
            playmaking: Math.round(playmaking),
            rebounding: Math.round(defPossessionEnding),
            defenseScore: Math.round(defDisruption),
            impactScore: Math.round(impactScoreRaw),
            availabilityScore: Math.round(availabilityScore),
            archetype: archetypeLabel,
        };
    },

    /**
     * Fallback rating for players WITHOUT real stats.
     * Uses salary as proxy with wider distribution.
     */
    generateFallbackRating(athlete, teamStats, posAbbrev, archetype) {
        let salary = 1000000;
        if (athlete.contract?.salary) salary = athlete.contract.salary;
        else if (athlete.contracts?.[0]?.salary) salary = athlete.contracts[0].salary;

        const maxSalary = 55000000;
        const salaryFactor = Math.min(salary / maxSalary, 1.0);
        const isBig = archetype === 'big';
        const isGuard = archetype === 'guard';

        const teamPpg = teamStats?.ppg || 110;
        const ppgMult = teamPpg / 110.0;
        const idVar = (parseInt(athlete.id) || 0) % 5;

        const ppg = ((salaryFactor * 18) + idVar * 0.4) * ppgMult;
        const rpg = isBig ? (salaryFactor * 7 + 2) : (salaryFactor * 3 + 1);
        const apg = isGuard ? ((salaryFactor * 5 + 0.8) * ppgMult) : ((salaryFactor * 1.8 + 0.2) * ppgMult);
        const spg = salaryFactor * 0.8 + 0.2;
        const bpg = isBig ? (salaryFactor * 1.0 + 0.2) : (salaryFactor * 0.2 + 0.05);

        const isActive = athlete.status && athlete.status.id === '1';
        const gp = isActive ? Math.round(82 * (0.3 + salaryFactor * 0.5)) : 0;
        const mpg = salaryFactor * 24 + 4;

        const age = athlete.age || 25;
        const primeFactor = (age >= 26 && age <= 31) ? 1.03 : 1.0;
        let rating = (62 + salaryFactor * 14) * primeFactor;
        rating = Math.max(60, Math.min(76, Math.round(rating * 10) / 10));

        const offRating = Math.max(60, Math.min(80, 62 + salaryFactor * 16));
        const defRating = Math.max(60, Math.min(78, 62 + salaryFactor * 14));

        return {
            rating: rating.toFixed(1),
            ratingNum: rating,
            offRating: offRating.toFixed(1),
            defRating: defRating.toFixed(1),
            pts: ppg.toFixed(1),
            reb: rpg.toFixed(1),
            ast: apg.toFixed(1),
            stl: spg.toFixed(1),
            blk: bpg.toFixed(1),
            gp: Math.round(gp),
            mpg: mpg.toFixed(1),
            posAbbrev,
            hasRealStats: false,
            scoringScore: 0, playmakingScore: 0, reboundingScore: 0,
            defenseScore: 0, impactScore: 0, availabilityScore: 0,
        };
    },


    // ==================== TEAM RATING SYSTEM ====================

    /**
     * Generate base team stats from ESPN team profile (record, PPG, etc.)
     */
    generateAdvancedTeamStats(teamRaw) {
        if (!teamRaw) return null;

        let wins = 0, losses = 0, ptsFor = 110, ptsAgainst = 110;

        if (teamRaw.record?.items?.[0]?.stats) {
            const record = teamRaw.record.items[0].stats;
            record.forEach(s => {
                if (s.name === 'wins') wins = s.value;
                if (s.name === 'losses') losses = s.value;
                if (s.name === 'pointsFor') ptsFor = s.value;
                if (s.name === 'pointsAgainst') ptsAgainst = s.value;
            });
        } else {
            // Neutral baseline: 0-0 record, neutral numbers
            wins = 0;
            losses = 0;
            ptsFor = 0;
            ptsAgainst = 0;
        }

        const totalGames = (wins + losses) || 1;
        const winPct = wins / totalGames;
        const ppg = ptsFor / totalGames;
        const oppPpg = ptsAgainst / totalGames;
        const netRtg = ppg - oppPpg;

        // Determine streak
        let streak = '--';
        if (teamRaw.record?.items) {
            teamRaw.record.items.forEach(item => {
                if (item.stats) {
                    item.stats.forEach(s => {
                        if (s.name === 'streak') {
                            if (s.displayValue) streak = s.displayValue;
                            else if (s.value !== undefined && s.value !== 0) {
                                const val = Math.abs(Math.round(s.value));
                                streak = s.value > 0 ? `W${val}` : `L${val}`;
                            }
                        }
                    });
                }
            });
        }

        return {
            wins, losses, winPct, ppg, oppPpg, netRtg,
            offRating: '50.00', defRating: '50.00', ovrRating: '50.00',
            streak
        };
    },

    /**
     * MASTER function: Update all team rankings using the full spec.
     * Computes: Team Offense, Defense, Results, Schedule/Context, Roster Strength.
     */
    updateTeamRankings() {
        const teams = store.state.teams;
        const teamStatsMap = store.state.teamStats;

        // First pass: gather base stats for ALL teams
        let rankings = [];
        let allPpg = [], allOppPpg = [], allNetRtg = [], allWinPct = [];

        teams.forEach(team => {
            const baseStats = this.generateAdvancedTeamStats(teamStatsMap[team.id]);
            if (baseStats) {
                rankings.push({ id: team.id, team, stats: baseStats });
                allPpg.push(baseStats.ppg);
                allOppPpg.push(baseStats.oppPpg);
                allNetRtg.push(baseStats.netRtg);
                allWinPct.push(baseStats.winPct);
            }
        });

        if (rankings.length === 0) return;

        // Compute league-wide bounds for team stats
        const tw = (arr) => this.winsorize(arr);
        const ppgBounds = tw(allPpg);
        const oppPpgBounds = tw(allOppPpg);
        const netRtgBounds = tw(allNetRtg);
        const winPctBounds = tw(allWinPct);

        // Collect roster strength data across all teams first
        const allRosterStrengthRaw = [];
        const allStarPowerRaw = [];
        const allDepthRaw = [];

        const rosterDataByTeam = {};

        rankings.forEach(r => {
            const teamId = r.id;
            const roster = store.state.players.filter(p => String(p.teamId) === String(teamId));

            // Sort by overall rating
            const sorted = roster.slice()
                .sort((a, b) => (b.rating?.ratingNum || 0) - (a.rating?.ratingNum || 0));

            // Rotation: top 8-9 active players
            const rotation = sorted.slice(0, 9);

            // Compute rotation weights (Section 18A)
            const totalMpg = rotation.reduce((sum, p) => sum + (parseFloat(p.rating?.mpg) || 0), 0) || 1;
            const totalUsage = rotation.reduce((sum, p) => {
                const s = p.realStats || {};
                return sum + (s.usage || 20);
            }, 0) || 1;

            const weights = rotation.map((p, idx) => {
                const mpg = parseFloat(p.rating?.mpg) || 0;
                const usage = p.realStats?.usage || 20;
                const mpgShare = mpg / totalMpg;
                const usageShare = usage / totalUsage;
                let weight = 0.70 * mpgShare + 0.30 * usageShare;

                // Role multiplier
                const roleMult = idx < 5 ? 1.08 : idx < 7 ? 1.03 : 0.92;
                weight *= roleMult;

                // Injury multiplier (assume healthy for now)
                weight *= 1.0;

                return weight;
            });

            // Normalize weights to sum to 1
            const totalW = weights.reduce((s, w) => s + w, 0) || 1;
            const normWeights = weights.map(w => w / totalW);

            // Roster Strength Raw (Section 18D)
            const rosterOverallRaw = rotation.reduce((sum, p, i) =>
                sum + (p.rating?.ratingNum || 60) * normWeights[i], 0);

            // Roster Offense Raw (Section 18B)
            const rosterOffRaw = rotation.reduce((sum, p, i) =>
                sum + (parseFloat(p.rating?.offRating) || 60) * normWeights[i], 0);

            // Roster Defense Raw (Section 18C)
            const rosterDefRaw = rotation.reduce((sum, p, i) =>
                sum + (parseFloat(p.rating?.defRating) || 60) * normWeights[i], 0);

            // Star Power (top 3) (Section 4C Step 3)
            const top3 = sorted.slice(0, 3);
            const starPowerRaw = (top3[0]?.rating?.ratingNum || 60) * 0.50 +
                                 (top3[1]?.rating?.ratingNum || 60) * 0.30 +
                                 (top3[2]?.rating?.ratingNum || 60) * 0.20;

            // Depth (players 4-8) (Section 4C Step 4)
            const depth = sorted.slice(3, 8);
            const depthRaw = depth.length > 0 ?
                depth.reduce((sum, p) => sum + (p.rating?.ratingNum || 60), 0) / depth.length : 60;

            allRosterStrengthRaw.push(rosterOverallRaw);
            allStarPowerRaw.push(starPowerRaw);
            allDepthRaw.push(depthRaw);

            rosterDataByTeam[teamId] = {
                rosterOverallRaw, rosterOffRaw, rosterDefRaw,
                starPowerRaw, depthRaw
            };
        });

        // League-wide bounds for roster metrics
        const rosterBounds = tw(allRosterStrengthRaw);
        const starBounds = tw(allStarPowerRaw);
        const depthBounds = tw(allDepthRaw);

        // Collect all roster off/def for normalization
        const allRosterOff = rankings.map(r => rosterDataByTeam[r.id]?.rosterOffRaw || 60);
        const allRosterDef = rankings.map(r => rosterDataByTeam[r.id]?.rosterDefRaw || 60);
        const rosterOffBounds = tw(allRosterOff);
        const rosterDefBounds = tw(allRosterDef);

        // Second pass: compute all team scores
        rankings.forEach(r => {
            const rd = rosterDataByTeam[r.id] || {};

            // --- Team Offense Score (Section 4B-1) ---
            // Simplified: use PPG percentile + roster offense
            const teamOffenseScore = 100 * (
                0.55 * this.norm(r.stats.ppg, ppgBounds.min, ppgBounds.max) +
                0.25 * this.norm(r.stats.winPct, winPctBounds.min, winPctBounds.max) +
                0.20 * this.normInverse(r.stats.oppPpg, oppPpgBounds.min, oppPpgBounds.max) * 0.3  // slight defensive adjustment
            );

            // --- Team Defense Score (Section 4B-2) ---
            const teamDefenseScore = 100 * (
                0.55 * this.normInverse(r.stats.oppPpg, oppPpgBounds.min, oppPpgBounds.max) +
                0.25 * this.norm(r.stats.winPct, winPctBounds.min, winPctBounds.max) +
                0.20 * this.norm(r.stats.ppg, ppgBounds.min, ppgBounds.max) * 0.3
            );

            // --- Team Results Score (Section 4B-3) ---
            const teamResultsScore = 100 * (
                0.50 * this.norm(r.stats.winPct, winPctBounds.min, winPctBounds.max) +
                0.35 * this.norm(r.stats.netRtg, netRtgBounds.min, netRtgBounds.max) +
                0.15 * this.norm(r.stats.winPct, winPctBounds.min, winPctBounds.max) // proxy for last10
            );

            // --- Schedule/Context Score (Section 4B-4) ---
            // Approximate: use away performance proxy (net rating under-performance = harder schedule)
            const scheduleContextScore = 50; // Neutral — ESPN doesn't provide SOS directly

            // --- Roster Strength Score (Section 4C Step 5) ---
            const rotationStrengthScore = 100 * this.norm(rd.rosterOverallRaw || 60, rosterBounds.min, rosterBounds.max);
            const starPowerScore = 100 * this.norm(rd.starPowerRaw || 60, starBounds.min, starBounds.max);
            const depthScore = 100 * this.norm(rd.depthRaw || 60, depthBounds.min, depthBounds.max);

            const rosterStrengthScore = 0.55 * rotationStrengthScore + 0.25 * starPowerScore + 0.20 * depthScore;

            // --- Roster OFF/DEF Scores (Section 18B/18C) ---
            const teamRosterOffenseScore = 100 * this.norm(rd.rosterOffRaw || 60, rosterOffBounds.min, rosterOffBounds.max);
            const teamRosterDefenseScore = 100 * this.norm(rd.rosterDefRaw || 60, rosterDefBounds.min, rosterDefBounds.max);
            const teamRosterOverallScore = rosterStrengthScore;

            // --- Final Team Offensive Score (Section 19A) ---
            const finalTeamOffenseScore = 0.72 * teamOffenseScore + 0.28 * teamRosterOffenseScore;
            let teamOffOverall = 64 + 31 * Math.pow(finalTeamOffenseScore / 100, 0.90);
            teamOffOverall = Math.max(62, Math.min(95, teamOffOverall));

            // --- Final Team Defensive Score (Section 19B) ---
            const finalTeamDefenseScore = 0.74 * teamDefenseScore + 0.26 * teamRosterDefenseScore;
            let teamDefOverall = 64 + 31 * Math.pow(finalTeamDefenseScore / 100, 0.90);
            teamDefOverall = Math.max(62, Math.min(95, teamDefOverall));

            // --- Final Team Overall (Section 19C) ---
            // Recalibrated to favor Roster Strength (Star Power + Rotation)
            // 35% Roster influence instead of 22%
            const teamRaw =
                0.20 * finalTeamOffenseScore +
                0.20 * finalTeamDefenseScore +
                0.17 * teamResultsScore +
                0.08 * scheduleContextScore +
                0.35 * teamRosterOverallScore;

            let teamOverall = 62 + 33 * Math.pow(teamRaw / 100, 0.88);
            teamOverall = Math.max(60, Math.min(95, teamOverall));

            r.stats.offRating = teamOffOverall.toFixed(1);
            r.stats.defRating = teamDefOverall.toFixed(1);
            r.stats.ovrRating = teamOverall.toFixed(1);

            // Store extra metrics for UI
            r.stats.rosterStrength = rosterStrengthScore.toFixed(1);
            r.stats.starPower = starPowerScore.toFixed(1);
            r.stats.depth = depthScore.toFixed(1);
        });

        // Sort by OVR descending
        rankings.sort((a, b) => parseFloat(b.stats.ovrRating) - parseFloat(a.stats.ovrRating));
        rankings = rankings.map((r, i) => ({ ...r, rank: i + 1 }));

        store.setRankings(rankings);
    },


    // ==================== PLAYER LIST MANAGEMENT ====================

    /**
     * Rebuild the full player list from ALL rosters.
     * Must call computeLeagueStats() first for normalization.
     */
    updateAllPlayers() {
        // CRITICAL: compute league-wide bounds before rating anyone
        this.computeLeagueStats();

        const rosters = store.state.rosters;
        const teams = store.state.teams;
        let allPlayers = [];

        const teamLookup = {};
        teams.forEach(t => {
            teamLookup[t.id] = {
                abbreviation: t.abbreviation,
                displayName: t.displayName,
                logo: t.logos && t.logos[0] ? t.logos[0].href : ''
            };
        });

        Object.keys(rosters).forEach(teamId => {
            const rosterObj = rosters[teamId];
            if (!rosterObj || !rosterObj.athletes) return;

            const teamProfile = store.state.teamStats[teamId];
            const tStats = teamProfile ? this.generateAdvancedTeamStats(teamProfile) : null;
            const teamInfo = teamLookup[teamId] || { abbreviation: '???', displayName: 'Unknown', logo: '' };

            rosterObj.athletes.forEach(athlete => {
                const rating = this.generatePlayerRating(athlete, tStats);
                allPlayers.push({
                    ...athlete,
                    teamId,
                    teamAbbr: teamInfo.abbreviation,
                    teamName: teamInfo.displayName,
                    teamLogo: teamInfo.logo,
                    rating
                });
            });
        });

        allPlayers.sort((a, b) => b.rating.ratingNum - a.rating.ratingNum);
        store.setAllPlayers(allPlayers);
    },

    /**
     * Calculate Player of the Game from box score stats.
     */
    calculatePOTG(boxScorePlayers, winningTeamId) {
        if (!boxScorePlayers || boxScorePlayers.length === 0) return null;

        let bestScore = -Infinity;
        let potg = null;

        boxScorePlayers.forEach(p => {
            const pts = p.points || 0;
            const reb = p.rebounds || 0;
            const ast = p.assists || 0;
            const stl = p.steals || 0;
            const blk = p.blocks || 0;
            const tov = p.turnovers || 0;
            const min = p.minutes || 0;

            if (min < 10) return;

            let score = pts * 1.0 + reb * 1.2 + ast * 1.5 + stl * 2.0 + blk * 2.0 - tov * 1.5;

            let ddCount = 0;
            if (pts >= 10) ddCount++;
            if (reb >= 10) ddCount++;
            if (ast >= 10) ddCount++;
            if (ddCount >= 2) score += 3;
            if (ddCount >= 3) score += 5;

            if (winningTeamId && String(p.teamId) === String(winningTeamId)) {
                score += 2;
            }

            if (score > bestScore) {
                bestScore = score;
                potg = { ...p, impactScore: score };
            }
        });

        return potg;
    },

    /** Legacy alias */
    updateTopPlayers() {
        this.updateAllPlayers();
    }
};

window.models = models;
