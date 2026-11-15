// Generates the SVG cards used by README.md (header, stats, languages, projects).
// Runs daily from .github/workflows/profile.yml. No dependencies, Node 20+.
//   GITHUB_TOKEN=... node scripts/generate.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const LOGIN = 'aboodsido';
const OUT = new URL('../assets/', import.meta.url);

// Featured repos and their copy. Repo descriptions on GitHub are mostly empty,
// so the text lives here.
const PROJECTS = [
  {
    repo: 'wireless_mobile_controller',
    title: 'Wireless Mobile Controller',
    desc: 'Turns a phone into a wireless touchpad for Windows. Pair by QR code, then stream gestures to a .NET WebSocket server.',
    tags: ['Flutter', '.NET', 'WebSocket'],
  },
  {
    repo: 'pet',
    title: 'PET · Expense Tracker',
    desc: 'Local-first personal finance app with a dashboard, interactive charts, smart filters and rule-based spending advice.',
    tags: ['Flutter', 'Charts', 'Offline'],
  },
  {
    repo: 'TaskManager-Pro',
    title: 'TaskNexus',
    desc: 'Task management for teams: create and assign tasks, share files and manage workers in real time.',
    tags: ['Flutter', 'Firebase', 'Firestore'],
  },
  {
    repo: 'text_recognition_app',
    title: 'Invoice OCR Scanner',
    desc: 'Scans invoice photos with Google ML Kit, extracts number, date and total, and exports the data.',
    tags: ['Flutter', 'ML Kit', 'OCR'],
  },
  {
    repo: 'Routes-Generator-App',
    title: 'Walking Routes',
    desc: 'Generates looped walking routes from the time you have, with distinct outbound and return paths on Google Maps.',
    tags: ['Flutter', 'Google Maps'],
  },
  {
    repo: 'chatty',
    title: 'Chatty',
    desc: 'Real-time chat app with authentication, conversations and a clean, responsive Flutter UI.',
    tags: ['Flutter', 'Firebase', 'Chat'],
  },
];

// Languages that only appear because of Flutter platform scaffolding.
const IGNORED_LANGS = new Set([
  'C++', 'CMake', 'C', 'Swift', 'Objective-C', 'Kotlin', 'Ruby', 'Shell',
  'Batchfile', 'PowerShell', 'Makefile', 'Dockerfile',
]);

const THEMES = {
  dark: {
    bg1: '#0b1020', bg2: '#111a33', border: '#22304f', text: '#e6edf3',
    muted: '#8b9bb4', faint: '#1a2540', chip: '#16213d', chipText: '#9cc9ff',
    a1: '#13B9FD', a2: '#5b6cff', a3: '#02569B',
  },
  light: {
    bg1: '#ffffff', bg2: '#f3f7ff', border: '#d8e2f0', text: '#1f2328',
    muted: '#57606a', faint: '#e8eef8', chip: '#e9f2ff', chipText: '#0b5cad',
    a1: '#0aa2e6', a2: '#4b5bf0', a3: '#02569B',
  },
};

const FONT = `'Segoe UI', -apple-system, BlinkMacSystemFont, Ubuntu, 'Helvetica Neue', Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, 'Cascadia Code', Menlo, Consolas, monospace`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

function wrap(text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > max) {
      lines.push(line.trim());
      line = word;
    } else {
      line += ' ' + word;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

// ---------- data ----------

async function gql(query, variables) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchData() {
  const { user } = await gql(
    `query($login: String!) {
      user(login: $login) {
        createdAt
        followers { totalCount }
        pullRequests { totalCount }
        contributionsCollection { contributionYears }
        repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
          totalCount
          nodes {
            name
            stargazerCount
            forkCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges { size node { name color } }
            }
          }
        }
      }
    }`,
    { login: LOGIN },
  );

  let contributions = 0;
  for (const year of user.contributionsCollection.contributionYears) {
    const { user: y } = await gql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) { contributionCalendar { totalContributions } }
        }
      }`,
      { login: LOGIN, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    );
    contributions += y.contributionsCollection.contributionCalendar.totalContributions;
  }

  const repos = user.repositories.nodes;
  const langs = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      if (IGNORED_LANGS.has(node.name)) continue;
      const cur = langs.get(node.name) ?? { size: 0, color: node.color ?? '#8b949e' };
      cur.size += size;
      langs.set(node.name, cur);
    }
  }
  const total = [...langs.values()].reduce((a, l) => a + l.size, 0) || 1;
  const languages = [...langs.entries()]
    .map(([name, l]) => ({ name, color: l.color, pct: (l.size / total) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);

  return {
    contributions,
    repos: user.repositories.totalCount,
    stars: repos.reduce((a, r) => a + r.stargazerCount, 0),
    followers: user.followers.totalCount,
    prs: user.pullRequests.totalCount,
    since: new Date(user.createdAt).getFullYear(),
    languages,
    byName: Object.fromEntries(repos.map((r) => [r.name, r])),
  };
}

// ---------- shared pieces ----------

const defs = (t, id) => `
  <defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.bg1}"/><stop offset="1" stop-color="${t.bg2}"/>
    </linearGradient>
    <linearGradient id="${id}-accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${t.a1}"/><stop offset="1" stop-color="${t.a2}"/>
    </linearGradient>
  </defs>`;

const frame = (t, id, w, h) =>
  `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="16" fill="url(#${id}-bg)" stroke="${t.border}"/>`;

const style = (extra = '') => `
  <style>
    text { font-family: ${FONT}; }
    .mono { font-family: ${MONO}; }
    .fade { opacity: 0; animation: fade .7s ease-out forwards; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    ${extra}
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; opacity: 1 !important; } }
  </style>`;

// ---------- header ----------

function header(t, mode) {
  const w = 1000, h = 300, id = `hd-${mode}`;
  const chips = ['📍 Gaza, Palestine', '💼 Optimiza', '📱 3+ years of Flutter'];
  let x = 60;
  const chipSvg = chips.map((c) => {
    const cw = c.length * 7.6 + 30;
    const s = `<g transform="translate(${x} 214)"><rect width="${cw}" height="32" rx="16" fill="${t.chip}" stroke="${t.border}"/>
      <text x="${cw / 2}" y="21" text-anchor="middle" font-size="13.5" fill="${t.chipText}" font-weight="600">${esc(c)}</text></g>`;
    x += cw + 10;
    return s;
  }).join('');

  const code = [
    [['kw', 'final '], ['ty', 'dev'], ['op', ' = '], ['ty', 'Developer'], ['op', '(']],
    [['op', '  name: '], ['st', "'Abdullah'"], ['op', ',']],
    [['op', '  loves: '], ['st', "'Flutter'"], ['op', ',']],
    [['op', '  ships: '], ['kw', 'true'], ['op', ',']],
    [['op', ');']],
  ];
  const colors = { kw: t.a2, ty: t.a1, st: mode === 'dark' ? '#7ee787' : '#1a7f37', op: t.muted };
  const codeSvg = code.map((line, i) =>
    `<text class="mono" x="0" y="${i * 22}" font-size="13" xml:space="preserve">${line.map(([k, s]) => `<tspan fill="${colors[k]}">${esc(s)}</tspan>`).join('')}</text>`,
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Abdullah Abo-Sido, Flutter Developer">
  ${defs(t, id)}
  ${style(`
    .blob { animation: drift 14s ease-in-out infinite alternate; transform-origin: center; }
    .blob2 { animation-duration: 18s; animation-direction: alternate-reverse; }
    @keyframes drift { from { transform: translate(0,0) scale(1); } to { transform: translate(-40px, 20px) scale(1.15); } }
    .cursor { animation: blink 1s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
  `)}
  <clipPath id="${id}-clip"><rect width="${w}" height="${h}" rx="20"/></clipPath>
  <g clip-path="url(#${id}-clip)">
    <rect width="${w}" height="${h}" fill="url(#${id}-bg)"/>
    <circle class="blob" cx="860" cy="40" r="170" fill="${t.a1}" opacity="${mode === 'dark' ? 0.16 : 0.12}"/>
    <circle class="blob blob2" cx="980" cy="260" r="150" fill="${t.a2}" opacity="${mode === 'dark' ? 0.18 : 0.10}"/>
    <circle class="blob" cx="80" cy="320" r="120" fill="${t.a3}" opacity="${mode === 'dark' ? 0.22 : 0.06}"/>
  </g>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="20" fill="none" stroke="${t.border}"/>

  <g class="fade">
    <text x="60" y="78" font-size="16" fill="${t.muted}" font-weight="600" letter-spacing="3">HELLO, WORLD — I'M</text>
    <text x="58" y="138" font-size="54" font-weight="800" fill="${t.text}" letter-spacing="-1">Abdullah <tspan fill="url(#${id}-accent)">Abo-Sido</tspan></text>
  </g>
  <g class="fade" style="animation-delay:.15s">
    <text x="60" y="182" font-size="21" fill="${t.muted}">Flutter developer crafting fast, pixel-perfect mobile apps.</text>
  </g>
  <g class="fade" style="animation-delay:.3s">${chipSvg}</g>

  <g class="fade" style="animation-delay:.45s" transform="translate(690 70)">
    <rect width="260" height="170" rx="14" fill="${mode === 'dark' ? '#0a0f1e' : '#ffffff'}" stroke="${t.border}" opacity="0.92"/>
    <circle cx="20" cy="20" r="5" fill="#ff5f57"/><circle cx="37" cy="20" r="5" fill="#febc2e"/><circle cx="54" cy="20" r="5" fill="#28c840"/>
    <text class="mono" x="236" y="24" text-anchor="end" font-size="11" fill="${t.muted}">main.dart</text>
    <g transform="translate(20 58)">${codeSvg}
      <rect class="cursor" x="30" y="${4 * 22 - 11}" width="8" height="14" fill="${t.a1}"/>
    </g>
  </g>
</svg>`;
}

// ---------- stats ----------

function stats(t, mode, d) {
  const w = 480, h = 230, id = `st-${mode}`;
  const items = [
    ['Contributions', fmt(d.contributions), 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8.75-3.75v3.44l2.03 2.03a.75.75 0 1 1-1.06 1.06L7.47 8.53a.75.75 0 0 1-.22-.53v-3.75a.75.75 0 0 1 1.5 0Z'],
    ['Public repos', fmt(d.repos), 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.71 1.71.75.75 0 0 1-1.07 1.05A2.5 2.5 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.71A2.5 2.5 0 0 1 4.5 9h8Z'],
    ['Stars earned', fmt(d.stars), 'M8 .25a.75.75 0 0 1 .67.42l1.88 3.81 4.2.61a.75.75 0 0 1 .42 1.28l-3.04 2.96.72 4.19a.75.75 0 0 1-1.09.79L8 12.33l-3.76 1.98a.75.75 0 0 1-1.09-.79l.72-4.19L.83 6.37a.75.75 0 0 1 .42-1.28l4.2-.61L7.33.67A.75.75 0 0 1 8 .25Z'],
    ['Pull requests', fmt(d.prs), 'M1.5 3.25a2.25 2.25 0 1 1 3 2.12v5.26a2.25 2.25 0 1 1-1.5 0V5.37A2.25 2.25 0 0 1 1.5 3.25Zm5.68-1.03L9.53.47a.25.25 0 0 1 .43.18V2h1.29A2.75 2.75 0 0 1 14 4.75v5.88a2.25 2.25 0 1 1-1.5 0V4.75c0-.69-.56-1.25-1.25-1.25H9.96v1.35a.25.25 0 0 1-.43.18L7.18 2.68a.25.25 0 0 1 0-.36Z'],
  ];
  const cells = items.map(([label, value, icon], i) => {
    const cx = 28 + (i % 2) * 222, cy = 72 + Math.floor(i / 2) * 72;
    return `<g class="fade" style="animation-delay:${0.1 * i}s" transform="translate(${cx} ${cy})">
      <rect width="206" height="60" rx="12" fill="${t.faint}" opacity="0.7"/>
      <g transform="translate(16 22)" fill="${t.a1}"><path d="${icon}"/></g>
      <text x="44" y="27" font-size="22" font-weight="800" fill="${t.text}">${esc(value)}</text>
      <text x="44" y="46" font-size="12" fill="${t.muted}">${esc(label)}</text>
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="GitHub stats">
  ${defs(t, id)}${style()}
  ${frame(t, id, w, h)}
  <text x="28" y="44" font-size="17" font-weight="700" fill="${t.text}">GitHub stats</text>
  <text x="${w - 28}" y="44" text-anchor="end" font-size="12" fill="${t.muted}">on GitHub since ${d.since}</text>
  ${cells}
</svg>`;
}

// ---------- languages ----------

function languages(t, mode, d) {
  const w = 480, h = 230, id = `lg-${mode}`;
  const barW = w - 56;
  let x = 0;
  const bar = d.languages.map((l) => {
    const lw = (l.pct / 100) * barW;
    const s = `<rect x="${x}" y="0" width="${Math.max(lw, 2)}" height="10" fill="${l.color}"/>`;
    x += lw;
    return s;
  }).join('');
  const legend = d.languages.map((l, i) => {
    const lx = 28 + (i % 2) * 222, ly = 112 + Math.floor(i / 2) * 34;
    return `<g class="fade" style="animation-delay:${0.08 * i}s" transform="translate(${lx} ${ly})">
      <circle cx="6" cy="-4" r="6" fill="${l.color}"/>
      <text x="20" y="0" font-size="14" font-weight="600" fill="${t.text}">${esc(l.name)}</text>
      <text x="200" y="0" text-anchor="end" font-size="13" fill="${t.muted}">${l.pct.toFixed(1)}%</text>
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Most used languages">
  ${defs(t, id)}${style()}
  <clipPath id="${id}-bar"><rect width="${barW}" height="10" rx="5"/></clipPath>
  ${frame(t, id, w, h)}
  <text x="28" y="44" font-size="17" font-weight="700" fill="${t.text}">Most used languages</text>
  <text x="${w - 28}" y="44" text-anchor="end" font-size="12" fill="${t.muted}">public repos, by code size</text>
  <g transform="translate(28 66)" clip-path="url(#${id}-bar)">${bar}</g>
  ${legend}
</svg>`;
}

// ---------- project cards ----------

function project(t, mode, p, repo) {
  const w = 480, h = 170, id = `pj-${mode}`;
  const lines = wrap(p.desc, 60).slice(0, 3);
  let x = 28;
  const tags = p.tags.map((tag) => {
    const tw = tag.length * 7 + 22;
    const s = `<g transform="translate(${x} 128)"><rect width="${tw}" height="24" rx="12" fill="${t.chip}"/>
      <text x="${tw / 2}" y="16.5" text-anchor="middle" font-size="12" font-weight="600" fill="${t.chipText}">${esc(tag)}</text></g>`;
    x += tw + 8;
    return s;
  }).join('');
  const stars = repo?.stargazerCount ?? 0;
  const starSvg = stars > 0
    ? `<g transform="translate(${w - 60} 30)" fill="${t.muted}"><path transform="scale(.9)" d="M8 .25a.75.75 0 0 1 .67.42l1.88 3.81 4.2.61a.75.75 0 0 1 .42 1.28l-3.04 2.96.72 4.19a.75.75 0 0 1-1.09.79L8 12.33l-3.76 1.98a.75.75 0 0 1-1.09-.79l.72-4.19L.83 6.37a.75.75 0 0 1 .42-1.28l4.2-.61L7.33.67A.75.75 0 0 1 8 .25Z"/>
      <text x="20" y="12.5" font-size="13" font-weight="600">${stars}</text></g>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(p.title)}">
  ${defs(t, id)}${style()}
  ${frame(t, id, w, h)}
  <rect x="28" y="0" width="64" height="3" rx="1.5" fill="url(#${id}-accent)"/>
  <g transform="translate(28 30)" fill="${t.a1}"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.71 1.71.75.75 0 0 1-1.07 1.05A2.5 2.5 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.71A2.5 2.5 0 0 1 4.5 9h8Z"/></g>
  <text x="52" y="43" font-size="17" font-weight="700" fill="${t.text}">${esc(p.title)}</text>
  ${starSvg}
  ${lines.map((l, i) => `<text x="28" y="${74 + i * 20}" font-size="13.5" fill="${t.muted}">${esc(l)}</text>`).join('')}
  ${tags}
</svg>`;
}

// ---------- main ----------

const data = await fetchData();
await mkdir(new URL('projects/', OUT), { recursive: true });
for (const [mode, t] of Object.entries(THEMES)) {
  await writeFile(new URL(`header-${mode}.svg`, OUT), header(t, mode));
  await writeFile(new URL(`stats-${mode}.svg`, OUT), stats(t, mode, data));
  await writeFile(new URL(`languages-${mode}.svg`, OUT), languages(t, mode, data));
  for (const p of PROJECTS) {
    await writeFile(new URL(`projects/${p.repo}-${mode}.svg`, OUT), project(t, mode, p, data.byName[p.repo]));
  }
}
console.log(`contributions=${data.contributions} repos=${data.repos} stars=${data.stars} followers=${data.followers} prs=${data.prs}`);
console.log(`languages=${data.languages.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(', ')}`);
