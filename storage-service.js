const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCAL_UPLOAD_ROOT = path.join(__dirname, 'uploads');
const PUBLIC_BASE_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

function cleanEnv(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

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
  const provider = cleanEnv(process.env.STORAGE_PROVIDER || 's3').toLowerCase();
  const r2AccountId = cleanEnv(process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID);
  const r2Endpoint = r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '';
  const endpoint = cleanEnv(process.env.R2_ENDPOINT || process.env.S3_ENDPOINT || r2Endpoint || '').replace(/\/$/, '');
  const region = cleanEnv(process.env.R2_REGION || process.env.S3_REGION || 'auto');
  const accessKey = cleanEnv(process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID);
  const secretKey = cleanEnv(process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY);
  const actualBucket = cleanEnv(process.env.R2_BUCKET || process.env.S3_BUCKET || bucket);
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error(`${provider.toUpperCase()} storage is not configured. Set R2_ACCOUNT_ID/R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.`);
  }
  if (provider === 'r2') {
    validateR2Config({ r2AccountId, endpoint, accessKey, secretKey, bucket: actualBucket, publicUrl: process.env.R2_PUBLIC_URL || process.env.S3_PUBLIC_URL });
  }
  if (provider === 'r2' && !cleanEnv(process.env.R2_PUBLIC_URL || process.env.S3_PUBLIC_URL)) {
    throw new Error('R2_PUBLIC_URL is required so uploaded files can be opened from HireKe.');
  }

  const key = (process.env.R2_BUCKET || process.env.S3_BUCKET)
    ? makeObjectKey({ bucket, userId, file })
    : makeObjectKey({ bucket: '', userId, file }).replace(/^file\//, '');
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
    throw new Error(formatStorageError(provider, response.status, await response.text()));
  }

  const publicBase = cleanEnv(process.env.R2_PUBLIC_URL || process.env.S3_PUBLIC_URL || `${endpoint}/${actualBucket}`).replace(/\/$/, '');
  return {
    provider,
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
  const provider = cleanEnv(process.env.STORAGE_PROVIDER || 'local').toLowerCase();

  if (provider === 'local') {
    return saveLocalObject({ bucket, userId, file });
  }

  if (provider === 'supabase') {
    return saveSupabaseObject({ bucket, userId, file });
  }

  if (provider === 's3' || provider === 'r2') {
    return saveS3Object({ bucket, userId, file });
  }

  throw new Error(`Unsupported STORAGE_PROVIDER "${provider}"`);
}

async function deleteLocalObject(stored) {
  const key = String(stored.object_key || stored.key || '').replace(/^\/+/, '');
  if (!key) return false;
  const absolutePath = path.resolve(LOCAL_UPLOAD_ROOT, key);
  const root = path.resolve(LOCAL_UPLOAD_ROOT);
  if (!absolutePath.startsWith(root + path.sep)) return false;
  await fs.promises.rm(absolutePath, { force: true });
  return true;
}

async function deleteS3Object(stored) {
  const provider = cleanEnv(process.env.STORAGE_PROVIDER || stored.provider || 's3').toLowerCase();
  const r2AccountId = cleanEnv(process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID);
  const r2Endpoint = r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '';
  const endpoint = cleanEnv(process.env.R2_ENDPOINT || process.env.S3_ENDPOINT || r2Endpoint || '').replace(/\/$/, '');
  const region = cleanEnv(process.env.R2_REGION || process.env.S3_REGION || 'auto');
  const accessKey = cleanEnv(process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID);
  const secretKey = cleanEnv(process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY);
  const actualBucket = cleanEnv(stored.bucket || process.env.R2_BUCKET || process.env.S3_BUCKET);
  const key = stored.object_key || stored.key;
  if (!endpoint || !accessKey || !secretKey || !actualBucket || !key) return false;
  if (provider === 'r2') {
    validateR2Config({ r2AccountId, endpoint, accessKey, secretKey, bucket: actualBucket, publicUrl: process.env.R2_PUBLIC_URL || process.env.S3_PUBLIC_URL });
  }

  const payloadHash = sha256('');
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const url = new URL(`${endpoint}/${actualBucket}/${String(key).split('/').map(encodeURIComponent).join('/')}`);
  const host = url.host;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['DELETE', url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');
  const signature = hmac(s3SigningKey(secretKey, dateStamp, region, 's3'), stringToSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(formatStorageError(provider, response.status, await response.text(), 'delete'));
  }
  return true;
}

async function deleteSupabaseObject(stored) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const bucket = stored.bucket;
  const key = stored.object_key || stored.key;
  if (!supabaseUrl || !serviceKey || !bucket || !key) return false;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: [key] }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Supabase Storage delete failed: ${response.status} ${await response.text()}`);
  }
  return true;
}

async function deleteObject(stored) {
  if (!stored) return false;
  const provider = String(stored.provider || process.env.STORAGE_PROVIDER || 'local').toLowerCase();
  if (provider === 'local') return deleteLocalObject(stored);
  if (provider === 'supabase') return deleteSupabaseObject(stored);
  if (provider === 's3' || provider === 'r2') return deleteS3Object(stored);
  return false;
}

function validateR2Config({ r2AccountId, endpoint, accessKey, secretKey, bucket, publicUrl }) {
  const errors = [];
  if (!r2AccountId && !endpoint) errors.push('R2_ACCOUNT_ID or R2_ENDPOINT is required.');
  if (!bucket) errors.push('R2_BUCKET is required.');
  if (!cleanEnv(publicUrl)) errors.push('R2_PUBLIC_URL is required.');
  if (!accessKey) errors.push('R2_ACCESS_KEY_ID is required.');
  if (!secretKey) errors.push('R2_SECRET_ACCESS_KEY is required.');
  if (accessKey && accessKey.length !== 32) {
    errors.push(`R2_ACCESS_KEY_ID looks invalid (${accessKey.length} characters). Use the 32-character Access Key ID from a Cloudflare R2 API token, not the API token value.`);
  }
  if (secretKey && secretKey.length < 40) {
    errors.push('R2_SECRET_ACCESS_KEY looks too short. Use the Secret Access Key shown when creating the Cloudflare R2 API token.');
  }
  if (errors.length) throw new Error(`Cloudflare R2 storage is misconfigured: ${errors.join(' ')}`);
  return true;
}

function storageStatus() {
  const provider = cleanEnv(process.env.STORAGE_PROVIDER || 'local').toLowerCase();
  if (provider === 'local') return { provider, configured: true, errors: [] };
  if (provider === 'r2') {
    try {
      const r2AccountId = cleanEnv(process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID);
      const r2Endpoint = r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '';
      validateR2Config({
        r2AccountId,
        endpoint: cleanEnv(process.env.R2_ENDPOINT || r2Endpoint),
        accessKey: cleanEnv(process.env.R2_ACCESS_KEY_ID),
        secretKey: cleanEnv(process.env.R2_SECRET_ACCESS_KEY),
        bucket: cleanEnv(process.env.R2_BUCKET),
        publicUrl: cleanEnv(process.env.R2_PUBLIC_URL),
      });
      return { provider, configured: true, errors: [] };
    } catch (error) {
      return { provider, configured: false, errors: [error.message] };
    }
  }
  if (provider === 's3') {
    const required = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'S3_PUBLIC_URL'];
    const missing = required.filter((name) => !cleanEnv(process.env[name]));
    return { provider, configured: missing.length === 0, errors: missing.map((name) => `${name} is required.`) };
  }
  if (provider === 'supabase') {
    const configured = Boolean(cleanEnv(process.env.SUPABASE_URL) && cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
    return { provider, configured, errors: configured ? [] : ['SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'] };
  }
  return { provider, configured: false, errors: [`Unsupported STORAGE_PROVIDER "${provider}"`] };
}

function assertStorageReady() {
  const status = storageStatus();
  if (!status.configured) {
    throw new Error(status.errors[0] || `${status.provider} storage is not configured.`);
  }
  return status;
}

function formatStorageError(provider, status, body, action = 'upload') {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  const invalidAccessKey = /Credential access key has length\s+(\d+),\s+should be\s+32/i.exec(text);
  if (provider === 'r2' && invalidAccessKey) {
    return `Cloudflare R2 ${action} failed because R2_ACCESS_KEY_ID is invalid (${invalidAccessKey[1]} characters). Replace it with the 32-character Access Key ID from Cloudflare R2 > Manage R2 API tokens.`;
  }
  return `${provider.toUpperCase()} ${action} failed: ${status}${text ? ` ${text}` : ''}`;
}

module.exports = {
  saveObject,
  deleteObject,
  storageStatus,
  assertStorageReady,
  validateR2Config,
};
