FROM crpi-ibyis3h0u7rejkkz.cn-hangzhou.personal.cr.aliyuncs.com/merchant-ai-hangzhou/sandbox:latest AS builder

USER root
WORKDIR /tmp/claude-code-webui
ENV NODE_ENV=development

COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix frontend ci --include=dev \
    && npm --prefix backend ci --include=dev

COPY frontend ./frontend
COPY backend ./backend
COPY shared ./shared
COPY README.md LICENSE ./

RUN npm --prefix frontend run build \
    && npm --prefix backend run build \
    && mkdir -p /tmp/claude-code-webui-package \
    && cd backend \
    && npm pack --pack-destination /tmp/claude-code-webui-package

FROM crpi-ibyis3h0u7rejkkz.cn-hangzhou.personal.cr.aliyuncs.com/merchant-ai-hangzhou/sandbox:latest

USER root
COPY --from=builder /tmp/claude-code-webui-package/ /tmp/claude-code-webui-package/
RUN npm install --global /tmp/claude-code-webui-package/*.tgz \
    && rm -rf /tmp/claude-code-webui-package

ENV CLAUDE_CODE_WEBUI_HOST=0.0.0.0 \
    CLAUDE_CODE_WEBUI_PORT=8080

EXPOSE 8080

ENTRYPOINT []
CMD ["sleep", "infinity"]
