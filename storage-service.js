const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCAL_UPLOAD_ROOT = path.join(__dirname, 'uploads');
const PUBLIC_BASE_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

function safeSegment(value) {
  return String(value || 'file')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'file';
}

function extensionFor(file) {
  return path.extname(file.originalname || '').toLowerCase();
}

function makeObjectKey({ bucket, userId, file }) {
  const ext = extensionFor(file);
  const baseName = safeSegment(path.basename(file.originalname || 'upload', ext));
  const stamp = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  return `${safeSegment(bucket)}/user-${Number(userId)}/${stamp}-${baseName}${ext}`;
}

async function saveLocalObject({ bucket, userId, file }) {
  const key = makeObjectKey({ bucket, userId, file });
  const absolutePath = path.join(LOCAL_UPLOAD_ROOT, key);
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, file.buffer);

  const relativeUrl = `/uploads/${key.replace(/\\/g, '/')}`;
  return {
    provider: 'local',
    bucket,
    key,
    url: PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}${relativeUrl}` : relativeUrl,
    path: relativeUrl,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
}

async function saveSupabaseObject({ bucket, userId, file }) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase Storage.');
  }

  const key = makeObjectKey({ bucket, userId, file }).replace(`${safeSegment(bucket)}/`, '');
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${key}`;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': file.mimetype,
      'x-upsert': 'true',
    },
    body: file.buffer,
  });

  if (!response.ok) {
    throw new Error(`Supabase Storage upload failed: ${response.status} ${await response.text()}`);
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${key}`;
  return {
    provider: 'supabase',
    bucket,
    key,
    url: publicUrl,
    path: key,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);
}

function sha256(value, encoding = 'hex') {
  return crypto.createHash('sha256').update(value).digest(encoding);
}

function s3SigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

async function saveS3Object({ bucket, userId, file }) {
  const endpoint = (process.env.S3_ENDPOINT || '').replace(/\/$/, '');
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKey = process.env.S3_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY;
  const actualBucket = process.env.S3_BUCKET || bucket;
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error('S3_ENDPOINT, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required for S3 storage.');
  }

  const key = process.env.S3_BUCKET ? makeObjectKey({ bucket, userId, file }) : makeObjectKey({ bucket: '', userId, file }).replace(/^file\//, '');
  const payloadHash = sha256(file.buffer);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const url = new URL(`${endpoint}/${actualBucket}/${key.split('/').map(encodeURIComponent).join('/')}`);
  const host = url.host;
  const canonicalUri = url.pathname;
  const canonicalHeaders = `content-type:${file.mimetype}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');
  const signature = hmac(s3SigningKey(secretKey, dateStamp, region, 's3'), stringToSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': file.mimetype,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: file.buffer,
  });

  if (!response.ok) {
    throw new Error(`S3 upload failed: ${response.status} ${await response.text()}`);
  }

  const publicBase = (process.env.S3_PUBLIC_URL || `${endpoint}/${actualBucket}`).replace(/\/$/, '');
  return {
    provider: 's3',
    bucket: actualBucket,
    key,
    url: `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`,
    path: key,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
}

async function saveObject({ bucket, userId, file }) {
  const provider = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();

  if (provider === 'local') {
    return saveLocalObject({ bucket, userId, file });
  }

  if (provider === 'supabase') {
    return saveSupabaseObject({ bucket, userId, file });
  }

  if (provider === 's3') {
    return saveS3Object({ bucket, userId, file });
  }

  throw new Error(`Unsupported STORAGE_PROVIDER "${provider}"`);
}

module.exports = {
  saveObject,
};
