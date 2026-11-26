require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const GITHUB_USER = process.env.GITHUB_USERNAME || 'Pritam9952';
const ADMIN_KEY = process.env.ADMIN_KEY || 'pritam2026';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DB_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = { views: 1250, inquiries: [], cachedRepos: null, lastSync: 0 };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (err) {
    return { views: 1250, inquiries: [], cachedRepos: null, lastSync: 0 };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// 1. PERSISTENT VISITOR COUNTER
app.post('/api/visit', (req, res) => {
  const db = readDB();
  db.views = (db.views || 1250) + 1;
  writeDB(db);
  res.json({ success: true, views: db.views });
});

app.get('/api/visit', (req, res) => {
  const db = readDB();
  res.json({ success: true, views: db.views || 1250 });
});

// 2. HIRING & FREELANCE INQUIRIES
app.post('/api/inquiries', (req, res) => {
  const { name, email, scope, message } = req.body;
  if (!name || !email) {
    return res.status(400).json({ success: false, error: 'Name and Work Email are required.' });
  }
  const db = readDB();
  const newInquiry = {
    id: 'INQ-' + Date.now(),
    name: String(name).trim(),
    email: String(email).trim(),
    scope: scope ? String(scope).trim() : 'General Inquiry',
    message: message ? String(message).trim() : '',
    createdAt: new Date().toISOString()
  };
  db.inquiries.unshift(newInquiry);
  writeDB(db);
  res.status(201).json({ success: true, inquiry: newInquiry });
});

app.get('/api/inquiries', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const db = readDB();
  res.json({ total: db.inquiries.length, views: db.views, inquiries: db.inquiries });
});

app.get('/api/inquiries/export.csv', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).send('Unauthorized');
  }
  const db = readDB();
  const headers = ['Inquiry ID', 'Name', 'Email', 'Track/Scope', 'Message', 'Date'];
  const rows = db.inquiries.map(i => [
    i.id,
    `"${i.name.replace(/"/g, '""')}"`, `"${i.email.replace(/"/g, '""')}"`,
    `"${i.scope.replace(/"/g, '""')}"`, `"${i.message.replace(/"/g, '""')}"`,
    i.createdAt
  ]);
  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="pritam-portfolio-inquiries.csv"');
  res.send(csvContent);
});

// 3. DEEP GITHUB REPO TREE + REAL DASHBOARD SCREENSHOT FILTER (>35KB, NO ICONS)
app.get('/api/github-projects', async (req, res) => {
  const db = readDB();
  const CACHE_TTL = 30 * 60 * 1000;

  if (db.cachedRepos && Date.now() - db.lastSync < CACHE_TTL && req.query.refresh !== 'true') {
    return res.json({ source: 'cache', projects: db.cachedRepos });
  }

  try {
    const apiUrl = 'https://api.github.com/users/' + GITHUB_USER + '/repos?sort=updated&per_page=30';
    const repoRes = await fetch(apiUrl, { headers: { 'User-Agent': 'Pritam-Nagar-Portfolio' } });
    if (!repoRes.ok) throw new Error('GitHub API Status: ' + repoRes.status);

    const repos = await repoRes.json();
    const ignored = ['Pritam9952', 'pritam9952.github.io', 'pritam-portfolio', 'pritam-nagar-portfolio'];
    const ownRepos = repos.filter(r => !r.fork && !ignored.includes(r.name));

    const enrichedProjects = await Promise.all(
      ownRepos.map(async (repo) => {
        const branch = repo.default_branch || 'main';
        const rawBase = 'https://raw.githubusercontent.com/' + GITHUB_USER + '/' + repo.name + '/' + branch + '/';
        let image = null;
        let allImages = [];
        let summary = repo.description || 'End-to-end ' + (repo.language || 'Data & Web') + ' repository by Pritam Nagar.';

        try {
          const treeUrl = 'https://api.github.com/repos/' + GITHUB_USER + '/' + repo.name + '/git/trees/' + branch + '?recursive=1';
          const treeRes = await fetch(treeUrl, { headers: { 'User-Agent': 'Pritam-Nagar-Portfolio' } });
          if (treeRes.ok) {
            const treeData = await treeRes.json();
            const imgFiles = (treeData.tree || []).filter(item =>
              item.type === 'blob' &&
              /\.(png|jpg|jpeg|webp)$/i.test(item.path) &&
              (item.size || 0) > 35000 &&
              !/(logo|icon|badge|avatar|symbol|arrow|star|mzazon_logo)/i.test(item.path)
            );
            // Prioritize dashboard_img or screenshot filenames first
            imgFiles.sort((a, b) => {
              const aScore = /(dashboard|screenshot|preview|result|output)/i.test(a.path) ? -1 : 1;
              const bScore = /(dashboard|screenshot|preview|result|output)/i.test(b.path) ? -1 : 1;
              return aScore - bScore;
            });
            allImages = imgFiles.map(f => rawBase + encodeURI(f.path));
            if (allImages.length > 0) image = allImages[0];
          }
        } catch (_) {}

        try {
          const readmeRes = await fetch(rawBase + 'README.md');
          if (readmeRes.ok) {
            const md = await readmeRes.text();
            if (!image) {
              const mdImg = md.match(/!\[.*?\]\(([^)\s]+)\)/);
              const htmlImg = md.match(/<img[^>]+src=["']([^"']+)["']/i);
              const rawImgPath = (mdImg && mdImg[1]) || (htmlImg && htmlImg[1]) || null;
              if (rawImgPath && !rawImgPath.includes('shields.io') && !rawImgPath.includes('badge')) {
                image = rawImgPath.startsWith('http')
                  ? rawImgPath
                  : rawBase + encodeURI(rawImgPath.replace(/^\.?\//, ''));
              }
            }
            const cleanText = md
              .replace(/!\[.*?\]\(.*?\)/g, '')
              .replace(/<[^>]*>/g, '')
              .replace(/[#*`>|_-]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (cleanText.length > 35) summary = cleanText.slice(0, 185) + '...';
          }
        } catch (_) {}

        return {
          name: repo.name.replace(/[-_]/g, ' '),
          rawName: repo.name,
          description: summary,
          language: repo.language || 'Data Analytics',
          stars: repo.stargazers_count,
          topics: repo.topics || [],
          url: repo.html_url,
          homepage: repo.homepage || repo.html_url,
          image,
          allImages
        };
      })
    );

    db.cachedRepos = enrichedProjects;
    db.lastSync = Date.now();
    writeDB(db);
    res.json({ source: 'live', projects: enrichedProjects });
  } catch (error) {
    res.json({ source: 'fallback', projects: db.cachedRepos || [] });
  }
});

// 4. EXTREME AI CO-PILOT ENDPOINT (GEMINI API + SMART CONTEXT FALLBACK)
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ reply: 'Please ask a question!' });

  const db = readDB();
  const repoSummary = (db.cachedRepos || [])
    .slice(0, 8)
    .map(r => `${r.name} (${r.language}): ${r.description}`)
    .join('; ');

  if (GEMINI_API_KEY) {
    try {
      const systemPrompt = `You are Pritam AI, the interactive portfolio assistant for Pritam Nagar (Final-year B.Tech Mechanical Engineering at MANIT / NIT Bhopal; Data & Business Intelligence Analyst skilled in Python, SQL, PostgreSQL, Power BI, DAX, Advanced Excel; and Full-Stack/Frontend Web Developer).
Experience: Quality Assurance & Data Analytics Trainee at Eicher TMTL (built Defect Analysis Dashboard with Excel & Power Query), Freelance Web Developer (built Niharika Collection e-commerce storefront in Indore & Placement Portal on Vercel).
Featured Projects: Netflix User Retention Analysis, Amazon Sales Data Warehouse & Power BI Dashboard, Eicher TMTL Defect Analysis Dashboard, Uber Rides Demand & Cancellation Analysis, Skin Cancer Classification Deep Learning App, Placement Portal (Full-Stack).
Live GitHub Repos: ${repoSummary}.
Respond concisely in Hinglish or English matching the user's language, warmly and professionally.`;

      const gRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nVisitor Question: ${message}` }] }]
          })
        }
      );
      if (gRes.ok) {
        const gData = await gRes.json();
        const aiText = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (aiText) return res.json({ reply: aiText, mode: 'gemini' });
      }
    } catch (_) {}
  }

  const q = message.toLowerCase();
  let reply = `Pritam Nagar (NIT Bhopal '26) Data & BI Analytics (SQL, PostgreSQL, Python, Power BI) aur Full-Stack/Frontend Web Development me specialize karte hain. Unke ${db.cachedRepos ? db.cachedRepos.length : 13}+ GitHub repos live synced hain!`;

  if (q.includes('jd') || q.includes('match') || q.includes('hire') || q.includes('role') || q.includes('requirement')) {
    const keywords = ['sql', 'python', 'power bi', 'excel', 'postgresql', 'html', 'css', 'javascript', 'analytics', 'dashboard', 'frontend'];
    const matched = keywords.filter(k => q.includes(k));
    const score = matched.length > 0 ? Math.min(98, 72 + matched.length * 6) : 91;
    reply = `🎯 JD Fit Score: ${score}% Match! Pritam ke paas ${matched.length > 0 ? matched.join(', ').toUpperCase() : 'SQL, Python, Power BI & Web Dev'} ka hands-on project proof hai (Netflix Retention, Amazon Sales Dashboard, Eicher TMTL). Neeche Contact form me apna email de dein!`;
  } else if (q.includes('eicher') || q.includes('intern') || q.includes('experience')) {
    reply = `🏭 Pritam ne May–June 2024 me Eicher TMTL me Quality Assurance & Data Analytics Trainee ke roop me kaam kiya, jahan Excel & Power Query se tractor component Defect Analysis Dashboard banaya.`;
  } else if (q.includes('niharika') || q.includes('freelance') || q.includes('placement')) {
    reply = `🛍️ Web Development me Pritam ne Indore ke Niharika Collection ke liye 3D e-commerce storefront aur Full-Stack Placement Portal (placement-portal-self-beta.vercel.app) banaya hai.`;
  } else if (db.cachedRepos) {
    const foundRepo = db.cachedRepos.find(r => q.includes(r.name.toLowerCase().split(' ')[0]));
    if (foundRepo) {
      reply = `📂 Repo Found — "${foundRepo.name}" (${foundRepo.language}): ${foundRepo.description}`;
    }
  }

  res.json({ reply, mode: 'smart-local' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log('🚀 Pritam Nagar Portfolio + AI Co-Pilot Live at http://localhost:' + PORT);
});