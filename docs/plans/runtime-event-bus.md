# Runtime Event Bus

Install the event bus systemd unit:

```sh
cp etc/systemd/system/gideon-event-bus.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now gideon-event-bus.service
systemctl status gideon-event-bus.service
```
