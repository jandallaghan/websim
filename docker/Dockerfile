FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY --chown=pwuser:pwuser . .
RUN npm run build
USER pwuser
ENV HOME=/tmp
ENTRYPOINT ["node", "dist/sandbox/worker.js"]
