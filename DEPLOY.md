# Free hosting (Oracle Cloud Always Free)

Render/Heroku-style free tiers wipe local files, which would delete the SQLite database. Use a VM with a persistent disk.

1. **Create an Oracle Cloud account** (cloud.oracle.com, "Always Free"). A real debit/credit card is needed for verification only; prepaid/virtual cards are rejected.
2. **Create an instance**: Compute → Instances → Create. Image: *Ubuntu 22.04/24.04*. Shape: *VM.Standard.A1.Flex* (ARM, 1 OCPU / 6 GB is plenty) or the free AMD micro. Download the SSH key it offers. Keep the "Always Free eligible" label visible.
3. **Open web ports**: Networking → your VCN → Security Lists → add ingress rules for TCP **80** and **443** from `0.0.0.0/0`.
4. **Free domain**: sign in at duckdns.org, create a name (e.g. `studyhub-adam.duckdns.org`) and point it at the VM's public IP.
5. **Install**:
   ```sh
   ssh -i <key> ubuntu@<vm-ip>
   git clone https://github.com/aaadam-H/studyManagement.git && cd studyManagement
   git checkout claude/dazzling-ptolemy-y1furt        # or main once merged
   sudo DOMAIN=studyhub-adam.duckdns.org ADMIN_PASSWORD='a-strong-password' bash deploy/setup.sh
   ```
   (If the repo is private, make it public temporarily or `scp` the folder instead.)
6. Open `https://<your-domain>`, log in as `admin`, set the timetable link and sync. The VM can reach the UniMAP site, so it should work there.

Handy commands: `sudo journalctl -u studyhub -f` (logs), `sudo systemctl restart studyhub`, backups in `/var/lib/studyhub/backups` (daily, 14 days kept). To update: `git pull`, re-run the setup command.

Oracle can reclaim idle Always Free VMs, so log in to the site now and then.

## No card? Run on your own PC

```sh
ADMIN_PASSWORD='...' npm start
cloudflared tunnel --url http://localhost:3000     # prints a temporary https://xxxx.trycloudflare.com link
```
The link changes each run and the site is down whenever your PC is off.
