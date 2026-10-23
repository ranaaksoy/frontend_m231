# rana-frontend: Web-Oberflaeche + Queue-Producer des Rezept-Planers.
FROM docker.io/library/node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Erst nur die Abhaengigkeiten: dieser Layer bleibt gecacht, solange sich
# package*.json nicht aendert.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public

USER node
EXPOSE 3000

# Kein curl im Image -- Node prueft /health selbst.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Ohne npm als Zwischenprozess, damit SIGTERM direkt bei Node ankommt.
CMD ["node", "--require", "./src/telemetry.js", "server.js"]
