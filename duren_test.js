const fs = require('fs');

async function test() {
    // Pistons Team ID = 8
    const rosterRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/8/roster');
    const roster = await rosterRes.json();
    const duren = roster.athletes[0].items.find(a => String(a.fullName) === 'Jalen Duren');
    if (!duren) return console.log('no duren');
    console.log('Duren ID:', duren.id);

    const statsRes = await fetch(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/types/2/athletes/${duren.id}/statistics`);
    const statsData = await statsRes.json();
    const categories = statsData.splits?.categories || [];
    let nameMap = {};
    categories.forEach(cat => {
        if (cat.stats) cat.stats.forEach(s => nameMap[s.name] = parseFloat(s.value));
    });
    console.log('Duren PPG:', nameMap['avgPoints'], 'APG:', nameMap['avgAssists'], 'RPG:', nameMap['avgRebounds'], 'TS%:', nameMap['trueShootingPct']);
}
test();
