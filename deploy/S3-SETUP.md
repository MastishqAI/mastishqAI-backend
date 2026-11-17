# S3 for study files (Upload file / Scan a page)

How it works: the learner adds a PDF/photo → the server reads it (PDF text layer for free; scans and photos with the
OpenAI vision model) → the original is saved to S3 → the text is split into chunks in MongoDB. When a quiz is generated,
short material is sent whole; long material is embedded once and only the parts relevant to the topic and description are sent.
The quiz writer, the answer checker and "Ask why" all see the same material.

## 1. Bucket (in YOUR Mastishq AWS account: run `aws sts get-caller-identity` first and confirm the account)
- Region `ap-south-1`, **Block all public access = ON**, default encryption SSE-S3 (AES-256).
- Lifecycle rule: expire objects under `materials/` after **90 days** (the database copies expire after 90 days too).
- Do not enable public URLs or a bucket policy that allows anonymous reads. Files are only ever read by the server.

## 2. Permission for the server (no access keys)
Create an IAM policy and attach it to a role for the EC2 instance running the backend (Instance profile → EC2 → Actions → Security → Modify IAM role):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/materials/*"
  }]
}
```

## 3. Settings on the backend server
Add to the backend `.env`: `S3_BUCKET=YOUR-BUCKET-NAME` and `S3_REGION=ap-south-1`, then `npm install` (new packages) and restart the process.
The server needs **Node 22** (the Google and AWS libraries require it).

## 4. Check
Upload a small PDF on the Practice page, then confirm an object appears under `materials/<user id>/` in the bucket.
If uploads fail with "couldn't read that file", look at `pm2 logs`: an S3 permission error names the missing action.

## Limits (all adjustable)
8 MB per file · 5 files per practice · 30 kept files per learner · 40 PDF pages · 10 reads per learner per day (Pro: 3x).
If nginx sits in front of the API, it must allow bodies of at least 10 MB (`client_max_body_size 10M;`).
