/* ============================================================
   MODELS — Rating Engine
   Team OVR/OFF/DEF ratings, Player composite ratings
   ============================================================ */
const models = {

    /**
     * Generate advanced team stats from ESPN's team profile data.
     * AFTER player ratings are computed, team OFF/DEF are derived from
     * the roster's top 8 players' individual OFF/DEF ratings.
     */
    generateAdvancedTeamStats(teamRaw) {
        if (!teamRaw) return null;

        let wins = 0, losses = 0, ptsFor = 110, ptsAgainst = 110;

        if (teamRaw.record && teamRaw.record.items && teamRaw.record.items[0] && teamRaw.record.items[0].stats) {
            const record = teamRaw.record.items[0].stats;
            record.forEach(s => {
                if (s.name === 'wins') wins = s.value;
                if (s.name === 'losses') losses = s.value;
                if (s.name === 'pointsFor') ptsFor = s.value;
                if (s.name === 'pointsAgainst') ptsAgainst = s.value;
            });
        } else {
            const idNum = parseInt(teamRaw.id) || 1;
            wins = (idNum % 40) + 10;
            losses = 82 - wins;
            ptsFor = 110 + (idNum % 10);
            ptsAgainst = 112 - (idNum % 8);
        }

        const totalGames = (wins + losses) || 1;
        const winPct = wins / totalGames;
        const ppg = ptsFor / totalGames;
        const oppPpg = ptsAgainst / totalGames;
        const netRtg = ppg - oppPpg;
        const pace = 96 + (winPct * 3) + (Math.abs(netRtg) % 4);

        // Determine streak
        let streak = '--';
        if (teamRaw.record && teamRaw.record.items) {
            teamRaw.record.items.forEach(item => {
                if (item.stats) {
                    item.stats.forEach(s => {
                        if (s.name === 'streak') {
                            if (s.displayValue) {
                                streak = s.displayValue;
                            } else if (s.value !== undefined && s.value !== 0) {
                                const val = Math.abs(Math.round(s.value));
                                streak = s.value > 0 ? `W${val}` : `L${val}`;
                            }
                        }
                    });
                }
            });
        }

        return {
            wins, losses, winPct,
            ppg, oppPpg, netRtg, pace,
            // Placeholder OFF/DEF — will be overwritten by updateTeamRankings
            offRating: '50.00',
            defRating: '50.00',
            ovrRating: '50.00',
            streak
        };
    },

    /**
     * Update team rankings from all team stats.
     * Now derives team OFF/DEF from the roster's top 8 players.
     */
    updateTeamRankings() {
        const teams = store.state.teams;
        const teamStatsMap = store.state.teamStats;

        // First pass: gather base stats
        let rankings = [];
        let allPpg = [], allOppPpg = [];

        teams.forEach(team => {
            const baseStats = this.generateAdvancedTeamStats(teamStatsMap[team.id]);
            if (baseStats) {
                rankings.push({ id: team.id, team, stats: baseStats });
                allPpg.push(baseStats.ppg);
                allOppPpg.push(baseStats.oppPpg);
            }
        });

        // Compute percentile helpers
        allPpg.sort((a, b) => a - b);
        allOppPpg.sort((a, b) => a - b);
        const percentile = (arr, val) => {
            const idx = arr.findIndex(v => v >= val);
            return idx < 0 ? 100 : (idx / arr.length) * 100;
        };
        const invPercentile = (arr, val) => {
            // Lower oppPpg = better defense
            const idx = arr.findIndex(v => v >= val);
            return idx < 0 ? 0 : (1 - idx / arr.length) * 100;
        };

        // Second pass: compute team OVR/OFF/DEF using MULTIPLE realistic factors
        // Goal: best teams ~88-92, average ~72-76, worst ~55-62
        rankings.forEach(r => {
            const teamId = r.id;
            const roster = store.state.players.filter(p => String(p.teamId) === String(teamId));

            // ---- FACTOR 1: Top 8 Player OVR Average (raw talent) ----
            let top8Avg = 65;
            let rosterDepth70 = 0; // count of players rated 70+
            if (roster.length > 0) {
                const sortedByOvr = roster.slice()
                    .sort((a, b) => (b.rating?.ratingNum || 0) - (a.rating?.ratingNum || 0));
                const top8 = sortedByOvr.slice(0, 8);
                top8Avg = top8.reduce((sum, p) => sum + (p.rating?.ratingNum || 60), 0) / top8.length;
                rosterDepth70 = sortedByOvr.filter(p => (p.rating?.ratingNum || 0) >= 70).length;
            }

            // ---- FACTOR 2: Win percentage (most important real-world signal) ----
            const winScore = r.stats.winPct * 100; // 0-100

            // ---- FACTOR 3: Net Rating (point differential per game) ----
            const netRtg = r.stats.netRtg || 0;
            // Normalize: +10 net = 100, -10 net = 0
            const netRtgScore = Math.max(0, Math.min(100, (netRtg + 10) * 5));

            // ---- FACTOR 4: Roster depth bonus (how many 70+ OVR players) ----
            // Best teams have 6-8 solid players, worst have 1-2
            const depthScore = Math.min((rosterDepth70 / 8) * 100, 100);

            // ---- FACTOR 5: PPG percentile & defensive percentile ----
            const ppgPct = percentile(allPpg, r.stats.ppg);
            const defPct = invPercentile(allOppPpg, r.stats.oppPpg);

            // ---- BLEND into Team OVR (all factors on 0-100 scale) ----
            const rawOvr = (
                top8Avg * 0.25 +      // Talent matters
                winScore * 0.30 +      // Record matters most
                netRtgScore * 0.20 +   // Point differential
                depthScore * 0.10 +    // Depth bonus
                ((ppgPct + defPct) / 2) * 0.15  // Offensive/defensive team stats
            );

            // Scale raw (typically 30-85) to desired range (55-95)
            const ovrRating = Math.max(55, Math.min(95, rawOvr * 0.65 + 35));

            // ---- Team OFF/DEF from player individual ratings (normalized) ----
            let playerOffAvg = 50, playerDefAvg = 50;
            if (roster.length > 0) {
                const sortedByOff = roster.slice()
                    .sort((a, b) => (parseFloat(b.rating?.offRating) || 0) - (parseFloat(a.rating?.offRating) || 0))
                    .slice(0, 8);
                const sortedByDef = roster.slice()
                    .sort((a, b) => (parseFloat(b.rating?.defRating) || 0) - (parseFloat(a.rating?.defRating) || 0))
                    .slice(0, 8);

                playerOffAvg = sortedByOff.reduce((sum, p) => sum + (parseFloat(p.rating?.offRating) || 0), 0) / sortedByOff.length;
                playerDefAvg = sortedByDef.reduce((sum, p) => sum + (parseFloat(p.rating?.defRating) || 0), 0) / sortedByDef.length;
            }

            // Blend player OFF/DEF with team stats, then normalize to 55-95 range
            let offRating = (playerOffAvg * 0.45) + (ppgPct * 0.30) + (winScore * 0.25);
            let defRating = (playerDefAvg * 0.45) + (defPct * 0.30) + (winScore * 0.25);

            offRating = Math.max(55, Math.min(95, offRating * 0.65 + 35));
            defRating = Math.max(55, Math.min(95, defRating * 0.65 + 35));

            r.stats.offRating = offRating.toFixed(1);
            r.stats.defRating = defRating.toFixed(1);
            r.stats.ovrRating = ovrRating.toFixed(1);
        });

        // Sort by OVR descending
        rankings.sort((a, b) => parseFloat(b.stats.ovrRating) - parseFloat(a.stats.ovrRating));
        rankings = rankings.map((r, i) => ({ ...r, rank: i + 1 }));

        store.setRankings(rankings);
    },

    /**
     * Generate player rating — 2K-style, stats-driven.
     *
     * For players WITH real stats:
     *   Build an impact score from PPG, RPG, APG, SPG, BPG, FG%, MPG
     *   Map to tiers: Elite (88-99), All-Star (80-88), Starter (72-80),
     *   Rotation (64-72), Bench (55-64), Deep Bench (40-55)
     *
     * For players WITHOUT real stats:
     *   Use salary as proxy with wider distribution (45-78 range)
     */
    generatePlayerRating(athlete, teamStats) {
        // ------ Position detection ------
        const posName = athlete.position?.name || athlete.position?.abbreviation || '';
        const isBig = /Forward|Center|F|C|PF|SF/i.test(posName);
        const isGuard = /Guard|G|PG|SG/i.test(posName);
        const posAbbrev = athlete.position?.abbreviation || (isBig ? 'F' : isGuard ? 'G' : 'G-F');

        // ------ Salary factor (used as fallback / minor factor) ------
        let salary = 1000000;
        if (athlete.contract && athlete.contract.salary) {
            salary = athlete.contract.salary;
        } else if (athlete.contracts && athlete.contracts[0] && athlete.contracts[0].salary) {
            salary = athlete.contracts[0].salary;
        }
        const maxSalary = 55000000;
        const salaryFactor = Math.min(salary / maxSalary, 1.0);

        // ------ Stats: prefer real, fallback to estimates ------
        let ppg, rpg, apg, spg, bpg, gp, mpg, fgPct;
        let hasRealStats = false;

        if (athlete.realStats && (athlete.realStats.gp > 0 || athlete.realStats.ppg > 0)) {
            hasRealStats = true;
            ppg = athlete.realStats.ppg || 0;
            rpg = athlete.realStats.rpg || 0;
            apg = athlete.realStats.apg || 0;
            spg = athlete.realStats.spg || 0;
            bpg = athlete.realStats.bpg || 0;
            gp = athlete.realStats.gp || 0;
            mpg = athlete.realStats.mpg || 0;
            fgPct = athlete.realStats.fgPct > 1 ? athlete.realStats.fgPct / 100 : (athlete.realStats.fgPct || 0.45);
        } else {
            // Salary-based stat estimation
            const teamPpg = (teamStats && teamStats.ppg) ? teamStats.ppg : 110;
            const ppgMult = teamPpg / 110.0;
            const idVar = (parseInt(athlete.id) || 0) % 5;

            ppg = ((salaryFactor * 20) + idVar * 0.5) * ppgMult;
            rpg = isBig ? (salaryFactor * 8 + 2) : (salaryFactor * 3 + 1);
            apg = isGuard ? ((salaryFactor * 6 + 1) * ppgMult) : ((salaryFactor * 2 + 0.3) * ppgMult);
            spg = salaryFactor * 1.0 + 0.3;
            bpg = isBig ? (salaryFactor * 1.2 + 0.2) : (salaryFactor * 0.3 + 0.1);
            fgPct = isBig ? 0.50 + (idVar / 100) : 0.42 + (idVar / 100);

            const isActive = athlete.status && athlete.status.id === '1';
            let gpPct = isActive ? (0.3 + (salaryFactor * 0.6)) : 0.0;
            if (gpPct > 0.95) gpPct = 0.95 + (idVar / 100);
            gp = Math.round(82 * gpPct);
            mpg = salaryFactor * 28 + 5;
        }

        // ------ Individual Offense & Defense Ratings ------
        // Offense: scoring + playmaking + efficiency
        const fgBonus = ((fgPct || 0.45) - 0.40) * 80; // 0.45 FG% = 4 pts, 0.55 = 12 pts
        let offRating = Math.min(
            ppg * 1.8 + apg * 2.2 + fgBonus + (mpg || 0) * 0.1,
            99
        );
        offRating = Math.max(15, offRating);

        // Defense: boards + stocks + size
        const heightInches = athlete.height || 78;
        let defRating = Math.min(
            rpg * 1.8 + (spg || 0) * 4.5 + (bpg || 0) * 4.5 +
            (heightInches >= 82 ? 6 : heightInches >= 78 ? 3 : 0) +
            (mpg || 0) * 0.15,
            99
        );
        defRating = Math.max(15, defRating);

        // ------ Final OVR Rating ------
        let rating;
        if (hasRealStats) {
            // Impact Score — calibrated to NBA tiers
            // SGA (31.6/5.1/6.1/~2/~1) → ~62, Jokic (26/12/9/~1/~1) → ~63
            // Jalen Johnson (22.7/10.4/8.0) → ~48, bench (5/2/1) → ~10
            const impactScore = ppg * 1.0 + rpg * 0.7 + apg * 0.9 + (spg || 0) * 1.5 + (bpg || 0) * 1.5 + fgBonus * 0.5;

            // Minutes-based credibility — low MPG players get tempered
            const mpgFactor = mpg >= 32 ? 1.0 : mpg >= 25 ? 0.97 : mpg >= 18 ? 0.90 : mpg >= 10 ? 0.82 : 0.70;

            // Map impactScore to 2K-style tiers (tuned to real NBA)
            let tierRating;
            if (impactScore >= 55) {
                // MVP caliber — only Jokic, SGA, Giannis should reach here
                tierRating = 94 + Math.min((impactScore - 55) * 0.25, 5); // 94-99
            } else if (impactScore >= 45) {
                // All-NBA level (LeBron, KD, Curry, Luka, Tatum)
                tierRating = 89 + ((impactScore - 45) / 10) * 5; // 89-94
            } else if (impactScore >= 35) {
                // All-Star caliber (Brunson, Jalen Johnson, etc.)
                tierRating = 83 + ((impactScore - 35) / 10) * 6; // 83-89
            } else if (impactScore >= 25) {
                // Quality Starter
                tierRating = 76 + ((impactScore - 25) / 10) * 7; // 76-83
            } else if (impactScore >= 16) {
                // Rotation player
                tierRating = 67 + ((impactScore - 16) / 9) * 9; // 67-76
            } else if (impactScore >= 8) {
                // Bench player
                tierRating = 56 + ((impactScore - 8) / 8) * 11; // 56-67
            } else {
                // Deep bench / end of roster
                tierRating = 42 + (impactScore / 8) * 14; // 42-56
            }

            rating = tierRating * mpgFactor;

            // Tiny salary bonus (max 1.5 pts) — recognizes established stars
            const expBonus = Math.min(salaryFactor * 1.5, 1.5);
            rating += expBonus;

        } else {
            // No real stats — salary-based with wider distribution
            const age = athlete.age || 25;
            const primeFactor = (age >= 26 && age <= 31) ? 1.03 : 1.0;
            rating = (45 + (salaryFactor * 33)) * primeFactor;
        }

        // Availability penalty
        const gpPct = gp / 82;
        if (gpPct < 0.4 && gpPct > 0) {
            rating -= (0.4 - gpPct) * 6;
        } else if (gp === 0) {
            rating -= 4;
        }

        rating = Math.max(40, Math.min(Math.round(rating * 10) / 10, 99));

        return {
            rating: rating.toFixed(1),
            ratingNum: rating,
            offRating: offRating.toFixed(1),
            defRating: defRating.toFixed(1),
            pts: ppg.toFixed(1),
            reb: rpg.toFixed(1),
            ast: apg.toFixed(1),
            stl: (spg || 0).toFixed(1),
            blk: (bpg || 0).toFixed(1),
            gp: Math.round(gp),
            mpg: (mpg || 0).toFixed(1),
            posAbbrev,
            hasRealStats
        };
    },

    /**
     * Rebuild the full player list from ALL rosters.
     */
    updateAllPlayers() {
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
     * Uses a basketball-smart impact formula.
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

            if (min < 10) return; // Must have played decent minutes

            let score = pts * 1.0 + reb * 1.2 + ast * 1.5 + stl * 2.0 + blk * 2.0 - tov * 1.5;

            // Double-double bonus
            let ddCount = 0;
            if (pts >= 10) ddCount++;
            if (reb >= 10) ddCount++;
            if (ast >= 10) ddCount++;
            if (stl >= 10) ddCount++;
            if (blk >= 10) ddCount++;
            if (ddCount >= 2) score += 3;
            if (ddCount >= 3) score += 5; // Triple-double

            // Winner bonus
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

    // Legacy alias
    updateTopPlayers() {
        this.updateAllPlayers();
    }
};

window.models = models;
