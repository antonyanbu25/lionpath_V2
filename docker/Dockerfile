FROM ubuntu:22.04

ARG HERMES_USER=hermes
ENV DEBIAN_FRONTEND=noninteractive
ENV MESH_INTERVAL=30

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      coreutils \
      openssh-client \
      sqlite3 \
      util-linux && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash "$HERMES_USER"
USER "$HERMES_USER"
WORKDIR "/home/$HERMES_USER"

COPY --chown=$HERMES_USER:$HERMES_USER scripts/ ./.hermes/scripts/
COPY --chown=$HERMES_USER:$HERMES_USER entrypoint.sh ./entrypoint.sh
COPY --chown=$HERMES_USER:$HERMES_USER mesh-nodes.conf.example ./.hermes/config/mesh-nodes.conf.example

RUN chmod +x ./entrypoint.sh ./.hermes/scripts/*.sh && \
    mkdir -p ./.hermes/config ./.hermes/logs ./.hermes/run ./.hermes/agent-radio

VOLUME ["/home/hermes/.hermes/state.db", "/home/hermes/.hermes/config", "/home/hermes/.ssh"]

ENTRYPOINT ["/home/hermes/entrypoint.sh"]
