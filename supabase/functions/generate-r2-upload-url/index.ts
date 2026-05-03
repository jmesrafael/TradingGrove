// supabase/functions/generate-r2-upload-url/index.ts
// Deploy: supabase functions deploy generate-r2-upload-url

import { S3Client, PutObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.654.0";
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3.654.0";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface UploadRequest {
  file_name: string;
  file_type: string;
  trade_id: string;
}

interface UploadResponse {
  upload_url: string;
  public_url: string;
  key: string;
}

interface ErrorResponse {
  error: string;
  code?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_FILE_TYPES = ["png", "jpg", "jpeg", "webp"];
const SIGNED_URL_EXPIRY = 300; // 5 minutes
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB (for server awareness)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function ok(data: UploadResponse | Record<string, unknown>) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: CORS_HEADERS,
  });
}

function fail(msg: string, status = 400, code?: string): Response {
  console.error(`[ERROR ${status}] ${code || "unknown"}:`, msg);
  const error: ErrorResponse = { error: msg };
  if (code) error.code = code;
  return new Response(JSON.stringify(error), {
    status,
    headers: CORS_HEADERS,
  });
}

/**
 * Decode base64 URL-safe string
 */
function base64urlDecode(str: string): string {
  // Add padding if needed
  let padded = str;
  const padding = 4 - (str.length % 4);
  if (padding && padding !== 4) {
    padded = str + "=".repeat(padding);
  }

  // Replace URL-safe chars with standard base64
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");

  // Decode using atob
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.error("[decode] Error decoding base64:", e);
    throw e;
  }
}

/**
 * Extract user ID from Supabase JWT token
 * Token is already validated by Supabase, so we just extract the user ID
 */
function extractUserIdFromToken(token: string): string {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format - expected 3 parts");
    }

    // Decode the payload (second part)
    const payloadStr = base64urlDecode(parts[1]);
    console.log("[token] Payload string:", payloadStr.substring(0, 100) + "...");

    const payload = JSON.parse(payloadStr);
    const userId = payload.sub;

    if (!userId) {
      throw new Error("No 'sub' (user ID) field in token payload");
    }

    console.log(`[token] ✅ Extracted user ID: ${userId}`);
    return userId;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[token] ❌ Failed to extract user ID: ${errorMsg}`);
    throw new Error(`Failed to extract user ID from token: ${errorMsg}`);
  }
}

/**
 * Validate and extract file extension
 * Only allows specific MIME types / extensions
 */
function validateFileType(fileType: string): string {
  // Normalize: "image/png" → "png", "application/octet-stream" → invalid
  const normalized = fileType.toLowerCase().split("/").pop() || "";

  if (!ALLOWED_FILE_TYPES.includes(normalized)) {
    throw new Error(
      `Invalid file type: ${fileType}. Allowed: ${ALLOWED_FILE_TYPES.join(", ")}`
    );
  }

  return normalized;
}

/**
 * Sanitize filename to prevent path injection attacks
 * - Remove directory traversal patterns (.., /)
 * - Remove special characters
 * - Limit length
 */
function sanitizeFileName(fileName: string): string {
  // Remove path separators and traversal patterns
  const cleaned = fileName
    .replace(/\.\./g, "") // Remove ..
    .replace(/[\/\\]/g, "") // Remove / and \
    .replace(/[^a-zA-Z0-9._-]/g, "_") // Only allow safe chars
    .slice(0, 200); // Limit length

  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("Invalid filename after sanitization");
  }

  return cleaned;
}

/**
 * Validate trade_id is a valid UUID format
 */
function validateTradeId(tradeId: string): void {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(tradeId)) {
    throw new Error("Invalid trade_id format: must be a valid UUID");
  }
}

/**
 * Generate secure S3 object key
 * Pattern: trades/{user_id}/{trade_id}/{timestamp}-{random}.{ext}
 *
 * This ensures:
 * - User isolation: trades/{user_id}/ namespace
 * - Trade isolation: /trade_id/ subdirectory
 * - Uniqueness: timestamp + random bytes prevent collisions
 * - No path injection: randomness prevents guessing
 */
function generateObjectKey(
  userId: string,
  tradeId: string,
  fileName: string,
  ext: string
): string {
  const timestamp = Date.now();

  // Generate 8 random bytes (16 hex chars) for collision prevention
  const randomBytes = crypto.getRandomValues(new Uint8Array(8));
  const randomHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const sanitized = sanitizeFileName(fileName.replace(`.${ext}`, ""));

  // Final key: trades/user_id/trade_id/timestamp-random-filename.ext
  const objectKey = `trades/${userId}/${tradeId}/${timestamp}-${randomHex}-${sanitized}.${ext}`;

  return objectKey;
}

/**
 * Generate signed PUT URL using AWS SDK v3
 * - Expires in 300 seconds (5 minutes)
 * - Restricted to specific object key
 * - S3-compatible with Cloudflare R2
 */
async function generateSignedUrl(
  objectKey: string,
  fileType: string
): Promise<string> {
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  const endpoint = Deno.env.get("R2_ENDPOINT");

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    throw new Error("R2 environment variables not configured");
  }

  const s3Client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: fileType,
  });

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: SIGNED_URL_EXPIRY,
  });

  return signedUrl;
}

/**
 * Generate public URL for metadata storage
 * Uses R2_PUBLIC_URL env var if available, falls back to account-based URL
 * Format: https://{public_url}/{key} or https://{account_id}.r2.cloudflarestorage.com/{key}
 */
function generatePublicUrl(objectKey: string): string {
  // Try custom public URL first (for custom domains)
  const publicBase = Deno.env.get("R2_PUBLIC_URL");
  if (publicBase) {
    return `${publicBase.replace(/\/$/, "")}/${objectKey}`;
  }

  // Fallback to account-based URL
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  if (!accountId) {
    throw new Error("R2_PUBLIC_URL or R2_ACCOUNT_ID not configured");
  }

  return `https://${accountId}.r2.cloudflarestorage.com/${objectKey}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return fail("Method not allowed", 405, "METHOD_NOT_ALLOWED");
  }

  try {
    console.log("[generate-r2-upload-url] Request started");

    // ─────────────────────────────────────────────────────────────────
    // 1. AUTHENTICATE USER (Simple approach)
    // ─────────────────────────────────────────────────────────────────

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      console.error("[generate-r2-upload-url] No auth header");
      return fail("Missing or invalid Authorization header", 401, "UNAUTHORIZED");
    }

    const token = authHeader.slice(7).trim();
    let userId: string;

    try {
      console.log("[generate-r2-upload-url] Extracting user ID from token...");
      userId = extractUserIdFromToken(token);
      console.log(`[generate-r2-upload-url] ✅ User ID extracted: ${userId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[generate-r2-upload-url] ❌ Token extraction error: ${errorMsg}`);
      return fail(
        `Token extraction failed: ${errorMsg}`,
        401,
        "TOKEN_EXTRACTION_FAILED"
      );
    }

    // ─────────────────────────────────────────────────────────────────
    // 2. PARSE & VALIDATE REQUEST BODY
    // ─────────────────────────────────────────────────────────────────

    let body: UploadRequest;
    try {
      body = await req.json();
    } catch {
      return fail("Request body must be valid JSON", 400, "INVALID_JSON");
    }

    const { file_name, file_type, trade_id } = body;

    // Validate required fields
    if (!file_name || typeof file_name !== "string") {
      return fail(
        "Missing or invalid file_name: must be a non-empty string",
        400,
        "INVALID_FILE_NAME"
      );
    }

    if (!file_type || typeof file_type !== "string") {
      return fail(
        "Missing or invalid file_type: must be a non-empty string",
        400,
        "INVALID_FILE_TYPE"
      );
    }

    if (!trade_id || typeof trade_id !== "string") {
      return fail(
        "Missing or invalid trade_id: must be a non-empty string",
        400,
        "INVALID_TRADE_ID"
      );
    }

    console.log(
      `[generate-r2-upload-url] Request: file=${file_name}, type=${file_type}, trade=${trade_id}`
    );

    // ─────────────────────────────────────────────────────────────────
    // 3. VALIDATE FILE TYPE
    // ─────────────────────────────────────────────────────────────────

    let ext: string;
    try {
      ext = validateFileType(file_type);
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Invalid file type",
        400,
        "UNSUPPORTED_FILE_TYPE"
      );
    }

    // ─────────────────────────────────────────────────────────────────
    // 4. VALIDATE TRADE ID
    // ─────────────────────────────────────────────────────────────────

    try {
      validateTradeId(trade_id);
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Invalid trade_id",
        400,
        "INVALID_TRADE_ID"
      );
    }

    // ─────────────────────────────────────────────────────────────────
    // 5. GENERATE SECURE OBJECT KEY
    // ─────────────────────────────────────────────────────────────────

    let objectKey: string;
    try {
      objectKey = generateObjectKey(userId, trade_id, file_name, ext);
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Failed to generate object key",
        400,
        "KEY_GENERATION_FAILED"
      );
    }

    console.log(`[generate-r2-upload-url] Generated key: ${objectKey}`);

    // ─────────────────────────────────────────────────────────────────
    // 6. GENERATE SIGNED URL
    // ─────────────────────────────────────────────────────────────────

    let uploadUrl: string;
    try {
      uploadUrl = await generateSignedUrl(objectKey, file_type);
    } catch (error) {
      console.error(
        "[generate-r2-upload-url] Signed URL generation failed:",
        error
      );
      return fail(
        "Failed to generate upload URL",
        500,
        "SIGNED_URL_FAILED"
      );
    }

    // ─────────────────────────────────────────────────────────────────
    // 7. GENERATE PUBLIC URL
    // ─────────────────────────────────────────────────────────────────

    let publicUrl: string;
    try {
      publicUrl = generatePublicUrl(objectKey);
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Failed to generate public URL",
        500,
        "PUBLIC_URL_FAILED"
      );
    }

    // ─────────────────────────────────────────────────────────────────
    // 8. RETURN RESPONSE
    // ─────────────────────────────────────────────────────────────────

    const response: UploadResponse = {
      upload_url: uploadUrl,
      public_url: publicUrl,
      key: objectKey,
    };

    console.log("[generate-r2-upload-url] Success");
    return ok(response);

  } catch (error) {
    console.error(
      "[generate-r2-upload-url] Unhandled exception:",
      error instanceof Error ? error.message : String(error)
    );
    return fail("Internal server error", 500, "INTERNAL_ERROR");
  }
});
