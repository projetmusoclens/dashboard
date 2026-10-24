# API Express seule (le frontend reste sur Vercel). Contexte de build : la racine du dépôt.
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
# Le package.json racine contient aussi tout le frontend React : on n'installe que les
# modules utilisés par server/, aux versions exactes du package-lock.
RUN node -e " \
  const lock = require('./package-lock.json'); \
  const names = ['compression', 'cors', 'dotenv', 'express', 'mongodb']; \
  const dependencies = Object.fromEntries(names.map((name) => [name, lock.packages['node_modules/' + name].version])); \
  require('fs').writeFileSync('package.json', JSON.stringify({ name: 'heimdall-api', private: true, dependencies }, null, 2)); \
  " \
  && rm package-lock.json \
  && npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY server ./server

ENV NODE_ENV=production PORT=5055
EXPOSE 5055
USER node
CMD ["node", "server/index.js"]
