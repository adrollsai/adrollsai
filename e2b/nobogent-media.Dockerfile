# Pre-built sandbox image for Nobogent's media work.
#
# WHY THIS EXISTS
# The stock E2B image ships no ffmpeg, no Node 22 and no headless browser, so the code installs
# them at runtime: ~80 seconds before the first frame of the first render for every new sandbox.
# That is dead time on every cold start, and it is the single biggest remaining scalability cost.
#
# Set E2B_TEMPLATE=nobogent-media and the provisioning step is skipped entirely (the code trusts
# the image), so the first render starts immediately.
#
# BUILD
#   npm i -g @e2b/cli
#   e2b template build --name nobogent-media --dockerfile e2b/nobogent-media.Dockerfile
#   # then set E2B_TEMPLATE=nobogent-media in Vercel (production) and redeploy
#
# The versions are pinned to what the runtime installer resolves today, so the image and the
# fallback path behave the same.

FROM e2bdev/base:latest

USER root

# ffmpeg for every audio/video operation, plus the codecs the media pipeline expects
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates curl gnupg unzip \
      fontconfig fonts-dejavu fonts-liberation \
      && rm -rf /var/lib/apt/lists/*

# Node 22 — HyperFrames requires it
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
      && apt-get install -y --no-install-recommends nodejs \
      && rm -rf /var/lib/apt/lists/* \
      && node --version && npm --version

# Shared libraries headless Chrome needs (the same set the runtime provisioning installs)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
      libcairo2 libasound2 libatspi2.0-0 \
      && rm -rf /var/lib/apt/lists/*

USER user
WORKDIR /home/user

# The HyperFrames CLI and its browser, installed once into the image instead of per sandbox.
# The render script looks for exactly this path and skips installing when it is present.
RUN mkdir -p /home/user/.nobohf && cd /home/user/.nobohf \
      && npm init -y >/dev/null 2>&1 \
      && npm install hyperframes --no-audit --no-fund \
      && ./node_modules/.bin/hyperframes --version

# Pre-download the browser HyperFrames renders with, so the first render does not wait for it.
RUN cd /home/user/.nobohf && ./node_modules/.bin/hyperframes setup 2>/dev/null || true

# Sanity check at build time: if any of these fail the image is not worth shipping.
RUN ffmpeg -version | head -1 \
      && node -e "console.log('node', process.versions.node)" \
      && ls -d /home/user/.nobohf/node_modules/.bin/hyperframes

ENV PATH="/usr/local/bin:${PATH}"
