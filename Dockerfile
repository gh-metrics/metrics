# Metrics docker image
FROM index.docker.io/denoland/deno:alpine-2.2.10@sha256:6b0da61a2318747a0390ebce31fb93fc61cbc31e01de18bb9182932c070b2441
RUN apk upgrade --no-cache --available

# Install sudo
RUN apk add --update --no-cache sudo \
  && echo 'metrics ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/metrics

# Install licensed
RUN apk add --no-cache ruby \
  && apk add --no-cache --virtual .licensed ruby-dev make cmake g++ heimdal-dev \
  && gem install licensed \
  && apk del .licensed \
  && licensed --version

# Install chromium
ENV CHROME_BIN /usr/bin/chromium-browser
ENV CHROME_PATH /usr/lib/chromium/
ENV CHROME_EXTRA_FLAGS "--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"
RUN apk add --no-cache chromium ttf-freefont font-noto-emoji \
  && apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community font-wqy-zenhei \
  && chromium --version

# Install docker
RUN apk add --update --no-cache docker-cli \
  && addgroup docker \
  && docker --version

# Install lighthouse
RUN deno install --global npm:lighthouse \
  && lighthouse --version

# General configuration
RUN apk add --no-cache git \
  && adduser --system metrics \
  && addgroup metrics docker

# Metrics
USER metrics
WORKDIR /metrics
ENV TZ Europe/Paris
ENV TMP /tmp
COPY source /metrics/source
COPY deno.jsonc /metrics/deno.jsonc
COPY LICENSE /metrics/LICENSE
RUN deno task make cache
RUN deno task make get:browser
ENTRYPOINT [ "deno", "task", "make", "run", "github-action" ]
