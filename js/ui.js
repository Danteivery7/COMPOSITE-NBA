/* ============================================================
   UI — Rendering Engine
   All DOM rendering, navigation, filters, and detail views
   ============================================================ */
const ui = {
    navStack: [],

    init() {
        this.bindNav();
        this.bindTheme();
        this.bindSettings();
        this.bindPlayerFilters();
        
        // Add sync indicator to the header if not present
        this.ensureSyncIndicator();

        setTimeout(() => {
            const activeTab = document.querySelector('.nav-btn.active');
            if (activeTab) activeTab.click();
        }, 500);
    },

    ensureSyncIndicator() {
        const header = document.querySelector('.header-actions');
        if (header && !document.getElementById('sync-indicator')) {
            const span = document.createElement('span');
            span.id = 'sync-indicator';
            span.innerHTML = '<span class="dot-sync"></span> Syncing';
            span.className = 'sync-indicator hidden';
            header.prepend(span);
        }
    },

    setSyncing(isSyncing) {
        const el = document.getElementById('sync-indicator');
        if (el) {
            if (isSyncing) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    },

    // ==================== NAVIGATION ====================
    bindNav() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.currentTarget.dataset.tab;
                if (tab) this.switchTab(tab);
            });
        });
    },

    switchTab(tabId, pushToStack = true) {
        console.log('[UI] Switching to tab:', tabId);
        
        const currentPane = document.querySelector('.pane.active')?.id?.replace('pane-', '');
        
        // If switching from main nav (manually), clear the stack
        const isMainNav = document.querySelector(`.nav-btn[data-tab="${tabId}"]`) !== null;
        if (isMainNav && pushToStack && !['player-detail', 'team-detail', 'game-detail'].includes(tabId)) {
            this.navStack = [];
        } else if (pushToStack && currentPane && currentPane !== tabId) {
            this.navStack.push(currentPane);
        }

        window.scrollTo(0, 0);

        // Clear active game detail tracking if switching away from detail
        if (tabId !== 'game-detail') store.state.activeGameId = null;
        if (tabId !== 'team-detail') store.state.activeTeamId = null;
        if (tabId !== 'player-detail') store.state.activePlayerId = null;

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll(`.nav-btn[data-tab="${tabId}"]`).forEach(b => b.classList.add('active'));

        document.querySelectorAll('.pane').forEach(p => {
            p.classList.remove('active', 'hidden');
            p.classList.add('hidden');
        });

        const pane = document.getElementById(`pane-${tabId}`);
        if (pane) {
            pane.classList.remove('hidden');
            pane.classList.add('active');
        }

        // Trigger renders on tab switch
        if (tabId === 'rankings') {
            this.renderRankings(store.state.teamRankings);
            this.renderPredictorSetup();
        } else if (tabId === 'teams') {
            this.renderTeamsList(store.state.teams);
        } else if (tabId === 'players') {
            this.renderPlayersList(store.state.players);
        } else if (tabId === 'live') {
            this.renderLiveGames(store.state.games);
        } else if (tabId === 'favorites') {
            this.renderFavorites();
        }
    },

    goBack() {
        if (this.navStack.length > 0) {
            const prev = this.navStack.pop();
            this.switchTab(prev, false); // Don't push to stack when going back
        } else {
            this.switchTab('live', false);
        }
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

        container.innerHTML = activeGames.map(game => this.createGameCard(game, now)).join('');

        // Bind click handlers
        container.querySelectorAll('.game-card[data-game-id]').forEach(card => {
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                const gameId = card.dataset.gameId;
                const state = card.dataset.gameState;

                // PRE-GAME: Expansion Panel behavior
                if (state === 'pre') {
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
                        if (!detail.dataset.loaded) {
                            this.loadGameDetail(gameId, detail, state);
                        }
                    } else {
                        detail.classList.remove('open');
                        detail.style.maxHeight = '0';
                    }
                } 
                // LIVE / POST: Dedicated Page behavior
                else {
                    this.renderGameDetail(gameId);
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

        return `
            <div style="padding:12px 0;">
                <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase; font-weight:700; letter-spacing:1px; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
                    <span style="width:12px; height:12px; background:var(--success-color); border-radius:3px;"></span>
                    Final Result
                </div>
                ${statsHtml || '<div style="font-size:11px; color:var(--text-tertiary); text-align:center;">Box score unavailable</div>'}
            </div>
        `;
    },

    // ==================== NEW: DEDICATED GAME DETAIL PAGE ====================
    async renderGameDetail(gameId) {
        const pane = document.getElementById('pane-game-detail');
        if (!pane) return;

        // Save active game ID for polling updates
        store.state.activeGameId = gameId;

        this.switchTab('game-detail');

        // Initial loading state
        pane.innerHTML = `
            <div class="back-bar">
                <button class="back-btn" onclick="ui.goBack()">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Back to Scores
                </button>
            </div>
            <div style="text-align:center; padding:100px 0;">
                <div class="dot pulse" style="width:12px; height:12px; background:var(--brand-primary); border-radius:50%; margin: 0 auto 16px;"></div>
                <div style="font-weight:700; color:var(--text-secondary);">Loading full game details...</div>
            </div>
        `;

        const summary = await api.fetchGameSummary(gameId);
        if (!summary) {
            pane.innerHTML = '<div style="padding:40px; text-align:center;">Failed to load game summary.</div>';
            return;
        }

        this.updateGameDetailContent(summary);
    },

    updateGameDetailContent(summary) {
        const pane = document.getElementById('pane-game-detail');
        if (!pane || pane.classList.contains('hidden')) return;

        const header = summary.header;
        const competitions = header?.competitions?.[0];
        const away = competitions?.competitors?.find(c => c.homeAway === 'away');
        const home = competitions?.competitors?.find(c => c.homeAway === 'home');
        const status = competitions?.status || header?.status;
        const state = status?.type?.state;

        // Score animation logic
        const oldAwayScore = pane.querySelector('#detail-score-away')?.textContent;
        const oldHomeScore = pane.querySelector('#detail-score-home')?.textContent;
        const awayScoreChanged = oldAwayScore !== undefined && oldAwayScore !== away?.score;
        const homeScoreChanged = oldHomeScore !== undefined && oldHomeScore !== home?.score;

        const html = `
            <div class="back-bar">
                <button class="back-btn" onclick="ui.goBack()">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Back to Scores
                </button>
            </div>

            <div class="game-detail-hero">
                <div class="hero-matchup">
                    <div class="hero-team">
                        <img src="${away?.team?.logos?.[0]?.href || away?.team?.logo}" class="hero-logo-large" alt="${away?.team?.displayName}">
                        <div class="hero-team-name">${away?.team?.displayName}</div>
                        <div class="hero-team-record">${away?.record?.[0]?.summary || ''}</div>
                    </div>

                    <div class="hero-score-box">
                        <div style="display:flex; justify-content:center; align-items:center; gap:24px;">
                            <div id="detail-score-away" class="hero-score ${awayScoreChanged ? 'score-animate' : ''}">${away?.score || '0'}</div>
                            <div style="font-size:24px; font-weight:900; color:var(--text-tertiary); opacity:0.5;">-</div>
                            <div id="detail-score-home" class="hero-score ${homeScoreChanged ? 'score-animate' : ''}">${home?.score || '0'}</div>
                        </div>
                        <div class="hero-status-tag ${state === 'in' ? 'hero-status-live' : ''}">
                            ${state === 'in' ? '<span class="dot pulse" style="width:6px; height:6px; background:red; display:inline-block; margin-right:6px; vertical-align:middle;"></span>' : ''}
                            ${status?.type?.shortDetail || status?.type?.detail || 'Scheduled'}
                        </div>
                    </div>

                    <div class="hero-team">
                        <img src="${home?.team?.logos?.[0]?.href || home?.team?.logo}" class="hero-logo-large" alt="${home?.team?.displayName}">
                        <div class="hero-team-name">${home?.team?.displayName}</div>
                        <div class="hero-team-record">${home?.record?.[0]?.summary || ''}</div>
                    </div>
                </div>

                <div class="game-info-strip">
                    <div class="info-item">
                        <div class="info-label">Venue</div>
                        <div class="info-value">${summary?.gameInfo?.venue?.fullName || competitions?.venue?.fullName || 'N/A'}</div>
                    </div>
                    ${competitions?.attendance ? `
                    <div class="info-item">
                        <div class="info-label">Attendance</div>
                        <div class="info-value">${competitions.attendance.toLocaleString()}</div>
                    </div>
                    ` : ''}
                    ${competitions?.broadcasts?.length ? `
                    <div class="info-item">
                        <div class="info-label">Watch</div>
                        <div class="info-value">${competitions.broadcasts[0].media?.shortName || competitions.broadcasts[0].names?.join(', ') || 'N/A'}</div>
                    </div>
                    ` : ''}
                </div>
            </div>

            <div class="box-score-container">
                ${this.buildFullBoxScore(summary)}
            </div>
        `;

        pane.innerHTML = html;

        // Remove animation class after it plays
        setTimeout(() => {
            pane.querySelectorAll('.score-animate').forEach(el => el.classList.remove('score-animate'));
        }, 1000);
    },

    buildFullBoxScore(summary) {
        const teams = summary.boxscore?.players || [];
        if (!teams.length) return '<div style="text-align:center; padding:40px; color:var(--text-tertiary);">Box Score Coming Soon</div>';

        return teams.map(teamBlock => {
            const team = teamBlock.team;
            const statsGroups = teamBlock.statistics || [];
            if (statsGroups.length === 0) return '';
            
            const stats = statsGroups[0];
            const athletes = stats.athletes || [];
            const labels = stats.labels || [];

            return `
                <div style="margin-bottom:40px;">
                    <div class="box-score-section-header">
                        <img src="${team.logos?.[0]?.href || team.logo}" style="width:32px; height:32px;">
                        <h3>${team.displayName} Box Score</h3>
                    </div>
                    <div class="box-score-table-wrapper">
                        <table class="box-score-table">
                            <thead>
                                <tr>
                                    <th class="player-cell">Player</th>
                                    ${labels.map(l => `<th>${l}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${athletes.map(a => {
                                    const isStarter = a.starter;
                                    const statsArray = a.stats || [];
                                    const ptsIdx = labels.indexOf('PTS');
                                    const pts = parseFloat(statsArray[ptsIdx]) || 0;
                                    
                                    return `
                                        <tr style="cursor:pointer; ${!isStarter ? 'opacity:0.85;' : ''}" onclick="ui.showPlayerDetail('${a.athlete?.id}')">
                                            <td class="player-cell">
                                                <div style="display:flex; flex-direction:column;">
                                                    <span style="font-weight:700;">${a.athlete?.displayName}</span>
                                                    <span style="font-size:9px; color:var(--text-tertiary); font-weight:600;">${a.athlete?.position?.abbreviation || ''} ${isStarter ? '• STARTER' : ''}</span>
                                                </div>
                                            </td>
                                            ${statsArray.map((s, idx) => {
                                                const isPts = idx === ptsIdx;
                                                const isHigh = isPts && pts >= 25;
                                                return `<td class="${isPts ? 'stat-primary' : ''} ${isHigh ? 'high-stat' : ''}">${s}</td>`;
                                            }).join('')}
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }).join('');
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
    async showTeamDetail(teamId) {
        console.log('[UI] Showing team detail:', teamId);
        const team = store.state.teams.find(t => String(t.id) === String(teamId));
        const stats = store.state.teamStats[teamId];
        if (!team) return;

        const adv = stats ? models.generateAdvancedTeamStats(stats) : null;

        const rosterObj = store.state.rosters[teamId] || { athletes: [], coach: 'N/A' };
        const coachName = rosterObj.coach;

        const rankData = store.state.teamRankings.find(r => String(r.id) === String(teamId));
        const displayStats = rankData ? rankData.stats : adv;

        let roster = store.state.players.filter(p => String(p.teamId) === String(teamId));
        roster.sort((a, b) => (b.rating?.ratingNum || 0) - (a.rating?.ratingNum || 0));

        const container = document.getElementById('pane-team-detail');

        const statsHtml = displayStats ? `
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:28px;">
                <div class="card stat-card"><div class="stat-label">Record</div><div class="stat-value">${displayStats.wins}-${displayStats.losses}</div></div>
                <div class="card stat-card"><div class="stat-label">PPG</div><div class="stat-value" style="color:var(--success-color);">${displayStats.ppg?.toFixed?.(1) || displayStats.ppg || '--'}</div></div>
                <div class="card stat-card"><div class="stat-label">OPP PPG</div><div class="stat-value" style="color:var(--live-color);">${displayStats.oppPpg?.toFixed?.(1) || displayStats.oppPpg || '--'}</div></div>
                <div class="card stat-card"><div class="stat-label">OVR</div><div class="stat-value" style="color:var(--brand-accent);">${displayStats.ovrRating}</div></div>
                <div class="card stat-card"><div class="stat-label">OFF</div><div class="stat-value">${displayStats.offRating}</div></div>
                <div class="card stat-card"><div class="stat-label">DEF</div><div class="stat-value">${displayStats.defRating}</div></div>
                <div class="card stat-card"><div class="stat-label">Net RTG</div><div class="stat-value" style="color:${displayStats.netRtg >= 0 ? 'var(--success-color)' : 'var(--live-color)'};">${displayStats.netRtg >= 0 ? '+' : ''}${displayStats.netRtg?.toFixed?.(1) || displayStats.netRtg || '--'}</div></div>
                <div class="card stat-card"><div class="stat-label">Streak</div><div class="stat-value">${displayStats.streak || '--'}</div></div>
            </div>
        ` : '<div class="card" style="padding:20px; text-align:center; color:var(--text-secondary);">Team stats loading...</div>';

        container.innerHTML = `
            <div class="pane-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px;">
                <div style="display:flex; align-items:center; gap:20px;">
                    <button class="back-btn" onclick="ui.goBack()">← Back</button>
                    <div style="display:flex; align-items:center; gap:14px;">
                        <img src="${team.logos?.[0]?.href || ''}" width="48" height="48" style="border-radius:8px;">
                        <div>
                            <h2 style="font-size:20px;">${team.displayName}</h2>
                            <div style="font-size:12px; color:var(--text-secondary);">Coach: ${coachName}</div>
                        </div>
                    </div>
                </div>
                <button class="action-btn" onclick="store.toggleFavorite('team', '${team.id}'); ui.showTeamDetail('${team.id}');" style="background:var(--bg-elevated); border:1px solid var(--border); padding:8px 16px; border-radius:var(--radius-md); color:var(--text-primary); cursor:pointer;">
                    ${store.state.favorites.teams.includes(String(team.id)) ? '⭐ Favorited' : '☆ Favorite'}
                </button>
            </div>
            ${statsHtml}
            <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:14px;">
                <h3 style="font-size:16px; font-weight:700;">Roster <span style="color:var(--text-tertiary); font-weight:500; font-size:13px;">(${roster.length} players)</span></h3>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Player</th><th>Pos</th><th>OVR</th><th>OFF</th><th>DEF</th><th>PTS</th><th>REB</th><th>AST</th><th>GP</th><th>Tier</th></tr></thead>
                    <tbody>
                        ${roster.map(p => `
                            <tr style="cursor:pointer;" onclick="ui.showPlayerDetail('${p.id}')">
                                <td>
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <img src="${p.headshot?.href || ''}" width="30" height="30" style="border-radius:50%; background:var(--bg-elevated); object-fit:cover; flex-shrink:0;">
                                        <span style="font-weight:600; font-size:13px;">${p.fullName || p.displayName || 'Unknown'}</span>
                                    </div>
                                </td>
                                <td style="font-size:12px; color:var(--text-secondary);">${p.rating?.posAbbrev || p.position?.abbreviation || '--'}</td>
                                <td style="font-weight:700; color:var(--brand-accent);">${p.rating?.rating || '--'}</td>
                                <td style="font-size:12px; color:var(--success-color);">${p.rating?.offRating || '--'}</td>
                                <td style="font-size:12px; color:var(--info-color, #5bc0de);">${p.rating?.defRating || '--'}</td>
                                <td>${p.rating?.pts || '--'}</td><td>${p.rating?.reb || '--'}</td><td>${p.rating?.ast || '--'}</td><td>${p.rating?.gp || '--'}</td>
                                <td><span class="badge ${this.getBadgeClass(p.rating?.rating)}">${this.getBadgeLabel(p.rating?.rating)}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div style="margin-top:16px; font-size:11px; color:var(--text-tertiary); text-align:center;">
                Player stats sync via ESPN APIs. ${roster.filter(p => p.rating?.hasRealStats).length}/${roster.length} players with real-time stats.
            </div>
            <div id="team-schedule-container" style="margin-top:28px;"></div>
        `;

        this.switchTab('team-detail');
        const scheduleContainer = document.getElementById('team-schedule-container');
        try {
            const schedule = await api.fetchTeamSchedule(teamId);
            if (schedule && schedule.length > 0 && scheduleContainer) {
                scheduleContainer.innerHTML = `
                    <h3 style="font-size:16px; font-weight:700; margin-bottom:12px;">Last 5 Games</h3>
                    <div style="display:flex; gap:12px; overflow-x:auto; padding-bottom:8px;">
                        ${schedule.map(game => {
                            const comp = game.competitions[0];
                            const us = comp.competitors.find(c => c.team.id === String(teamId));
                            const opp = comp.competitors.find(c => c.team.id !== String(teamId));
                            if (!us || !opp) return '';
                            const isWin = us.winner;
                            const isHome = us.homeAway === 'home';
                            return `
                                <div class="card" style="min-width:140px; padding:12px; flex-shrink:0;">
                                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:8px;">${new Date(game.date).toLocaleDateString(undefined, {month:'short', day:'numeric'})} • ${isHome ? 'vs' : '@'} ${opp.team.abbreviation}</div>
                                    <div style="display:flex; align-items:center; justify-content:space-between;">
                                        <img src="${opp.team?.logos?.[0]?.href || opp.team?.logo}" width="24" height="24">
                                        <div style="font-weight:700; font-size:14px;">${us.score?.displayValue || us.score?.value} - ${opp.score?.displayValue || opp.score?.value}</div>
                                    </div>
                                    <div style="margin-top:8px; font-size:11px; font-weight:700; color:${isWin ? 'var(--success-color)' : 'var(--live-color)'}; text-transform:uppercase;">${isWin ? 'W' : 'L'}</div>
                                </div>`;
                        }).join('')}
                    </div>`;
            }
        } catch (e) { console.error('Failed to load schedule', e); }
    },

    // ==================== PLAYER DETAIL ====================
    async showPlayerDetail(playerId) {
        try {
            console.log('showPlayerDetail called for:', playerId);
            const p = store.state.players.find(x => String(x.id) === String(playerId));
            if (!p) {
                console.error('Player not found in store.state.players!', playerId);
                return;
            }
            if (!p.rating) {
            console.warn('Player rating is missing! Attempting to generate on the fly...');
            const rosterAthlete = store.state.rosters[p.teamId]?.athletes?.find(a => String(a.id) === String(playerId));
            if (rosterAthlete) {
                p.rating = models.generatePlayerRating(rosterAthlete, store.state.teamStats[p.teamId]);
            }
        }
        
        const team = store.state.teams.find(t => String(t.id) === String(p.teamId));
        const s = p.rating || { ratingNum: 0, offRating: "0", defRating: "0", pts: "0", reb: "0", ast: "0", stl: "0", blk: "0", gp: 0, mpg: "0" };
        const container = document.getElementById('pane-player-detail');

        // AI specific analysis generation based on live stats
        let aiAnalysis = '';
        if (s.gp === 0) {
            aiAnalysis = `${p.fullName || p.displayName} has not played any games this season. His current rating is a conservative baseline proxy until he logs minimum minutes.`;
        } else {
            const strengths = [];
            const weaknesses = [];

            if (s.ratingNum >= 90) strengths.push('is performing at an MVP-caliber level');
            else if (s.ratingNum >= 86) strengths.push('is an elite All-Star talent');
            else if (s.ratingNum >= 80) strengths.push('is a highly impactful core rotation player');

            if (parseFloat(s.offRating) >= 85) strengths.push('an offensive engine');
            if (parseFloat(s.defRating) >= 85) strengths.push('a lockdown defensive anchor');

            if (parseFloat(s.pts) >= 24) strengths.push(`an elite scorer (${s.pts} PPG)`);
            if (parseFloat(s.ast) >= 7) strengths.push(`a premier playmaker (${s.ast} APG)`);
            if (parseFloat(s.reb) >= 10) strengths.push(`dominant on the glass (${s.reb} RPG)`);

            if (s.offRating < 70) weaknesses.push('offensive consistency');
            if (s.defRating < 72) weaknesses.push('defensive impact');
            if (s.tsPct < 52 && s.pts > 10) weaknesses.push('scoring efficiency');

            let strText = strengths.length > 0 ? strengths.join(', ') : 'a solid contributor';
            let wkText = weaknesses.length > 0 ? ` However, advanced metrics suggest room for improvement regarding ${weaknesses.join(' and ')}.` : '';

            aiAnalysis = `Composite AI Analysis: Based on real-time data from the current season (${s.gp} games played), ${p.fullName || p.displayName} ${strText}.${wkText} His overall impact score reflects a dynamic ${s.posAbbrev} for the ${team ? team.displayName : 'team'}.`;
        }

        const isFav = (store.state.favorites.players || []).includes(String(p.id));

        container.innerHTML = `
            <div class="pane-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px;">
                <button class="back-btn" onclick="ui.goBack()">← Back</button>
                <button class="action-btn" onclick="store.toggleFavorite('player', '${p.id}'); ui.showPlayerDetail('${p.id}');" style="background:var(--bg-elevated); border:1px solid var(--border); padding:8px 16px; border-radius:var(--radius-md); color:var(--text-primary); cursor:pointer;">
                    ${isFav ? '⭐ Favorited' : '☆ Favorite'}
                </button>
            </div>

            <div style="display:grid; grid-template-columns:300px 1fr; gap:32px; align-items:start;">
                <!-- 2K Style Card -->
                <div style="background: linear-gradient(135deg, rgba(20,24,36,1) 0%, rgba(30,35,50,1) 100%); border:1px solid rgba(255,255,255,0.1); border-radius:16px; padding:24px; position:relative; box-shadow:0 20px 40px rgba(0,0,0,0.5); overflow:hidden;">
                    <div style="position:absolute; top:-20px; right:-20px; opacity:0.05; filter:grayscale(100%);">
                        <img src="${team?.logos?.[0]?.href || ''}" width="200" height="200">
                    </div>
                    
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; position:relative; z-index:2;">
                        <div>
                            <div style="font-size:48px; font-weight:900; line-height:1; color:${(s.ratingNum || 0) >= 90 ? '#f1c40f' : (s.ratingNum || 0) >= 80 ? '#3498db' : '#95a5a6'}; text-shadow: 0 4px 12px rgba(0,0,0,0.5);">${(s.ratingNum || 0).toFixed(1)}</div>
                            <div style="font-size:12px; font-weight:800; color:var(--text-secondary); letter-spacing:1px; text-transform:uppercase; margin-top:4px;">OVERALL</div>
                            <div style="display:inline-block; margin-top:12px; padding:4px 10px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:4px; font-size:10px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:1px;">${s.archetype || 'Role Player'}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:24px; font-weight:800; color:var(--text-secondary);">${s.posAbbrev || p.position?.abbreviation || '--'}</div>
                            <img src="${team?.logos?.[0]?.href || ''}" width="36" height="36" style="margin-top:8px;">
                        </div>
                    </div>

                    <div style="text-align:center; position:relative; z-index:2; margin:20px 0;">
                        <img src="${p.headshot?.href || ''}" width="180" height="130" style="object-fit:contain; filter:drop-shadow(0 10px 15px rgba(0,0,0,0.5));" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 30 30%22><rect fill=%22transparent%22 width=%2230%22 height=%2230%22/></svg>'">
                    </div>

                    <div style="text-align:center; position:relative; z-index:2; border-top:1px solid rgba(255,255,255,0.1); padding-top:16px;">
                        <h2 style="font-size:22px; font-weight:800; text-transform:uppercase; letter-spacing:1px; margin-bottom:16px;">${p.fullName || p.displayName}</h2>
                        <div style="display:flex; justify-content:space-around; background:rgba(0,0,0,0.3); border-radius:8px; padding:12px;">
                            <div>
                                <div style="font-size:18px; font-weight:800; color:var(--success-color);">${s.offRating}</div>
                                <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase;">OFF</div>
                            </div>
                            <div style="width:1px; background:rgba(255,255,255,0.1);"></div>
                            <div>
                                <div style="font-size:18px; font-weight:800; color:var(--info-color, #5bc0de);">${s.defRating}</div>
                                <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase;">DEF</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Stats & Analysis -->
                <div>
                    <!-- AI Analysis Box -->
                    <div style="background:var(--bg-elevated); border-left:4px solid var(--brand-accent); padding:20px; border-radius:0 8px 8px 0; margin-bottom:32px;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-accent)" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                            <span style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:var(--brand-accent);">Composite AI Report</span>
                        </div>
                        <p style="font-size:15px; line-height:1.6; color:var(--text-secondary); margin:0;">${aiAnalysis}</p>
                    </div>

                    <h3 style="font-size:16px; font-weight:700; margin-bottom:16px;">Current Season Stats</h3>
                    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:12px;">
                        <div class="card stat-card"><div class="stat-label">PPG</div><div class="stat-value">${s.pts || '--'}</div></div>
                        <div class="card stat-card"><div class="stat-label">RPG</div><div class="stat-value">${s.reb || '--'}</div></div>
                        <div class="card stat-card"><div class="stat-label">APG</div><div class="stat-value">${s.ast || '--'}</div></div>
                        <div class="card stat-card"><div class="stat-label">SPG</div><div class="stat-value">${s.stl || '--'}</div></div>
                        <div class="card stat-card"><div class="stat-label">BPG</div><div class="stat-value">${s.blk || '--'}</div></div>
                        <div class="card stat-card"><div class="stat-label">FG%</div><div class="stat-value">${s.fgPct || '--'}${s.fgPct ? '%' : ''}</div></div>
                        <div class="card stat-card"><div class="stat-label">3P%</div><div class="stat-value">${s.threePct || '--'}${s.threePct ? '%' : ''}</div></div>
                        <div class="card stat-card"><div class="stat-label">eFG%</div><div class="stat-value">${s.efgPct || '--'}${s.efgPct ? '%' : ''}</div></div>
                        <div class="card stat-card"><div class="stat-label">TS%</div><div class="stat-value">${s.tsPct || '--'}${s.tsPct ? '%' : ''}</div></div>
                        <div class="card stat-card"><div class="stat-label">PER</div><div class="stat-value">${s.per || '--'}</div></div>
                        <div class="card stat-card"><div class="stat-label">MPG</div><div class="stat-value">${s.mpg || '--'}</div></div>
                        <div class="card stat-card"><div class="stat-label">GP</div><div class="stat-value">${s.gp !== undefined ? s.gp : '--'}</div></div>
                    </div>
                </div>
            </div>
        `;

        this.switchTab('player-detail');
        } catch (e) {
            console.error('[UI] Error in showPlayerDetail:', e);
            toast.show('Error loading player details', 'error');
        }
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
            <tr style="cursor:pointer;" onclick="ui.showPlayerDetail('${p.id}')">
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

        const favTeams = store.state.favorites.teams || [];
        const favPlayers = store.state.favorites.players || [];

        if (favTeams.length === 0 && favPlayers.length === 0) {
            container.innerHTML = '<div class="card" style="padding:40px; text-align:center; color:var(--text-secondary);"><div style="font-size:40px; margin-bottom:12px;">⭐</div>No favorites yet. Star teams and players to see them here.</div>';
            return;
        }

        let html = '';
        if (favTeams.length > 0) {
            html += '<h3 style="margin-bottom:16px; font-weight:700;">Favorite Teams</h3><div class="teams-grid" style="margin-bottom:32px;">';
            favTeams.forEach(tid => {
                const team = store.state.teams.find(t => String(t.id) === String(tid));
                const rankData = store.state.teamRankings.find(r => String(r.id) === String(tid));
                if (team) {
                    const stats = rankData ? rankData.stats : null;
                    html += `
                    <div class="card team-card" onclick="ui.showTeamDetail('${team.id}')" style="display:flex; flex-direction:column; align-items:center;">
                        <img src="${team.logos?.[0]?.href || ''}" width="56" height="56" style="margin-bottom:12px;">
                        <span style="font-weight:700; font-size:16px; margin-bottom:4px;">${team.displayName}</span>
                        ${stats ? `<div style="font-size:12px; color:var(--text-secondary);">${stats.wins}-${stats.losses} • <span style="color:var(--brand-accent); font-weight:700;">${stats.ovrRating} OVR</span></div>` : ''}
                    </div>`;
                }
            });
            html += '</div>';
        }

        if (favPlayers.length > 0) {
            html += '<h3 style="margin-bottom:16px; font-weight:700;">Favorite Players</h3><div class="teams-grid" style="margin-bottom:32px; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));">';
            favPlayers.forEach(pid => {
                const p = store.state.players.find(x => String(x.id) === String(pid));
                if (p && p.rating) {
                    const s = p.rating;
                    html += `
                    <div class="card team-card" onclick="ui.showPlayerDetail('${p.id}')" style="display:flex; flex-direction:column; align-items:center; position:relative;">
                        <div style="position:absolute; top:12px; right:12px; font-size:18px; font-weight:900; color:${s.rating >= 90 ? '#f1c40f' : s.rating >= 80 ? '#3498db' : 'var(--text-secondary)'};">${s.rating}</div>
                        <img src="${p.headshot?.href || ''}" width="80" height="60" style="object-fit:contain; margin-bottom:12px;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 30 30%22><rect fill=%22transparent%22 width=%2230%22 height=%2230%22/></svg>'">
                        <span style="font-weight:700; font-size:14px; text-align:center;">${p.fullName || p.displayName}</span>
                        <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${s.posAbbrev || '--'}</div>
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
