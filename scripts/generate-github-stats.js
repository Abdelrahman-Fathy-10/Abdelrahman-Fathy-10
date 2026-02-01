/**
 * generate-github-stats.js
 *
 * - Fetches contribution calendar via GraphQL
 * - Fetches public repo languages via REST
 * - Computes total contributions, current streak, longest streak, top languages
 * - Writes stats/github-stats.svg
 *
 * Usage:
 *  - In GitHub Actions the GITHUB_TOKEN env is provided automatically.
 *  - Locally you can run with PERSONAL_TOKEN=ghp_xxx node generate-github-stats.js
 */

const fs = require('fs');
const path = require('path');
const { graphql } = require('@octokit/graphql');
const { Octokit } = require('@octokit/rest');

const username = process.env.GH_STATS_USERNAME || 'Abdelrahman-Fathy-10';
const outDir = path.join(__dirname, '..', 'stats');
const outFile = path.join(outDir, 'github-stats.svg');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const token = process.env.GITHUB_TOKEN || process.env.PERSONAL_TOKEN || '';
if (!token) {
  console.error('No token found in GITHUB_TOKEN or PERSONAL_TOKEN. Exiting.');
  process.exit(1);
}

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${token}`,
  },
});

const octokit = new Octokit({ auth: token });

/* Compute streaks */
function computeStreaks(days) {
  days.sort((a, b) => new Date(a.date) - new Date(b.date));
  let longest = 0;
  let current = 0;
  let maxStart = null;
  let maxEnd = null;
  let tempStart = null;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (d.contributionCount > 0) {
      if (tempStart === null) tempStart = d.date;
      current += 1;
    } else {
      if (current > longest) {
        longest = current;
        maxStart = tempStart;
        maxEnd = days[i - 1].date;
      }
      current = 0;
      tempStart = null;
    }
  }
  if (current > longest) {
    longest = current;
    maxStart = tempStart;
    maxEnd = days[days.length - 1].date;
  }

  let currentStreak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) currentStreak++;
    else break;
  }

  return {
    longest,
    longestStart: maxStart,
    longestEnd: maxEnd,
    currentStreak,
  };
}

async function getContributionCalendar() {
  const query = `
    query ($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;
  const res = await graphqlWithAuth(query, { login: username });
  const weeks = res.user.contributionsCollection.contributionCalendar.weeks;
  const days = [];
  for (const w of weeks) {
    for (const d of w.contributionDays) {
      days.push({ date: d.date, contributionCount: d.contributionCount });
    }
  }
  const totalContributions = res.user.contributionsCollection.contributionCalendar.totalContributions;
  return { days, totalContributions };
}

async function getTopLanguages() {
  // List first 100 public repos. If you have more repos, consider adding pagination.
  const repos = await octokit.repos.listForUser({ username, per_page: 100 });
  const languageTotals = {};
  for (const r of repos.data) {
    try {
      const langs = await octokit.repos.listLanguages({ owner: username, repo: r.name });
      for (const [lang, bytes] of Object.entries(langs.data)) {
        languageTotals[lang] = (languageTotals[lang] || 0) + bytes;
      }
    } catch (err) {
      // continue on error for individual repo
      console.warn(`Failed to fetch languages for ${r.name}:`, err.message);
    }
  }
  const totalBytes = Object.values(languageTotals).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(languageTotals).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 6).map(([lang, bytes]) => ({
    lang,
    bytes,
    pct: Math.round((bytes / totalBytes) * 10000) / 100,
  }));
  return top;
}

function renderSVG({ totalContributions, currentStreak, longestStreak, longestStart, longestEnd, topLangs }) {
  const colors = ['#ef476f','#ff7b25','#5aa3ff','#ff6b6b','#ffd166','#7fdbb7'];
  const width = 900;
  const height = 320;
  const barWidth = 600;

  let x = 0;
  const segments = topLangs.map((l, i) => {
    const w = Math.max(2, Math.round((l.pct / 100) * barWidth));
    const seg = { x, w, color: colors[i % colors.length], lang: l.lang, pct: l.pct };
    x += w;
    return seg;
  });

  const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="background:#0b1117">
  <style>
    .title { fill:#ffffff; font-family: Inter, Arial, sans-serif; font-size:20px; font-weight:700; }
    .label { fill:#9aa9b2; font-family: Inter, Arial, sans-serif; font-size:13px; }
    .value { fill:#e7c36e; font-family: Inter, Arial, sans-serif; font-size:36px; font-weight:700; }
    .small { fill:#d6b3a5; font-family: Inter, Arial, sans-serif; font-size:12px; }
    .card { fill: none; stroke: rgba(255,255,255,0.08); stroke-width:1.2; rx:8; }
    .divider { stroke: rgba(255,255,255,0.06); stroke-width:1; }
  </style>

  <text x="18" y="28" class="title">GitHub Stats:</text>

  <g transform="translate(18,40)">
    <rect x="0" y="0" width="860" height="120" rx="6" class="card" />

    <g transform="translate(30,18)">
      <text x="0" y="36" class="value">${totalContributions}</text>
      <text x="0" y="60" class="label">Total Contributions</text>
      <text x="0" y="82" class="small">All-time (contributions calendar)</text>
    </g>

    <g transform="translate(320,12)">
      <line x1="-30" y1="6" x2="-30" y2="100" class="divider"/>
      <g transform="translate(50,10)">
        <circle cx="50" cy="44" r="44" fill="none" stroke="#E7C36E" stroke-width="6" opacity="0.12"/>
        <circle cx="50" cy="44" r="44" fill="none" stroke="#E7C36E" stroke-width="6"
          stroke-dasharray="${Math.round(Math.min(214, (currentStreak / Math.max(1, Math.max(currentStreak, longestStreak))) * 214))} 214" stroke-linecap="round"/>
        <text x="50" y="52" text-anchor="middle" class="value" style="font-size:30px">${currentStreak}</text>
        <text x="50" y="74" text-anchor="middle" class="label">Current Streak</text>
        <text x="50" y="92" text-anchor="middle" class="small">${currentStreak > 0 ? 'Active' : ''}</text>
      </g>
    </g>

    <g transform="translate(600,14)">
      <line x1="-30" y1="6" x2="-30" y2="100" class="divider"/>
      <text x="40" y="36" class="value">${longestStreak}</text>
      <text x="40" y="60" class="label">Longest Streak</text>
      <text x="40" y="82" class="small">${longestStart ? longestStart + ' - ' + longestEnd : ''}</text>
    </g>
  </g>

  <g transform="translate(18,180)">
    <rect x="0" y="0" width="420" height="110" rx="6" class="card" />
    <text x="16" y="28" class="label" style="fill:#e6c07b; font-weight:700">Most Used Languages</text>

    <g transform="translate(16,44)">
      <rect x="0" y="0" width="${barWidth}" height="12" rx="6" fill="#0f1720" />
      ${segments.map(s => `<rect x="${s.x}" y="0" width="${s.w}" height="12" rx="6" fill="${s.color}" />`).join('\n      ')}
    </g>

    <g transform="translate(16,64)">
      ${topLangs.map((l, i) => {
        const xLegend = i < 3 ? 0 : 220;
        const yLegend = (i % 3) * 20;
        const color = colors[i % colors.length];
        return `<g transform="translate(${xLegend},${yLegend})">
          <rect x="0" y="0" width="10" height="10" rx="2" fill="${color}"></rect>
          <text x="16" y="10" class="small">${l.lang} ${l.pct}%</text>
        </g>`;
      }).join('\n      ')}
    </g>
  </g>
</svg>`;

  return svg;
}

(async () => {
  try {
    console.log('Fetching contribution calendar...');
    const { days, totalContributions } = await getContributionCalendar();

    const streaks = computeStreaks(days);
    console.log('Contributions total:', totalContributions, 'current streak:', streaks.currentStreak, 'longest:', streaks.longest);

    console.log('Aggregating languages...');
    const topLangs = await getTopLanguages();

    const svg = renderSVG({
      totalContributions,
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longest,
      longestStart: streaks.longestStart,
      longestEnd: streaks.longestEnd,
      topLangs,
    });

    fs.writeFileSync(outFile, svg, 'utf8');
    console.log('Wrote SVG to', outFile);
  } catch (err) {
    console.error('Failed to generate stats:', err);
    process.exit(1);
  }

  async function getContributionCalendar() {
    const query = `
      query ($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
          }
        }
      }
    `;
    const res = await graphqlWithAuth(query, { login: username });
    const weeks = res.user.contributionsCollection.contributionCalendar.weeks;
    const days = [];
    for (const w of weeks) {
      for (const d of w.contributionDays) {
        days.push({ date: d.date, contributionCount: d.contributionCount });
      }
    }
    const totalContributions = res.user.contributionsCollection.contributionCalendar.totalContributions;
    return { days, totalContributions };
  }

  async function getTopLanguages() {
    const repos = await octokit.repos.listForUser({ username, per_page: 100 });
    const languageTotals = {};
    for (const r of repos.data) {
      try {
        const langs = await octokit.repos.listLanguages({ owner: username, repo: r.name });
        for (const [lang, bytes] of Object.entries(langs.data)) {
          languageTotals[lang] = (languageTotals[lang] || 0) + bytes;
        }
      } catch (err) {
        console.warn(`Failed to fetch languages for ${r.name}:`, err.message);
      }
    }
    const totalBytes = Object.values(languageTotals).reduce((a, b) => a + b, 0) || 1;
    const sorted = Object.entries(languageTotals).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6).map(([lang, bytes]) => ({
      lang,
      bytes,
      pct: Math.round((bytes / totalBytes) * 10000) / 100,
    }));
    return top;
  }
})();
