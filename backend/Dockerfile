FROM crpi-ibyis3h0u7rejkkz.cn-hangzhou.personal.cr.aliyuncs.com/merchant-ai-hangzhou/sandbox:latest AS builder

USER root
WORKDIR /build
ENV NODE_ENV=development

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --include=dev

COPY backend ./backend
COPY shared ./shared
RUN npm --prefix backend run prebuild \
    && npm --prefix backend run build:clean \
    && npm --prefix backend run build:bundle \
    && npm --prefix backend prune --omit=dev

FROM crpi-ibyis3h0u7rejkkz.cn-hangzhou.personal.cr.aliyuncs.com/merchant-ai-hangzhou/sandbox:latest

USER root
WORKDIR /app
COPY --from=builder /build/backend/package.json ./
COPY --from=builder /build/backend/node_modules ./node_modules
COPY --from=builder /build/backend/dist ./dist
RUN ln -s /app/dist/cli/node.js /usr/local/bin/claude-code-backend

ENV NODE_ENV=production \
    HOME=/home/user \
    CLAUDE_CODE_WEBUI_HOST=0.0.0.0 \
    CLAUDE_CODE_WEBUI_PORT=8080

EXPOSE 8080

ENTRYPOINT []
CMD ["sleep", "infinity"]
