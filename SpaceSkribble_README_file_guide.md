# Sami – kon file kothay boshabe

Folder structure ta project er moto-i rakha hoyeche. Protita file tomar project e **same jaygay replace** koro.

## NOTUN file (add koro)
| File | Kothay |
|---|---|
| public/js/config.js | backend URL setting |
| public/js/gate.js | login guard (game er age login) |
| public/js/i18n.js | English/বাংলা |
| public/js/nasa-live.js | home page e live NASA cards |
| .env.example | secret keys er template (copy kore `.env` banao) |
| .gitignore | node_modules, .env, database git e jabe na |
| render.yaml | Render e deploy |

## PURANO file (replace koro)
server.js, package.json, netlify.toml, README.md, AGENTS.md,
public/index.html, public/login.html, public/register.html, public/profile.html,
public/profile.js, public/app.js, public/nova-chatbot.js, public/style.css, public/js/auth.js

## DELETE koro
- auto-server.js  (ekhon server.js e merge hoyeche)
- database/auth.db, auth.db-shm, auth.db-wal  (git/zip e rakho na; server nijei banabe)
- node_modules  (git e rakho na)
- package-lock.json  (delete kore `npm install` dao, notun banabe)

## Run
npm install
npm start      -> http://localhost:3000
