# Runtime Consolidation

Install the cron entry:

```sh
cp etc/cron.d/gideon-consolidation /etc/cron.d/gideon-consolidation
chmod 644 /etc/cron.d/gideon-consolidation
```

Verify cron has picked it up:

```sh
grep gideon-consolidation /var/log/syslog 2>/dev/null || echo "will run at next 3:05am"
```
