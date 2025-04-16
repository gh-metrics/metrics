# Metrics docker image
FROM index.docker.io/denoland/deno:2.2.10@sha256:7820b532b724f9283c8962de1cb2d3a7d31f5abc622c3a41ecb4c3d6b9111229
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
