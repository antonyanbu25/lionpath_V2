# Gideon Fringe Node

This image runs the Phase 0 memory-only fringe node. It does not run the full
Hermes agent runtime; it runs `mesh-memory-daemon.sh` against peers configured in
`~/.hermes/config/mesh-nodes.conf`.

Build from this directory:

```bash
docker build -t gideon-fringe ~/gideon-mesh/docker/
```

Run with the host state database and SSH keys mounted:

```bash
docker run -d \
  -v ~/.hermes/state.db:/home/hermes/.hermes/state.db \
  -v ~/.hermes/config:/home/hermes/.hermes/config \
  -v ~/.ssh:/home/hermes/.ssh:ro \
  -e MESH_INTERVAL=30 \
  gideon-fringe
```

The container creates an empty `state.db` if no database is mounted. Remote sync
requires SSH keys that can authenticate to each configured peer.
