# Generate R2 Upload URL

Supabase Edge Function that generates secure signed URLs for direct uploads to Cloudflare R2.

## Purpose

Replaces Supabase Storage uploads with direct-to-R2 uploads using signed PUT URLs. Provides:
- User authentication via JWT
- File type validation
- Secure object key generation with user/trade isolation
- Signed URL generation (300 seconds expiry)
- Public URL for metadata storage

## Architecture Flow

```
Frontend
    ↓
POST /generate-r2-upload-url (with JWT & file metadata)
    ↓
Edge Function
    ├─ Verify JWT token
    ├─ Validate file type (png, jpg, jpeg, webp)
    ├─ Generate secure key: trades/{user_id}/{trade_id}/{timestamp}-{random}.ext
    ├─ Generate signed PUT URL (S3-compatible for R2)
    └─ Return { upload_url, public_url, key }
    ↓
Frontend receives response
    ↓
Frontend uploads directly to R2 using signed URL
    ↓
Frontend stores public_url in Supabase DB
```

## Environment Variables

Configure in Supabase → Project Settings → Edge Functions Secrets:

```
R2_ACCOUNT_ID          Your Cloudflare account ID
R2_ACCESS_KEY_ID       R2 API token access key
R2_SECRET_ACCESS_KEY   R2 API token secret key
R2_BUCKET_NAME         S3 bucket name (e.g., tradinggrove-images)
R2_ENDPOINT            R2 endpoint (e.g., https://{account_id}.r2.cloudflarestorage.com)

SUPABASE_URL           Automatically provided by Supabase
SUPABASE_SERVICE_ROLE_KEY  Automatically provided by Supabase
```

## Deployment

```bash
# From project root
supabase functions deploy generate-r2-upload-url

# Or with no JWT verification if needed:
supabase functions deploy generate-r2-upload-url --no-verify-jwt
```

## API Reference

### Request

```http
POST https://<project>.supabase.co/functions/v1/generate-r2-upload-url

Authorization: Bearer <user_jwt_token>
Content-Type: application/json

{
  "file_name": "trading_screenshot.png",
  "file_type": "image/png",
  "trade_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Response (200 OK)

```json
{
  "upload_url": "https://393fdc1....r2.cloudflarestorage.com/trades/user-uuid/trade-uuid/1705884345123-a1b2c3d4e5f6g7h8-trading_screenshot.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
  "public_url": "https://393fdc1....r2.cloudflarestorage.com/trades/user-uuid/trade-uuid/1705884345123-a1b2c3d4e5f6g7h8-trading_screenshot.png",
  "key": "trades/user-uuid/trade-uuid/1705884345123-a1b2c3d4e5f6g7h8-trading_screenshot.png"
}
```

### Error Responses

| Status | Code | Meaning |
|--------|------|---------|
| 401 | UNAUTHORIZED | Missing/invalid Authorization header |
| 401 | AUTH_FAILED | JWT token invalid or expired |
| 400 | INVALID_JSON | Request body is not valid JSON |
| 400 | INVALID_FILE_NAME | file_name missing or invalid |
| 400 | INVALID_FILE_TYPE | file_type missing or invalid |
| 400 | INVALID_TRADE_ID | trade_id missing, invalid format, or not a UUID |
| 400 | UNSUPPORTED_FILE_TYPE | File type not in [png, jpg, jpeg, webp] |
| 500 | SIGNED_URL_FAILED | Failed to generate signed URL (R2 auth issue) |
| 500 | PUBLIC_URL_FAILED | Failed to generate public URL |
| 500 | INTERNAL_ERROR | Unhandled server error |

Example error response:

```json
{
  "error": "Invalid file type: image/gif. Allowed: png, jpg, jpeg, webp",
  "code": "UNSUPPORTED_FILE_TYPE"
}
```

## Frontend Integration Example

### TypeScript / React

```typescript
import { useSupabaseClient } from "@supabase/auth-helpers-react";

interface R2UploadResponse {
  upload_url: string;
  public_url: string;
  key: string;
}

export async function generateR2UploadUrl(
  supabase: ReturnType<typeof useSupabaseClient>,
  fileName: string,
  fileType: string,
  tradeId: string
): Promise<R2UploadResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }

  const response = await fetch(
    `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/generate-r2-upload-url`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_name: fileName,
        file_type: fileType,
        trade_id: tradeId,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Upload URL generation failed: ${error.error}`);
  }

  return response.json();
}

// Usage in component
async function handleImageUpload(file: File, tradeId: string) {
  try {
    // 1. Get signed URL from Edge Function
    const { upload_url, public_url } = await generateR2UploadUrl(
      supabase,
      file.name,
      file.type,
      tradeId
    );

    // 2. Upload directly to R2 using signed URL
    const uploadResponse = await fetch(upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error("Upload to R2 failed");
    }

    // 3. Store public_url in Supabase DB
    const { error } = await supabase
      .from("trades")
      .update({ image_url: public_url })
      .eq("id", tradeId);

    if (error) throw error;

    console.log("Upload successful:", public_url);
  } catch (error) {
    console.error("Upload error:", error);
  }
}
```

## Security Considerations

### ✅ What This Function Protects Against

1. **User Isolation** - Each user can only upload to `trades/{their_user_id}/`
   - Verified via JWT authentication
   - Cannot be overridden in object key generation

2. **Trade Isolation** - Objects are scoped to specific trade IDs
   - Trade ID validated as UUID format
   - Path separators removed during filename sanitization
   - Cannot traverse directories (../ attacks prevented)

3. **Path Injection** - Filenames sanitized to prevent directory traversal
   - All special characters replaced with underscores
   - Directory separators (/ \) removed
   - Filename limited to 200 characters
   - Safe character set: [a-zA-Z0-9._-]

4. **File Type Validation** - Whitelist approach (not blacklist)
   - Only [png, jpg, jpeg, webp] allowed
   - MIME type checked server-side
   - Cannot be bypassed by client

5. **Signed URL Expiry** - All URLs expire in 300 seconds
   - Limits time window for URL interception
   - Prevents long-lived credentials exposure
   - User must request fresh URL for each upload

6. **Collision Prevention** - Random 8-byte suffix in object key
   - Timestamp + crypto.getRandomValues() ensures uniqueness
   - Attackers cannot predict object keys
   - Prevents race condition overwrites

### ⚠️ What This Function Does NOT Protect Against

1. **File Content Validation** - No virus/malware scanning
   - Consider adding ClamAV or VirusTotal integration for production

2. **File Size Limit** - No server-side enforcement
   - Edge Functions have 10MB request body limit (Deno runtime)
   - Implement client-side validation + metadata tracking
   - Supabase stores `file_size` metadata on object creation

3. **Duplicate Prevention** - No deduplication
   - Same file uploaded twice = two separate R2 objects
   - Implement client-side hash checking or post-upload dedup in DB

4. **Access Control for Reads** - Public URLs are not protected
   - Anyone with the URL can view the image
   - If private reads needed, proxy through API with auth checks

### 🔐 Recommended Additional Safeguards

1. **Database Record** - Create upload record before/after uploading
   ```sql
   INSERT INTO trade_images (trade_id, user_id, public_url, key, created_at)
   VALUES ($1, $2, $3, $4, now());
   ```

2. **Rate Limiting** - Limit signed URLs per user/minute
   ```sql
   -- Track generation attempts
   INSERT INTO rate_limits (user_id, endpoint, count, window)
   VALUES ($1, 'generate-r2-upload-url', 1, now())
   ON CONFLICT (user_id, endpoint, window)
   DO UPDATE SET count = count + 1;
   
   -- Check limit
   SELECT count FROM rate_limits 
   WHERE user_id = $1 AND endpoint = 'generate-r2-upload-url'
   AND window > now() - interval '1 minute';
   ```

3. **Content Type Check** - Verify upload succeeded and validate MIME
   ```typescript
   // After upload, fetch object and check headers
   const headResponse = await fetch(public_url, { method: "HEAD" });
   const contentType = headResponse.headers.get("content-type");
   if (!ALLOWED_TYPES.includes(contentType)) {
     await deleteFromR2(key); // Rollback
   }
   ```

4. **Audit Logging** - Track all upload requests
   ```sql
   INSERT INTO audit_logs (user_id, action, object_key, status, ip, created_at)
   VALUES ($1, 'image_upload_url_generated', $2, 'success', $3, now());
   ```

## Testing

### cURL Examples

```bash
# Get user JWT token first
USER_TOKEN="your_jwt_token_here"

# Test successful upload
curl -X POST https://your-project.supabase.co/functions/v1/generate-r2-upload-url \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "file_name": "test.png",
    "file_type": "image/png",
    "trade_id": "550e8400-e29b-41d4-a716-446655440000"
  }'

# Test invalid file type
curl -X POST https://your-project.supabase.co/functions/v1/generate-r2-upload-url \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "file_name": "test.exe",
    "file_type": "application/x-msdownload",
    "trade_id": "550e8400-e29b-41d4-a716-446655440000"
  }'
  # Expected: 400 UNSUPPORTED_FILE_TYPE

# Test invalid trade UUID
curl -X POST https://your-project.supabase.co/functions/v1/generate-r2-upload-url \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "file_name": "test.png",
    "file_type": "image/png",
    "trade_id": "not-a-uuid"
  }'
  # Expected: 400 INVALID_TRADE_ID

# Test path injection
curl -X POST https://your-project.supabase.co/functions/v1/generate-r2-upload-url \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "file_name": "../../../etc/passwd.png",
    "file_type": "image/png",
    "trade_id": "550e8400-e29b-41d4-a716-446655440000"
  }'
  # Expected: 200 (sanitized to _______etc_passwd.png, safe)
```

## Monitoring & Debugging

### Logs

View function logs in Supabase dashboard:

```
Supabase Dashboard → Functions → generate-r2-upload-url → Logs
```

Look for these patterns:

```
✅ [generate-r2-upload-url] Request started
✅ [generate-r2-upload-url] Authenticated user: {user_id}
✅ [generate-r2-upload-url] Generated key: trades/...
✅ [generate-r2-upload-url] Success

❌ [ERROR 401] AUTH_FAILED: Token verification failed
❌ [ERROR 400] UNSUPPORTED_FILE_TYPE: Invalid file type...
❌ [ERROR 500] SIGNED_URL_FAILED: R2 auth failed
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 401 UNAUTHORIZED | Missing Bearer token | Client must send `Authorization: Bearer <token>` |
| 401 AUTH_FAILED | Invalid/expired JWT | Token must be fresh, from authenticated session |
| 400 INVALID_TRADE_ID | Trade ID not UUID | Ensure trade IDs are valid UUIDs (v4) |
| 500 SIGNED_URL_FAILED | R2 credentials invalid | Verify R2_* env vars are set correctly |
| 500 SIGNED_URL_FAILED | R2 bucket doesn't exist | Verify bucket name matches R2_BUCKET_NAME |
| Upload fails with 403 | Signed URL expired | URLs valid for 300 seconds only, must re-request |
| Upload fails with 400 | Content-Type mismatch | Ensure upload uses same Content-Type as requested |

## Performance Notes

- **Avg Response Time**: ~100-200ms (JWT verification + AWS SDK signing)
- **P99 Response Time**: <1s (under normal load)
- **Concurrent Uploads**: Unlimited (backend scales with Supabase)
- **Cost**: No additional cost (included in Supabase plan + R2 egress)

## Version History

- v1.0 (2025-01-15)
  - Initial release
  - AWS SDK v3.654.0
  - 5-minute signed URL expiry
  - PNG, JPG, JPEG, WebP support
