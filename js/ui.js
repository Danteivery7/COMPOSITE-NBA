/* ============================================================
   UI — Rendering Engine
   All DOM rendering, navigation, filters, and detail views
   ============================================================ */
const ui = {

    init() {
        this.bindNav();
        this.bindTheme();
        this.bindSettings();
        this.bindPlayerFilters();

        setTimeout(() => {
            const activeTab = document.querySelector('.nav-btn.active');
            if (activeTab) activeTab.click();
        }, 500);
    },

    // ==================== NAVIGATION ====================
    bindNav() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                if (!tab) return;

                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll(`.nav-btn[data-tab="${tab}"]`).forEach(b => b.classList.add('active'));

                document.querySelectorAll('.pane').forEach(p => {
                    p.classList.remove('active');
                    p.classList.add('hidden');
                });

                const pane = document.getElementById(`pane-${tab}`);
                if (pane) {
                    pane.classList.remove('hidden');
                    pane.classList.add('active');
                }

                // Trigger renders on tab switch
                if (tab === 'rankings') {
                    this.renderRankings(store.state.teamRankings);
                    this.renderPredictorSetup();
                } else if (tab === 'teams') {
                    this.renderTeamsList(store.state.teams);
                } else if (tab === 'players') {
                    this.renderPlayersList(store.state.players);
                } else if (tab === 'live') {
                    this.renderLiveGames(store.state.games);
                } else if (tab === 'favorites') {
                    this.renderFavorites();
                }
            });
        });
    },

    bindTheme() {
        document.getElementById('theme-toggle').addEventListener('click', () => {
            store.toggleTheme();
        });

        const rankingSort = document.getElementById('ranking-sort');
        if (rankingSort) {
            rankingSort.addEventListener('change', (e) => {
                const sortBy = e.target.value;
                const rankings = [...store.state.teamRankings];
                if (sortBy === 'ovr') {
                    rankings.sort((a, b) => parseFloat(b.stats.ovrRating) - parseFloat(a.stats.ovrRating));
                } else if (sortBy === 'off') {
                    rankings.sort((a, b) => parseFloat(b.stats.offRating) - parseFloat(a.stats.offRating));
                } else if (sortBy === 'def') {
                    rankings.sort((a, b) => parseFloat(b.stats.defRating) - parseFloat(a.stats.defRating));
                } else if (sortBy === 'record') {
                    rankings.sort((a, b) => b.stats.winPct - a.stats.winPct);
                } else if (sortBy === 'hot') {
                    // Sort by win streak (hottest teams first)
                    rankings.sort((a, b) => {
                        const parseStreak = (s) => {
                            if (!s || s === '--') return 0;
                            const isWin = s.startsWith('W');
                            const num = parseInt(s.replace(/[WL]/i, '')) || 0;
                            return isWin ? num : -num;
                        };
                        return parseStreak(b.stats.streak) - parseStreak(a.stats.streak);
                    });
                }
                this.renderRankings(rankings);
            });
        }
    },

    bindSettings() {
        const presetSelect = document.getElementById('settings-preset');
        if (presetSelect) {
            presetSelect.addEventListener('change', (e) => {
                store.setPreset(e.target.value);
                models.updateTeamRankings();
            });
        }
    },

    bindPlayerFilters() {
        const posFilter = document.getElementById('player-position-filter');
        const teamFilter = document.getElementById('player-team-filter');

        if (posFilter) {
            posFilter.addEventListener('change', () => this.renderPlayersList(store.state.players));
        }
        if (teamFilter) {
            teamFilter.addEventListener('change', () => this.renderPlayersList(store.state.players));
        }
    },

    // ==================== HELPERS ====================
    formatTimestamp(ts) {
        if (!ts) return 'Never';
        return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    },

    getBadgeClass(rating) {
        const r = parseFloat(rating) || 0;
        if (r >= 88) return 'badge-elite';
        if (r >= 82) return 'badge-allstar';
        if (r >= 76) return 'badge-starter';
        if (r >= 67) return 'badge-roleplayer';
        if (r >= 55) return 'badge-bench';
        return 'badge-deepbench';
    },

    getBadgeLabel(rating) {
        const r = parseFloat(rating) || 0;
        if (r >= 88) return 'Elite';
        if (r >= 82) return 'All-Star';
        if (r >= 76) return 'Starter';
        if (r >= 67) return 'Role Player';
        if (r >= 55) return 'Bench';
        return 'Deep Bench';
    },

    // ==================== LIVE GAMES ====================
    renderLiveGames(games) {
        const container = document.getElementById('live-games-container');
        const statusText = document.getElementById('live-status-text');
        if (!games || games.length === 0) {
            container.innerHTML = '<div class="card" style="padding:32px; text-align:center; color:var(--text-secondary);"><div style="font-size:40px; margin-bottom:12px;">🏀</div>No games scheduled today.</div>';
            if (statusText) statusText.textContent = 'No Games';
            return;
        }

        const now = new Date();
        const activeGames = games.filter(g => {
            const state = g.status?.type?.state;
            if (state === 'post') {
                const endDate = new Date(g.date);
                const hoursSince = (now - endDate) / (1000 * 60 * 60);
                return hoursSince < 15;
            }
            return true;
        });

        const liveCount = activeGames.filter(g => g.status?.type?.state === 'in').length;
        if (statusText) {
            statusText.textContent = liveCount > 0 ? `${liveCount} Live` : 'Updated';
        }

        container.innerHTML = activeGames.map(game => this.createGameCard(game, now)).join('');

        // Bind click handlers for expand/collapse
        container.querySelectorAll('.game-card[data-game-id]').forEach(card => {
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                const gameId = card.dataset.gameId;
                const detail = card.querySelector('.game-detail-panel');
                if (!detail) return;

                const isOpen = detail.classList.contains('open');
                // Close all others first
                container.querySelectorAll('.game-detail-panel.open').forEach(p => {
                    p.classList.remove('open');
                    p.style.maxHeight = '0';
                });

                if (!isOpen) {
                    detail.classList.add('open');
                    detail.style.maxHeight = detail.scrollHeight + 'px';

                    // If not loaded yet, fetch detail data
                    if (!detail.dataset.loaded) {
                        this.loadGameDetail(gameId, detail, card.dataset.gameState);
                    }
                }
            });
        });
    },

    async loadGameDetail(gameId, panel, state) {
        panel.innerHTML = '<div style="text-align:center; padding:16px; color:var(--text-tertiary); font-size:12px;">Loading game details...</div>';
        panel.style.maxHeight = panel.scrollHeight + 'px';

        const summary = await api.fetchGameSummary(gameId);
        if (!summary) {
            panel.innerHTML = '<div style="text-align:center; padding:16px; color:var(--text-tertiary);">Unable to load details</div>';
            panel.style.maxHeight = panel.scrollHeight + 'px';
            return;
        }

        panel.dataset.loaded = 'true';
        let html = '';

        if (state === 'pre') {
            html = this.buildPreGameDetail(summary);
        } else if (state === 'in') {
            html = this.buildLiveGameDetail(summary);
        } else {
            html = this.buildPostGameDetail(summary);
        }

        panel.innerHTML = html;
        panel.style.maxHeight = panel.scrollHeight + 'px';
    },

    // ==================== PRE-GAME DETAIL ====================
    buildPreGameDetail(summary) {
        const boxscore = summary.boxscore;
        const teams = boxscore?.teams || [];
        const away = teams[0];
        const home = teams[1];

        // Get team ratings from our store
        const getTeamRating = (teamId) => {
            const r = store.state.teamRankings.find(t => String(t.id) === String(teamId));
            return r ? r.stats : null;
        };

        const awayStats = getTeamRating(away?.team?.id);
        const homeStats = getTeamRating(home?.team?.id);

        // Build team stat comparison
        const comparisons = [];
        if (awayStats && homeStats) {
            comparisons.push({ label: 'OVR', away: awayStats.ovrRating, home: homeStats.ovrRating });
            comparisons.push({ label: 'OFF', away: awayStats.offRating, home: homeStats.offRating });
            comparisons.push({ label: 'DEF', away: awayStats.defRating, home: homeStats.defRating });
        }

        // Season series / key stats from summary
        const keyFacts = summary.keyEvents || summary.article?.keywords || [];

        // Prediction
        let predHtml = '';
        if (summary.predictor) {
            const awayChance = summary.predictor.awayTeam?.gameProjection || summary.predictor.awayTeam?.chance || '';
            const homeChance = summary.predictor.homeTeam?.gameProjection || summary.predictor.homeTeam?.chance || '';
            if (awayChance || homeChance) {
                predHtml = `
                    <div style="margin-top:12px; padding:10px; background:var(--bg-surface); border-radius:8px;">
                        <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase; font-weight:700; letter-spacing:0.5px; margin-bottom:8px;">ESPN Win Probability</div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="text-align:center; flex:1;">
                                <div style="font-size:20px; font-weight:800; color:${parseFloat(awayChance) > 50 ? 'var(--success-color)' : 'var(--text-secondary)'};">${parseFloat(awayChance).toFixed(1)}%</div>
                                <div style="font-size:10px; color:var(--text-tertiary);">${away?.team?.abbreviation}</div>
                            </div>
                            <div style="font-size:11px; color:var(--text-tertiary); font-weight:700;">VS</div>
                            <div style="text-align:center; flex:1;">
                                <div style="font-size:20px; font-weight:800; color:${parseFloat(homeChance) > 50 ? 'var(--success-color)' : 'var(--text-secondary)'};">${parseFloat(homeChance).toFixed(1)}%</div>
                                <div style="font-size:10px; color:var(--text-tertiary);">${home?.team?.abbreviation}</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        return `
            <div style="padding:12px 0;">
                <div style="font-size:10px; color:var(--brand-accent); text-transform:uppercase; font-weight:700; letter-spacing:1px; margin-bottom:10px;">📋 Matchup Preview</div>
                ${comparisons.length ? `
                    <div style="display:grid; grid-template-columns:1fr auto 1fr; gap:6px; margin-bottom:12px;">
                        ${comparisons.map(c => {
                            const awayVal = parseFloat(c.away) || 0;
                            const homeVal = parseFloat(c.home) || 0;
                            const awayWins = awayVal > homeVal;
                            return `
                                <div style="text-align:center; font-size:15px; font-weight:800; color:${awayWins ? 'var(--success-color)' : 'var(--text-secondary)'};">${c.away}</div>
                                <div style="text-align:center; font-size:10px; color:var(--text-tertiary); font-weight:600; padding-top:3px;">${c.label}</div>
                                <div style="text-align:center; font-size:15px; font-weight:800; color:${!awayWins ? 'var(--success-color)' : 'var(--text-secondary)'};">${c.home}</div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
                ${predHtml}
                <div style="margin-top:10px; text-align:center; font-size:10px; color:var(--text-tertiary);">Tap to view more • Data via ESPN</div>
            </div>
        `;
    },

    // ==================== LIVE GAME DETAIL ====================
    buildLiveGameDetail(summary) {
        const boxscore = summary.boxscore;
        const players = boxscore?.players || [];

        let statsHtml = '';
        players.forEach(teamBlock => {
            const teamAbbr = teamBlock.team?.abbreviation || '?';
            const stats = teamBlock.statistics || [];
            if (stats.length === 0) return;

            // Get top 5 scorers from the `athletes` array
            const athleteStats = stats[0]?.athletes || [];
            const sorted = athleteStats.slice().sort((a, b) => {
                const apts = parseFloat(a.stats?.[0]) || 0;  // PTS is usually first
                const bpts = parseFloat(b.stats?.[0]) || 0;
                return bpts - apts;
            }).slice(0, 5);

            const headers = stats[0]?.labels?.slice(0, 6) || ['MIN', 'FG', '3PT', 'FT', 'REB', 'AST'];

            statsHtml += `
                <div style="margin-bottom:10px;">
                    <div style="font-size:11px; font-weight:700; color:var(--text-primary); margin-bottom:6px;">${teamAbbr}</div>
                    <table style="width:100%; border-collapse:collapse; font-size:10px;">
                        <thead>
                            <tr style="color:var(--text-tertiary);">
                                <th style="text-align:left; padding:2px 4px; font-weight:600;">Player</th>
                                ${headers.map(h => `<th style="text-align:center; padding:2px 3px; font-weight:600;">${h}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${sorted.map(a => `
                                <tr style="color:var(--text-secondary);">
                                    <td style="padding:2px 4px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:90px;">${a.athlete?.shortName || '?'}</td>
                                    ${(a.stats || []).slice(0, 6).map((s, i) => `<td style="text-align:center; padding:2px 3px; font-variant-numeric:tabular-nums; ${i === 0 ? 'font-weight:700; color:var(--text-primary);' : ''}">${s}</td>`).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });

        return `
            <div style="padding:12px 0;">
                <div style="font-size:10px; color:var(--live-color); text-transform:uppercase; font-weight:700; letter-spacing:1px; margin-bottom:10px;">
                    <span class="dot pulse" style="display:inline-block;width:6px;height:6px;background:var(--live-color);border-radius:50%;margin-right:5px;vertical-align:middle;"></span>
                    Live Box Score
                </div>
                ${statsHtml || '<div style="font-size:11px; color:var(--text-tertiary); text-align:center;">Box score loading...</div>'}
            </div>
        `;
    },

    // ==================== POST-GAME DETAIL ====================
    buildPostGameDetail(summary) {
        const boxscore = summary.boxscore;
        const players = boxscore?.players || [];

        let statsHtml = '';
        players.forEach(teamBlock => {
            const teamAbbr = teamBlock.team?.abbreviation || '?';
            const teamColor = teamBlock.team?.color ? `#${teamBlock.team.color}` : 'var(--brand-accent)';
            const stats = teamBlock.statistics || [];
            if (stats.length === 0) return;

            const athleteStats = stats[0]?.athletes || [];
            const sorted = athleteStats.slice().sort((a, b) => {
                const apts = parseFloat(a.stats?.[0]) || 0;
                const bpts = parseFloat(b.stats?.[0]) || 0;
                return bpts - apts;
            }).slice(0, 6);

            const headers = stats[0]?.labels?.slice(0, 7) || ['MIN', 'FG', '3PT', 'FT', 'REB', 'AST', 'PTS'];

            statsHtml += `
                <div style="margin-bottom:12px;">
                    <div style="font-size:11px; font-weight:700; color:var(--text-primary); margin-bottom:6px; display:flex; align-items:center; gap:6px;">
                        <span style="width:3px; height:14px; background:${teamColor}; border-radius:2px; display:inline-block;"></span>
                        ${teamAbbr}
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:10px;">
                        <thead>
                            <tr style="color:var(--text-tertiary);">
                                <th style="text-align:left; padding:2px 4px; font-weight:600;">Player</th>
                                ${headers.map(h => `<th style="text-align:center; padding:2px 3px; font-weight:600;">${h}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${sorted.map(a => {
                                const pts = parseFloat(a.stats?.[a.stats.length - 1]) || 0;
                                const isTopScorer = pts >= 25;
                                return `
                                    <tr style="color:${isTopScorer ? 'var(--text-primary)' : 'var(--text-secondary)'}; ${isTopScorer ? 'font-weight:600;' : ''}">
                                        <td style="padding:2px 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:90px;">${a.athlete?.shortName || '?'}</td>
                                        ${(a.stats || []).slice(0, 7).map((s, i) => `<td style="text-align:center; padding:2px 3px; font-variant-numeric:tabular-nums; ${i === headers.length - 1 ? 'font-weight:700; color:var(--brand-accent);' : ''}">${s}</td>`).join('')}
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });

        // POTG from game summary
        let potgHtml = '';
        const mvpAward = summary.header?.competitions?.[0]?.status?.type?.state === 'post'
            ? summary.header?.competitions?.[0]?.competitors : null;

        return `
            <div style="padding:12px 0;">
                <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase; font-weight:700; letter-spacing:1px; margin-bottom:10px;">📊 Final Box Score</div>
                ${statsHtml || '<div style="font-size:11px; color:var(--text-tertiary); text-align:center;">No stats available</div>'}
            </div>
        `;
    },

    createGameCard(game, now) {
        const home = game.competitions[0].competitors.find(c => c.homeAway === 'home');
        const away = game.competitions[0].competitors.find(c => c.homeAway === 'away');
        const state = game.status?.type?.state || 'pre';
        const clock = game.status?.displayClock || '';
        const period = game.status?.period || 0;
        const date = new Date(game.date);
        const gameId = game.id;

        let statusText = '';
        let isLive = false;
        let statusClass = '';

        if (state === 'pre') {
            const minsToTip = (date - now) / 60000;
            if (minsToTip > 0 && minsToTip <= 5) {
                statusText = 'About to Start';
                statusClass = 'color:var(--warning-color)';
            } else if (minsToTip > 5 && minsToTip <= 30) {
                statusText = 'Starting Soon';
                statusClass = 'color:var(--warning-color)';
            } else {
                statusText = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            }
        } else if (state === 'in') {
            isLive = true;
            statusClass = 'color:var(--live-color)';
            if (period === 2 && clock === '0.0') {
                statusText = 'Halftime';
            } else if (clock === '0.0' && period < 4) {
                statusText = `End of Q${period}`;
            } else {
                statusText = `Q${period} ${clock}`;
            }
        } else if (state === 'post') {
            statusText = period > 4 ? `Final/OT${period - 4 > 1 ? period - 4 : ''}` : 'Final';
            statusClass = 'color:var(--text-secondary)';
        }

        const liveIndicator = isLive
            ? '<span class="dot pulse" style="display:inline-block;width:7px;height:7px;background:var(--live-color);border-radius:50%;margin-right:6px;vertical-align:middle;"></span>'
            : '';

        // ---- Quarter scores box score ----
        let quarterHtml = '';
        const homeLinescores = home?.linescores || [];
        const awayLinescores = away?.linescores || [];
        if ((state === 'in' || state === 'post') && (homeLinescores.length > 0 || awayLinescores.length > 0)) {
            const numQtrs = Math.max(homeLinescores.length, awayLinescores.length);
            let qHeaders = '';
            let awayQScores = '';
            let homeQScores = '';
            for (let q = 0; q < numQtrs; q++) {
                const label = q < 4 ? `Q${q + 1}` : `OT${q - 3}`;
                qHeaders += `<th style="font-size:10px; color:var(--text-tertiary); font-weight:600; padding:2px 6px; text-align:center;">${label}</th>`;
                awayQScores += `<td style="font-size:11px; padding:2px 6px; text-align:center; font-variant-numeric:tabular-nums;">${awayLinescores[q]?.value ?? '-'}</td>`;
                homeQScores += `<td style="font-size:11px; padding:2px 6px; text-align:center; font-variant-numeric:tabular-nums;">${homeLinescores[q]?.value ?? '-'}</td>`;
            }
            quarterHtml = `
                <div style="margin-top:10px; border-top:1px solid var(--divider); padding-top:8px;">
                    <table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <thead><tr>
                            <th style="width:40px;"></th>
                            ${qHeaders}
                            <th style="font-size:10px; color:var(--text-secondary); font-weight:700; padding:2px 6px; text-align:center;">T</th>
                        </tr></thead>
                        <tbody>
                            <tr style="color:var(--text-secondary);">
                                <td style="font-weight:700; font-size:11px; padding:2px 0;">${away?.team?.abbreviation || ''}</td>
                                ${awayQScores}
                                <td style="font-weight:800; padding:2px 6px; text-align:center; color:var(--text-primary);">${away?.score || 0}</td>
                            </tr>
                            <tr style="color:var(--text-secondary);">
                                <td style="font-weight:700; font-size:11px; padding:2px 0;">${home?.team?.abbreviation || ''}</td>
                                ${homeQScores}
                                <td style="font-weight:800; padding:2px 6px; text-align:center; color:var(--text-primary);">${home?.score || 0}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;
        }

        // ---- Leaders section ----
        let leadersHtml = '';
        const buildLeaderLine = (competitor) => {
            if (!competitor?.leaders || competitor.leaders.length === 0) return '';
            const lines = [];
            competitor.leaders.forEach(cat => {
                if (cat.leaders && cat.leaders[0]) {
                    const leader = cat.leaders[0];
                    const shortName = leader.athlete?.shortName || leader.athlete?.displayName || '?';
                    const val = leader.displayValue;
                    const label = cat.shortDisplayName || cat.abbreviation;
                    lines.push(`${shortName} ${val} ${label}`);
                }
            });
            return lines.slice(0, 2).join(' · ');
        };

        if (state === 'pre') {
            const awayLeaders = buildLeaderLine(away);
            const homeLeaders = buildLeaderLine(home);
            if (awayLeaders || homeLeaders) {
                leadersHtml = `
                    <div style="margin-top:10px; border-top:1px solid var(--divider); padding-top:8px;">
                        ${awayLeaders ? `<div style="font-size:10px; color:var(--text-tertiary); margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🔥 ${awayLeaders}</div>` : ''}
                        ${homeLeaders ? `<div style="font-size:10px; color:var(--text-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🔥 ${homeLeaders}</div>` : ''}
                    </div>
                `;
            }
        } else if (state === 'in') {
            const awayLeaders = buildLeaderLine(away);
            const homeLeaders = buildLeaderLine(home);
            if (awayLeaders || homeLeaders) {
                leadersHtml = `
                    <div style="margin-top:8px; border-top:1px solid var(--divider); padding-top:8px;">
                        ${awayLeaders ? `<div style="font-size:10px; color:var(--text-tertiary); margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">⚡ ${awayLeaders}</div>` : ''}
                        ${homeLeaders ? `<div style="font-size:10px; color:var(--text-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">⚡ ${homeLeaders}</div>` : ''}
                    </div>
                `;
            }
        } else if (state === 'post') {
            const allLeaders = [];
            [away, home].forEach(comp => {
                if (comp?.leaders) {
                    comp.leaders.forEach(cat => {
                        if (cat.name === 'rating' && cat.leaders && cat.leaders[0]) {
                            const l = cat.leaders[0];
                            allLeaders.push({
                                name: l.athlete?.shortName || l.athlete?.displayName || '?',
                                headshot: l.athlete?.headshot || '',
                                statline: l.displayValue || '',
                                value: l.value || 0
                            });
                        }
                    });
                }
            });
            if (allLeaders.length > 0) {
                allLeaders.sort((a, b) => b.value - a.value);
                const potg = allLeaders[0];
                leadersHtml = `
                    <div style="margin-top:8px; border-top:1px solid var(--divider); padding-top:8px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <img src="${potg.headshot}" width="24" height="24" style="border-radius:50%; background:var(--bg-elevated); flex-shrink:0;" onerror="this.style.display='none'">
                            <div style="min-width:0;">
                                <div style="font-size:10px; color:var(--brand-accent); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">⭐ Player of the Game</div>
                                <div style="font-size:11px; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${potg.name} — ${potg.statline}</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        // State-based accent bar
        let accentBar = '';
        if (state === 'in') {
            accentBar = 'border-left:3px solid var(--live-color);';
        } else if (state === 'post') {
            accentBar = 'border-left:3px solid var(--text-tertiary);';
        } else {
            accentBar = 'border-left:3px solid var(--brand-accent);';
        }

        // Expand hint
        const expandHint = `<div style="text-align:center; margin-top:8px; font-size:10px; color:var(--text-tertiary); opacity:0.6;">▼ Tap for ${state === 'pre' ? 'preview' : state === 'in' ? 'live stats' : 'box score'}</div>`;

        return `
            <div class="card game-card" data-game-id="${gameId}" data-game-state="${state}" style="cursor:pointer; ${accentBar} transition: all 0.2s ease;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                    <span style="font-size:12px; font-weight:700; ${statusClass}">
                        ${liveIndicator}${statusText}
                    </span>
                    <span style="font-size:11px; color:var(--text-tertiary); font-weight:500;">${game.shortName || ''}</span>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <img src="${away?.team?.logo || ''}" width="32" height="32" style="border-radius:4px;" onerror="this.style.display='none'">
                        <div>
                            <div style="font-weight:700; font-size:15px;">${away?.team?.abbreviation || '???'}</div>
                            <div style="font-size:11px; color:var(--text-tertiary);">${away?.records?.[0]?.summary || ''}</div>
                        </div>
                    </div>
                    <div style="font-size:24px; font-weight:800; opacity:${state === 'pre' ? '0.25' : '1'}; font-variant-numeric:tabular-nums;">${away?.score || '0'}</div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <img src="${home?.team?.logo || ''}" width="32" height="32" style="border-radius:4px;" onerror="this.style.display='none'">
                        <div>
                            <div style="font-weight:700; font-size:15px;">${home?.team?.abbreviation || '???'}</div>
                            <div style="font-size:11px; color:var(--text-tertiary);">${home?.records?.[0]?.summary || ''}</div>
                        </div>
                    </div>
                    <div style="font-size:24px; font-weight:800; opacity:${state === 'pre' ? '0.25' : '1'}; font-variant-numeric:tabular-nums;">${home?.score || '0'}</div>
                </div>

                ${quarterHtml}
                ${leadersHtml}
                ${expandHint}

                <div class="game-detail-panel" style="max-height:0; overflow:hidden; transition:max-height 0.35s ease;"></div>
            </div>
        `;
    },

    // ==================== RANKINGS ====================
    renderRankings(rankings) {
        const tbody = document.getElementById('rankings-table-body');
        if (!rankings || rankings.length === 0) return;

        tbody.innerHTML = rankings.map((r, i) => `
            <tr style="cursor:pointer;" onclick="ui.showTeamDetail('${r.id}')">
                <td style="font-weight:800; color:var(--text-tertiary); width:40px;">${i + 1}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:12px;">
                        <img src="${r.team?.logos?.[0]?.href || ''}" width="28" height="28" style="border-radius:4px;" onerror="this.style.display='none'">
                        <span style="font-weight:600;">${r.team?.displayName || 'Unknown'}</span>
                    </div>
                </td>
                <td style="font-weight:700; color:var(--brand-accent); font-variant-numeric:tabular-nums;">${r.stats?.ovrRating || '0.00'}</td>
                <td style="font-weight:600; font-variant-numeric:tabular-nums;">${r.stats?.offRating || '0.00'}</td>
                <td style="font-weight:600; font-variant-numeric:tabular-nums;">${r.stats?.defRating || '0.00'}</td>
                <td style="color:var(--text-secondary); font-variant-numeric:tabular-nums;">${r.stats?.wins || 0}-${r.stats?.losses || 0}</td>
                <td style="color:var(--text-tertiary); font-size:12px;">${r.stats?.streak || '--'}</td>
            </tr>
        `).join('');
    },

    // ==================== TEAMS GRID ====================
    renderTeamsList(teams) {
        const container = document.getElementById('teams-grid-container');
        if (!teams || teams.length === 0) return;

        const rankMap = {};
        store.state.teamRankings.forEach(r => { rankMap[r.id] = r; });

        container.innerHTML = teams.map(team => {
            const rk = rankMap[team.id];
            const ovr = rk ? rk.stats.ovrRating : '--';
            const record = rk ? `${rk.stats.wins}-${rk.stats.losses}` : '';

            return `
                <div class="card team-card" onclick="ui.showTeamDetail('${team.id}')">
                    <img src="${team.logos?.[0]?.href || ''}" width="48" height="48" style="border-radius:6px;" onerror="this.style.display='none'">
                    <div style="flex:1; min-width:0;">
                        <h3 style="font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${team.displayName}</h3>
                        <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${record}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:18px; font-weight:800; color:var(--brand-accent);">${ovr}</div>
                        <div style="font-size:10px; color:var(--text-tertiary); font-weight:600; text-transform:uppercase;">OVR</div>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ==================== TEAM DETAIL ====================
    showTeamDetail(teamId) {
        const team = store.state.teams.find(t => String(t.id) === String(teamId));
        const stats = store.state.teamStats[teamId];
        if (!team) return;

        const adv = stats ? models.generateAdvancedTeamStats(stats) : null;
        const rosterObj = store.state.rosters[teamId] || { athletes: [], coach: 'N/A' };
        const coachName = rosterObj.coach;

        // Use team rankings data for OFF/DEF (which are now player-derived)
        const rankData = store.state.teamRankings.find(r => String(r.id) === String(teamId));
        const displayStats = rankData ? rankData.stats : adv;

        let roster = store.state.players.filter(p => String(p.teamId) === String(teamId));
        roster.sort((a, b) => (b.rating?.ratingNum || 0) - (a.rating?.ratingNum || 0));

        const container = document.getElementById('pane-team-detail');

        const statsHtml = displayStats ? `
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:28px;">
                <div class="card stat-card">
                    <div class="stat-label">Record</div>
                    <div class="stat-value">${displayStats.wins}-${displayStats.losses}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">PPG</div>
                    <div class="stat-value" style="color:var(--success-color);">${displayStats.ppg?.toFixed?.(1) || displayStats.ppg || '--'}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">OPP PPG</div>
                    <div class="stat-value" style="color:var(--live-color);">${displayStats.oppPpg?.toFixed?.(1) || displayStats.oppPpg || '--'}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">OVR</div>
                    <div class="stat-value" style="color:var(--brand-accent);">${displayStats.ovrRating}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">OFF</div>
                    <div class="stat-value">${displayStats.offRating}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">DEF</div>
                    <div class="stat-value">${displayStats.defRating}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Net RTG</div>
                    <div class="stat-value" style="color:${displayStats.netRtg >= 0 ? 'var(--success-color)' : 'var(--live-color)'};">${displayStats.netRtg >= 0 ? '+' : ''}${displayStats.netRtg?.toFixed?.(1) || displayStats.netRtg || '--'}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Streak</div>
                    <div class="stat-value">${displayStats.streak || '--'}</div>
                </div>
            </div>
        ` : '<div class="card" style="padding:20px; text-align:center; color:var(--text-secondary);">Team stats loading...</div>';

        container.innerHTML = `
            <div class="pane-header" style="justify-content:flex-start; gap:20px;">
                <button class="back-btn" onclick="document.querySelector('.nav-btn[data-tab=\\'teams\\']').click()">← Back</button>
                <div style="display:flex; align-items:center; gap:14px;">
                    <img src="${team.logos?.[0]?.href || ''}" width="48" height="48" style="border-radius:8px;">
                    <div>
                        <h2 style="font-size:20px;">${team.displayName}</h2>
                        <div style="font-size:12px; color:var(--text-secondary);">Coach: ${coachName}</div>
                    </div>
                </div>
            </div>

            ${statsHtml}

            <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:14px;">
                <h3 style="font-size:16px; font-weight:700;">Roster <span style="color:var(--text-tertiary); font-weight:500; font-size:13px;">(${roster.length} players)</span></h3>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Player</th>
                            <th>Pos</th>
                            <th>OVR</th>
                            <th>OFF</th>
                            <th>DEF</th>
                            <th>PTS</th>
                            <th>REB</th>
                            <th>AST</th>
                            <th>GP</th>
                            <th>Tier</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${roster.map(p => `
                            <tr>
                                <td>
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <img src="${p.headshot?.href || ''}" width="30" height="30" style="border-radius:50%; background:var(--bg-elevated); object-fit:cover; flex-shrink:0;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 30 30%22><rect fill=%22%23232836%22 width=%2230%22 height=%2230%22 rx=%2215%22/></svg>'">
                                        <span style="font-weight:600; font-size:13px;">${p.fullName || p.displayName || 'Unknown'}</span>
                                    </div>
                                </td>
                                <td style="font-size:12px; color:var(--text-secondary);">${p.rating?.posAbbrev || p.position?.abbreviation || '--'}</td>
                                <td style="font-weight:700; color:var(--brand-accent);">${p.rating?.rating || '--'}</td>
                                <td style="font-size:12px; color:var(--success-color);">${p.rating?.offRating || '--'}</td>
                                <td style="font-size:12px; color:var(--info-color, #5bc0de);">${p.rating?.defRating || '--'}</td>
                                <td style="font-variant-numeric:tabular-nums;">${p.rating?.pts || '--'}</td>
                                <td style="font-variant-numeric:tabular-nums;">${p.rating?.reb || '--'}</td>
                                <td style="font-variant-numeric:tabular-nums;">${p.rating?.ast || '--'}</td>
                                <td style="font-variant-numeric:tabular-nums;">${p.rating?.gp || '--'}</td>
                                <td><span class="badge ${this.getBadgeClass(p.rating?.rating)}">${this.getBadgeLabel(p.rating?.rating)}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div style="margin-top:16px; font-size:11px; color:var(--text-tertiary); text-align:center;">
                Player stats sync via ESPN APIs. ${roster.filter(p => p.rating?.hasRealStats).length}/${roster.length} players with real-time stats.
            </div>
        `;

        // Switch panes
        document.querySelectorAll('.pane').forEach(p => {
            p.classList.remove('active');
            p.classList.add('hidden');
        });
        container.classList.remove('hidden');
        container.classList.add('active');
    },

    // ==================== PLAYERS LIST (ALL) ====================
    renderPlayersList(players) {
        const tbody = document.getElementById('players-table-body');
        const countEl = document.getElementById('player-count');
        const tsEl = document.getElementById('player-timestamp');

        if (!players || players.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-secondary);">Loading players from all 30 rosters...</td></tr>';
            return;
        }

        // Apply filters
        const posFilter = document.getElementById('player-position-filter')?.value || 'all';
        const teamFilter = document.getElementById('player-team-filter')?.value || 'all';

        let filtered = players;
        if (posFilter !== 'all') {
            filtered = filtered.filter(p => {
                const pos = (p.position?.abbreviation || p.rating?.posAbbrev || '').toUpperCase();
                if (posFilter === 'G') return /^(G|PG|SG)$/i.test(pos);
                if (posFilter === 'F') return /^(F|SF|PF)$/i.test(pos);
                if (posFilter === 'C') return /^C$/i.test(pos);
                return true;
            });
        }
        if (teamFilter !== 'all') {
            filtered = filtered.filter(p => String(p.teamId) === teamFilter);
        }

        // TOP 25 LIMIT — only show the best 25 players
        const TOP_N = 25;
        const display = filtered.slice(0, TOP_N);

        if (countEl) countEl.textContent = `Top ${display.length} of ${players.length} players`;
        if (tsEl) tsEl.textContent = `Updated: ${this.formatTimestamp(store.state.lastUpdated.players)}`;

        // Populate team filter dropdown if empty
        this.populateTeamFilter();

        tbody.innerHTML = display.map((p, i) => `
            <tr>
                <td style="font-weight:800; color:var(--text-tertiary); width:36px; font-variant-numeric:tabular-nums;">${i + 1}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <img src="${p.headshot?.href || ''}" width="32" height="32" style="border-radius:50%; background:var(--bg-elevated); object-fit:cover; flex-shrink:0;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect fill=%22%23232836%22 width=%2232%22 height=%2232%22 rx=%2216%22/></svg>'">
                        <div style="min-width:0;">
                            <div style="font-weight:600; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.fullName || p.displayName || 'Unknown'}</div>
                            <div style="font-size:11px; color:var(--text-tertiary);">${p.rating?.posAbbrev || '--'} · ${p.teamAbbr || ''}</div>
                        </div>
                    </div>
                </td>
                <td style="font-weight:700; color:var(--brand-accent); font-size:15px; font-variant-numeric:tabular-nums;">${p.rating?.rating || '--'}</td>
                <td style="color:var(--text-secondary); font-size:12px;">
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <span>${p.rating?.pts || '--'} pts</span>
                        <span>${p.rating?.reb || '--'} reb</span>
                        <span>${p.rating?.ast || '--'} ast</span>
                    </div>
                </td>
                <td style="font-variant-numeric:tabular-nums; font-size:12px;">${p.rating?.gp || '--'}</td>
                <td><span class="badge ${this.getBadgeClass(p.rating?.rating)}">${this.getBadgeLabel(p.rating?.rating)}</span></td>
            </tr>
        `).join('');
    },

    populateTeamFilter() {
        const teamFilter = document.getElementById('player-team-filter');
        if (!teamFilter || teamFilter.options.length > 1) return;

        const teams = store.state.teams.slice().sort((a, b) => a.displayName.localeCompare(b.displayName));
        teams.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.displayName;
            teamFilter.appendChild(opt);
        });
    },

    // ==================== LOADING PROGRESS ====================
    renderLoadingProgress() {
        const bar = document.getElementById('loading-bar-inner');
        const label = document.getElementById('loading-label');
        if (!bar || !label) return;

        const rp = store.state.loadingProgress.rosters;
        const sp = store.state.loadingProgress.playerStats;

        if (rp.phase === 'loading') {
            const pct = Math.round((rp.loaded / rp.total) * 100);
            bar.style.width = pct + '%';
            label.textContent = `Loading rosters: ${rp.loaded}/${rp.total} teams`;
        } else if (sp.phase === 'loading') {
            const pct = Math.round((sp.loaded / sp.total) * 100);
            bar.style.width = pct + '%';
            label.textContent = `Syncing player stats: ${sp.loaded}/${sp.total}`;
        } else {
            bar.style.width = '100%';
            label.textContent = store.state.players.length > 0
                ? `${store.state.players.length} players loaded`
                : 'Ready';
        }
    },

    // ==================== FAVORITES ====================
    renderFavorites() {
        const container = document.getElementById('favorites-container');
        if (!container) return;

        const favTeams = store.state.favorites.teams;
        const favPlayers = store.state.favorites.players;

        if (favTeams.length === 0 && favPlayers.length === 0) {
            container.innerHTML = '<div class="card" style="padding:40px; text-align:center; color:var(--text-secondary);"><div style="font-size:40px; margin-bottom:12px;">⭐</div>No favorites yet. Star teams and players to see them here.</div>';
            return;
        }

        let html = '';
        if (favTeams.length > 0) {
            html += '<h3 style="margin-bottom:12px; font-weight:700;">Favorite Teams</h3><div class="teams-grid" style="margin-bottom:24px;">';
            favTeams.forEach(tid => {
                const team = store.state.teams.find(t => String(t.id) === String(tid));
                if (team) {
                    html += `<div class="card team-card" onclick="ui.showTeamDetail('${team.id}')">
                        <img src="${team.logos?.[0]?.href || ''}" width="40" height="40">
                        <span style="font-weight:600;">${team.displayName}</span>
                    </div>`;
                }
            });
            html += '</div>';
        }
        container.innerHTML = html;
    },

    // ==================== PREDICTOR ====================
    renderPredictorSetup() {
        const container = document.querySelector('.predictor-container');
        if (!container) return;
        const rankings = store.state.teamRankings;

        if (!rankings.length) {
            container.innerHTML = '<div class="card" style="padding:32px; text-align:center; color:var(--text-secondary);">Loading team data...</div>';
            return;
        }

        const sorted = [...rankings].sort((a, b) => a.team.displayName.localeCompare(b.team.displayName));
        const options = sorted.map(r => `<option value="${r.id}">${r.team.displayName}</option>`).join('');

        const defaultB = sorted.length > 1 ? sorted[1].id : sorted[0].id;

        container.innerHTML = `
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
                <div class="card pred-team-box">
                    <h3 style="margin-bottom:10px; font-size:13px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Away Team</h3>
                    <select id="pred-team-a" style="width:100%;">${options}</select>
                </div>
                <div class="card pred-team-box">
                    <h3 style="margin-bottom:10px; font-size:13px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Home Team</h3>
                    <select id="pred-team-b" style="width:100%;">
                        ${options.replace(`value="${defaultB}"`, `value="${defaultB}" selected`)}
                    </select>
                </div>
            </div>
            <div style="text-align:center; margin-bottom:20px;">
                <button id="run-predictor-btn" class="run-btn">Run Prediction</button>
            </div>
            <div id="predictor-results"></div>
        `;

        document.getElementById('run-predictor-btn').addEventListener('click', () => {
            const teamAId = document.getElementById('pred-team-a').value;
            const teamBId = document.getElementById('pred-team-b').value;
            this.renderPredictorResults(teamAId, teamBId);
        });
    },

    renderPredictorResults(teamAId, teamBId) {
        if (teamAId === teamBId) {
            alert('Please select different teams.');
            return;
        }

        const res = predictor.predict(teamAId, teamBId, true);
        if (!res) return;

        const resultsNode = document.getElementById('predictor-results');
        const confColor = res.confidence === 'High' ? 'var(--success-color)' : res.confidence === 'Low' ? 'var(--live-color)' : 'var(--warning-color)';

        resultsNode.innerHTML = `
            <div class="card" style="padding:24px; animation:fadeSlideIn var(--transition-base);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:28px;">
                    <div style="text-align:center; width:30%;">
                        <img src="${res.teamA.team.logos?.[0]?.href || ''}" width="56" height="56" style="margin-bottom:8px; border-radius:8px;">
                        <h3 style="font-size:28px; font-weight:800;">${res.teamA.score}</h3>
                        <div style="font-size:13px; color:var(--text-secondary);">${res.teamA.prob}% Win</div>
                        <div style="font-size:11px; color:var(--text-tertiary); margin-top:2px;">${res.teamA.team.abbreviation}</div>
                    </div>

                    <div style="text-align:center; width:40%;">
                        <div style="font-size:10px; font-weight:700; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Spread</div>
                        <div style="font-size:20px; font-weight:800; padding:8px 18px; background:var(--bg-elevated); border-radius:var(--radius-lg); display:inline-block; margin-bottom:10px;">
                            ${res.spread}
                        </div>
                        <div style="font-size:11px; color:${confColor}; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">
                            ${res.confidence} Confidence
                        </div>
                    </div>

                    <div style="text-align:center; width:30%;">
                        <img src="${res.teamB.team.logos?.[0]?.href || ''}" width="56" height="56" style="margin-bottom:8px; border-radius:8px;">
                        <h3 style="font-size:28px; font-weight:800;">${res.teamB.score}</h3>
                        <div style="font-size:13px; color:var(--text-secondary);">${res.teamB.prob}% Win</div>
                        <div style="font-size:11px; color:var(--text-tertiary); margin-top:2px;">${res.teamB.team.abbreviation}</div>
                    </div>
                </div>

                <div style="border-top:1px solid var(--divider); padding-top:20px;">
                    <h4 style="font-size:12px; font-weight:700; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.8px; margin-bottom:12px;">Key Matchup Drivers</h4>
                    <ul style="list-style:none; padding:0;">
                        ${res.drivers.map(d => `
                            <li style="padding:6px 0; font-size:13px; color:var(--text-secondary); display:flex; align-items:flex-start; gap:8px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-accent)" stroke-width="2" style="margin-top:2px; flex-shrink:0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                ${d}
                            </li>
                        `).join('')}
                    </ul>
                </div>

                <div style="margin-top:14px; font-size:10px; color:var(--text-tertiary); text-align:right;">
                    Computed: ${res.timestamp}
                </div>
            </div>
        `;
    }
};

window.ui = ui;
