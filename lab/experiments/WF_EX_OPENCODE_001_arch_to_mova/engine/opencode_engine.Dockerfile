FROM oven/bun:1

WORKDIR /work
ENV HUSKY=0 CI=1

# opencode sources will be provided as build context
COPY . /work

# deps for TSX + tool modules (fixes react/jsx-dev-runtime + octokit tool)
RUN bun install && bun add react react-dom @octokit/rest

EXPOSE 4096
CMD ["bash","-lc","bun run packages/opencode/src/index.ts serve --hostname 0.0.0.0 --port 4096"]

