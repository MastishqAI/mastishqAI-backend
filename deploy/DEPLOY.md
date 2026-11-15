# Deploying Mastishq on AWS

This puts the **new** app on its own addresses and leaves your old live backend (`api.mastishq.ai`) alone.

| What | Address |
|---|---|
| Website | `https://app.mastishq.ai` |
| API (same server) | `https://app.mastishq.ai/api/...` and `https://api-new.mastishq.ai` |
| Database | MongoDB Atlas |
| Server | one Ubuntu 24.04 EC2 machine in Mumbai (`ap-south-1`) |

```
browser ──https──▶ nginx ─┬─▶ /opt/mastishq/frontend   (the React build)
                          └─▶ /api  ──▶ Node API :4000 ──▶ MongoDB Atlas
                                                     └──▶ OpenAI / Google
```

> **Do not** point `api.mastishq.ai`, `mastishq.ai` or `www` at the new server yet. Those are live (old server `13.201.1.26` and `13.235.242.252`). `deploy.sh` refuses to deploy to either of them.

---

## 1. AWS access on your Mac (you do this; keys never go in chat)

The AWS tool is installed (`aws --version` should say `source/arm64`).

1. In the AWS console open **IAM → Users → Create user** (for example `mastishq-deploy`). Do **not** use root keys. Attach the managed policies `AmazonEC2FullAccess` (add `AmazonRoute53FullAccess` only if your DNS is in Route 53). Turn on MFA.
2. Create an **access key** for that user, then in **your own Terminal**:
   ```bash
   aws configure          # paste the key, secret; region: ap-south-1; output: json
   aws sts get-caller-identity   # should print your account and the new user
   ```
3. Tell me when it prints your account. I can then run the EC2 commands below for you, asking before each step that costs money.

## 2. MongoDB Atlas (database)

1. <https://cloud.mongodb.com> → create a project → **Create cluster**: free **M0**, provider **AWS**, region **Mumbai (ap-south-1)**.
2. **Database Access → Add user**: a name and a long random password; role **Read and write to any database** (or limit it to the `smartlearn` database).
3. **Network Access**: you will add the server's Elastic IP in step 4. Do **not** use `0.0.0.0/0`.
4. **Connect → Drivers**: copy the connection string, put the database name in it: `...mongodb.net/smartlearn?retryWrites=true&w=majority`.

> The free M0 tier has **no backups**. Before real users arrive, either upgrade (M10 has continuous backups) or schedule a nightly `mongodump` to S3.

## 3. Create the server

Console (EC2 → Launch instance) or the commands below.

* Image **Ubuntu Server 24.04 LTS**, type **t3.small** (2 GB), disk **20 GB gp3, encrypted**.
* Key pair named `mastishq-new` (download the `.pem`, `chmod 400` it).
* Security group: **22 (SSH) from your IP only**, **80** and **443** from anywhere.
* Allocate an **Elastic IP** and attach it (so the address never changes).

```bash
export AWS_REGION=ap-south-1
aws ec2 create-key-pair --key-name mastishq-new --query KeyMaterial --output text > ~/.ssh/mastishq-new.pem && chmod 400 ~/.ssh/mastishq-new.pem
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 create-security-group --group-name mastishq-new --description "Mastishq web and api" --vpc-id "$VPC" --query GroupId --output text)
MYIP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22  --cidr "$MYIP/32"
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80  --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 443 --cidr 0.0.0.0/0
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
IID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.small --key-name mastishq-new --security-group-ids "$SG" \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,Encrypted=true}' \
  --metadata-options HttpTokens=required \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=mastishq-new}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$IID"
ALLOC=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
aws ec2 associate-address --instance-id "$IID" --allocation-id "$ALLOC"
aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text   # <- your Elastic IP
```

Your SSH rule only allows the IP you had when you ran it. If your home IP changes, update the rule in the security group.

Now add that Elastic IP (as `x.x.x.x/32`) to **Atlas → Network Access**.

## 4. DNS

At whoever hosts the `mastishq.ai` DNS (Route 53 or your registrar) add **two new A records** pointing at the Elastic IP (TTL 300):

| Name | Type | Value |
|---|---|---|
| `app` | A | the Elastic IP |
| `api-new` | A | the Elastic IP |

Leave `api`, `@` and `www` exactly as they are. Check with `dig +short app.mastishq.ai`.

## 5. Prepare the server (once)

```bash
# from your Mac, in the project folder
scp -i ~/.ssh/mastishq-new.pem -r deploy ubuntu@ELASTIC_IP:~/
ssh -i ~/.ssh/mastishq-new.pem ubuntu@ELASTIC_IP

# on the server
sudo APP_DOMAIN=app.mastishq.ai API_DOMAIN=api-new.mastishq.ai EMAIL=you@example.com bash ~/deploy/server-setup.sh
sudo nano /etc/mastishq/api.env      # fill in every value (see the comments in the file)
```

Make the secret with `openssl rand -hex 32`. Use a **new OpenAI key** with a monthly spend limit (set it at platform.openai.com → Settings → Limits). `server-setup.sh` also turns on the firewall, automatic security updates, and the HTTPS certificate (if DNS already points at the server; otherwise it prints the one command to run later).

## 6. First deploy (from your Mac)

```bash
SERVER=ubuntu@ELASTIC_IP SSH_KEY=~/.ssh/mastishq-new.pem ./deploy/deploy.sh
```

It runs the tests, builds the site, uploads, installs, restarts the API and checks `https://api-new.mastishq.ai/health`.

## 7. Finish setup

* **Google sign-in:** Google Cloud → Credentials → your Web client → **Authorized JavaScript origins** → add `https://app.mastishq.ai`.
* **First teacher/admin:** sign up normally at the site, then on the server:
  ```bash
  sudo bash -c 'set -a; . /etc/mastishq/api.env; set +a; cd /opt/mastishq/backend && node src/set-role.js you@example.com admin'
  ```
  (Public sign-up always creates students. Never run the demo `seed` in production; it refuses to.)

## 8. Check it works

- [ ] `https://api-new.mastishq.ai/health` shows `{"ok":true,"db":"connected"}`
- [ ] `https://app.mastishq.ai` loads with a padlock; sign up, finish onboarding
- [ ] Practice → Generate quiz works (can take up to a minute)
- [ ] Google sign-in works, "Ask why" shows sources, Help & Support accepts a file
- [ ] Reloading the page keeps you logged in

## Everyday use

| Task | Command |
|---|---|
| Update the live site | `SERVER=... SSH_KEY=... ./deploy/deploy.sh` |
| API logs | `ssh ... 'sudo journalctl -u mastishq-api -f'` |
| Restart API | `ssh ... 'sudo systemctl restart mastishq-api'` |
| Web server logs | `ssh ... 'sudo tail -f /var/log/nginx/error.log'` |
| Roll back | check out the previous version of the code and run `deploy.sh` again (put the project in git and tag releases) |

## Cost (rough, Mumbai, check the AWS pricing pages)

EC2 t3.small about **$15–17/month**, 20 GB disk about **$2**, the public IP about **$4**, Atlas M0 **free**, Route 53 **$0.50** per zone. About **$20–25/month** plus **OpenAI usage** (billed separately).

## Later: moving `api.mastishq.ai` to the new app

Not yet. The new API uses different URLs and different data than the old SmartLearn backend, so any app still calling the old one (for example anything using `getPracticeQuestionAnswer`) would break. Move it only after those apps are updated, then change the DNS record for `api` (lower its TTL to 300 a day before) and add `api.mastishq.ai` to the nginx `server_name` and certificate.

## Security notes

* Real secrets live only in `/etc/mastishq/api.env` (root-only). Never commit or paste them.
* The API refuses to start in production with a weak `JWT_SECRET`, a localhost database or a non-https `CLIENT_URL`.
* Rotate the OpenAI key that was printed in your old backend's logs.
* The privacy policy and terms text are drafts: have them reviewed before launch.
