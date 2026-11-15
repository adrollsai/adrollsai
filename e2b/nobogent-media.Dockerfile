FROM e2bdev/base:latest

# Pre-built sandbox image for Nobogent's media work.
#
# WHY: the stock E2B image ships no ffmpeg, no Node 22 and no headless browser, so the code installs
# them at runtime — ~80 seconds before the first frame of every new sandbox. Set
# E2B_TEMPLATE=nobogent-media and provisioning becomes a no-op.

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl gnupg unzip xz-utils fontconfig fonts-dejavu fonts-liberation \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
      libcairo2 libasound2 libatspi2.0-0 \
      && rm -rf /var/lib/apt/lists/*

# Node 22, from the official tarball.
#
# The base image already carries Node 20 in /usr/local, and extracting the tarball over it left the
# OLD npm symlink and node_modules in place: node reported v22 while `npm --version` printed nothing
# and exited non-zero, which failed the next build step with no visible error. Removing the old
# binaries and the old npm tree first is what makes the upgrade coherent.
ARG NODE_VERSION=22.14.0
RUN rm -rf /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/lib/node_modules /usr/local/include/node \
      && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
      && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
      && rm -f /tmp/node.tar.xz \
      && node --version | grep -qE "^v2[2-9]" \
      && npm --version

# The HyperFrames CLI, installed once here instead of in every sandbox. The render script looks for
# exactly this path and skips installing when it is present.
#
# The package.json is written explicitly because `npm init -y` derives the name from the directory,
# and ".nobohf" is an invalid package name ("npm error Invalid name") — which failed this build and,
# at runtime, is hidden behind a redirect while npm install quietly carries on without it.
RUN mkdir -p /home/user/.nobohf \
      && cd /home/user/.nobohf \
      && printf '{"name":"nobohf-media","version":"1.0.0","private":true}\n' > package.json \
      && npm install hyperframes --no-audit --no-fund \
      && ./node_modules/.bin/hyperframes --version \
      && chown -R user:user /home/user/.nobohf

USER user
WORKDIR /home/user

RUN ffmpeg -version | head -1 \
      && node --version \
      && npm --version \
      && test -x /home/user/.nobohf/node_modules/.bin/hyperframes
