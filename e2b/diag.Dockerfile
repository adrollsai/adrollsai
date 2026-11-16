FROM e2bdev/base:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates xz-utils \
      && rm -rf /var/lib/apt/lists/*
ARG NODE_VERSION=22.14.0
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
      && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && rm -f /tmp/node.tar.xz
RUN echo "--- diagnostics ---"; which node; which npm; node --version; npm --version; echo "PATH=$PATH"; ls -la /usr/local/bin | head -20
