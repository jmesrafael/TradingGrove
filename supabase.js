// supabase.js — OPTIMIZED
// Handles auth state changes, referral application, helper functions.
// Include this on every page that needs auth.

// ── Config ────────────────────────────────────────────────
const SUPABASE_URL  = "https://oixrpuqylidbunbttftg.supabase.co";
const SUPABASE_ANON = "sb_publishable_0JIYopUpUp6DonOkOzWcJQ_KL0OyIho";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);


// ══════════════════════════════════════════════════════════
//  SESSION STORAGE CACHE
//  Eliminates redundant DB round-trips for stable data
//  across page navigations within a browser session.
// ══════════════════════════════════════════════════════════

function _cacheSet(key, val, ttlMs = 30000) {
  try {
    const cached = { val, exp: Date.now() + ttlMs };
    sessionStorage.setItem('_tz_cache_' + key, JSON.stringify(cached));
  } catch (e) {
    console.warn('[cache] sessionStorage setItem failed:', e);
  }
}

function _cacheGet(key) {
  try {
    const item = sessionStorage.getItem('_tz_cache_' + key);
    if (!item) return null;
    const c = JSON.parse(item);
    if (Date.now() > c.exp) {
      sessionStorage.removeItem('_tz_cache_' + key);
      return null;
    }
    return c.val;
  } catch (e) {
    console.warn('[cache] sessionStorage getItem failed:', e);
    return null;
  }
}

function _cacheInvalidate(prefix) {
  try {
    const fullPrefix = '_tz_cache_' + prefix;
    const keysToDelete = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k.startsWith(fullPrefix)) keysToDelete.push(k);
    }
    keysToDelete.forEach(k => sessionStorage.removeItem(k));
  } catch (e) {
    console.warn('[cache] sessionStorage invalidate failed:', e);
  }
}


// ── Auth helpers ──────────────────────────────────────────

async function getUser() {
  const { data: { user } } = await db.auth.getUser();
  return user;
}

async function requireAuth() {
  const user = await getUser();
  if (!user) {
    window.location.href = '/auth';
    return null;
  }
  return user;
}


// ── Profile helpers ───────────────────────────────────────

async function getProfile(userId) {
  const cacheKey = 'profile:' + userId;
  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) console.error('[supabase] getProfile error:', error);

  // Auto-create profile if missing (edge case: email confirmation race)
  if (!data && !error) {
    console.warn('[supabase] Profile missing — creating fallback profile for', userId);
    const { data: newProfile } = await db
      .from('profiles')
      .upsert({ id: userId, plan: 'free' }, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    _cacheSet(cacheKey, newProfile, 60000);
    return newProfile;
  }

  _cacheSet(cacheKey, data, 60000);
  return data;
}

async function updateProfile(userId, updates) {
  const { data, error } = await db
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  _cacheInvalidate('profile:' + userId); // bust cache so next read is fresh
  return data;
}


// ── Journal helpers ───────────────────────────────────────

async function getJournals(userId) {
  const { data, error } = await db
    .from('journals')
    .select('*')
    .eq('user_id', userId)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) console.error('[supabase] getJournals error:', error);
  return data || [];
}

async function createJournal(userId, { name, capital, pin_hash }) {
  const { data, error } = await db
    .from('journals')
    .insert({ user_id: userId, name, capital, pin_hash })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// Explicit column list — `select('*')` was the dominant Supabase egress
// source because every realtime tick pulled `notes` (long text) + housekeeping
// columns the UI never reads. Keep this in sync with `dbToTrade` below.
const TRADES_COLUMNS = 'id, trade_date, trade_time, pair, position, strategy, timeframe, pnl, r_factor, confidence, mood, notes, pinned, created_at';

async function getTrades(journalId) {
  const { data, error } = await db
    .from('trades')
    .select(TRADES_COLUMNS)
    .eq('journal_id', journalId)
    .order('created_at', { ascending: false });
  if (error) console.error('[supabase] getTrades error:', error);
  return data || [];
}

// Lightweight variant for views that only need PnL/date (calendar, dashboard
// totals). Skips `notes`, `mood`, `strategy`, `timeframe`, `pair`, etc.
const TRADES_LIGHT_COLUMNS = 'id, trade_date, pnl, r_factor';

async function getTradesLight(journalId) {
  const { data, error } = await db
    .from('trades')
    .select(TRADES_LIGHT_COLUMNS)
    .eq('journal_id', journalId)
    .order('created_at', { ascending: false });
  if (error) console.error('[supabase] getTradesLight error:', error);
  return data || [];
}

async function getJournal(journalId) {
  const { data, error } = await db
    .from('journals')
    .select('*')
    .eq('id', journalId)
    .maybeSingle();
  if (error) console.error('[supabase] getJournal error:', error);
  return data;
}

async function updateJournalPositions(orderedIds) {
  // Fire all position updates in parallel instead of sequentially
  await Promise.all(
    orderedIds.map((id, index) =>
      db.from('journals').update({ position: index }).eq('id', id)
    )
  );
}


// ── Referral helpers ──────────────────────────────────────

async function getReferrals(userId) {
  const { data, error } = await db
    .from('referrals')
    .select(`
      *,
      referred_profile:profiles!referrals_referred_user_id_fkey (
        name
      )
    `)
    .eq('referrer_id', userId)
    .order('created_at', { ascending: false });
  if (error) console.error('[supabase] getReferrals error:', error);
  return data || [];
}

function buildReferralUrl(code) {
  if (!code || code === '—') return window.location.origin + '/auth?ref=???';
  return `${window.location.origin}/auth?ref=${code}`;
}

async function getReferralCount(userId) {
  const refs = await getReferrals(userId);
  return refs.length;
}


// ── Subscription helpers ──────────────────────────────────

function getSubscriptionStatus(profile) {
  const isPro = profile?.plan === 'pro';

  if (!isPro) return {
    isPro: false, expired: false, expiring: false,
    daysLeft: null, label: 'Free', planType: 'none'
  };

  const planType = profile?.plan_type || 'none';

  // Only grant lifetime when explicitly set — never infer it from a missing expiry
  if (planType === 'lifetime') {
    return {
      isPro: true, expired: false, expiring: false,
      daysLeft: null, label: 'Lifetime', planType: 'lifetime'
    };
  }

  const expiresAt = profile?.subscription_expires_at || profile?.pro_expires_at;

  // plan=pro with no expiry date is an invalid/unsynced state — treat as expired
  if (!expiresAt) {
    return {
      isPro: false, expired: true, expiring: false,
      daysLeft: null, label: 'Expired', planType
    };
  }

  const now      = new Date();
  const expires  = new Date(expiresAt);
  const msLeft   = expires - now;
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  const expired  = daysLeft <= 0;
  const expiring = !expired && daysLeft <= 7;

  let label;
  if (expired) {
    label = `Expired ${expires.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } else if (expiring) {
    label = `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  } else {
    label = `Renews ${expires.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  // isPro is false when expired — feature gates check isPro, not the expired flag
  return { isPro: !expired, expired, expiring, daysLeft, label, planType };
}


// ── Theme / font helpers ──────────────────────────────────

function applyProfileTheme(profile) {
  const theme = profile?.color_theme || localStorage.getItem('tl_theme') || 'dark';
  const font  = profile?.font_theme  || localStorage.getItem('tl_font')  || 'default';
  if (window.TZ) {
    TZ.setTheme(theme);
    TZ.setFont(font);
  }
}


// ── Page loader helper ────────────────────────────────────

function hidePageLoader() {
  const el = document.getElementById('pageLoader');
  if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }
}


// ══════════════════════════════════════════════════════════
//  AUTH STATE CHANGE LISTENER
// ══════════════════════════════════════════════════════════

db.auth.onAuthStateChange(async (event, session) => {
  if (event !== 'SIGNED_IN' || !session?.user) return;

  // ── Apply referral code if one is stored ─────────────────
  const refCode = (localStorage.getItem('ref_code') || '').trim().toUpperCase();
  if (refCode) {
    console.log('[supabase] Applying referral code:', refCode);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/apply-referral`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ referral_code: refCode }),
      });

      const result = await res.json();
      console.log('[supabase] apply-referral result:', result);

      if (result.success || result.skipped) {
        localStorage.removeItem('ref_code');
        sessionStorage.removeItem('ref_code');
      } else {
        console.warn('[supabase] Referral not applied:', result.error);
      }
    } catch (e) {
      console.error('[supabase] Referral application failed:', e);
    }
  }
});

// ── TZ namespace fallback (if theme.js not loaded) ────────
if (!window.TZ) {
  window.TZ = {
    hideLoader: hidePageLoader,
    setTheme:   (id) => localStorage.setItem('tl_theme', id),
    setFont:    (id) => localStorage.setItem('tl_font',  id),
    themeList:  [],
    fontList:   [],
  };
}


// ── Journal settings helpers ──────────────────────────────

async function getJournalSettings(journalId) {
  const cacheKey = 'jsettings:' + journalId;
  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  const { data, error } = await db
    .from('journal_settings')
    .select('*')
    .eq('journal_id', journalId)
    .maybeSingle();
  if (error) console.error('[supabase] getJournalSettings error:', error);

  if (!data) {
    // Auto-create settings row if missing
const { data: newRow } = await db
      .from('journal_settings')
      .upsert({
        journal_id: journalId,
        user_id: (await db.auth.getUser()).data.user?.id,
        strategies: ['Scalp', 'Breakout', 'FVG'],
        timeframes:  ['1h', '4h', '1D'],
        pairs:       ['EURUSD', 'BTCUSDT', 'XAUUSD'],
        moods:       ['Confident', 'Neutral', 'Anxious'],
        mood_colors: {
          'Confident': '#19c37d',
          'Neutral':   '#8fa39a',
          'Anxious':   '#ff5f6d'
        }
      }, { onConflict: 'journal_id' })
      .select('*')
      .maybeSingle();
    const result = newRow || { strategies: [], timeframes: [], pairs: [], moods: [], mood_colors: {} };
    _cacheSet(cacheKey, result, 120000);
    return result;
  }

  _cacheSet(cacheKey, data, 120000);
  return data;
}

async function updateJournalSettings(journalId, updates) {
  const { error } = await db
    .from('journal_settings')
    .update(updates)
    .eq('journal_id', journalId);
  if (error) throw error;
  _cacheInvalidate('jsettings:' + journalId); // bust cache so panel reflects new tags
}

async function updateJournal(journalId, updates) {
  const { data, error } = await db
    .from('journals')
    .update(updates)
    .eq('id', journalId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}


// ── Trade helpers ─────────────────────────────────────────

// Maps a raw DB row → the shape logs.html expects
function dbToTrade(row) {
  return {
    id:         row.id,
    date:       row.trade_date   || '',
    time:       row.trade_time   || '',
    pair:       row.pair         || '',
    position:   row.position     || 'Long',
    strategy:   row.strategy     || [],
    timeframe:  row.timeframe    || [],
    pnl:        row.pnl          != null ? String(row.pnl) : '',
    r:          row.r_factor     != null ? String(row.r_factor) : '',
    confidence: row.confidence   || 0,
    mood:       row.mood         || [],
    notes:      row.notes        || '',
    images:     [],   // loaded separately via getTradeImages
  };
}

async function createTrade(userId, journalId, fields) {
  const { data, error } = await db
    .from('trades')
    .insert({
      user_id:    userId,
      journal_id: journalId,
      trade_date: fields.date   || null,
      trade_time: fields.time   || null,
      pair:       fields.pair   || null,
      position:   fields.position || 'Long',
      strategy:   fields.strategy  || [],
      timeframe:  fields.timeframe || [],
      pnl:        fields.pnl  !== '' && fields.pnl  != null ? parseFloat(fields.pnl)  : null,
      r_factor:   fields.r    !== '' && fields.r    != null ? parseFloat(fields.r)    : null,
      confidence: fields.confidence || null,
      mood:       fields.mood  || [],
      notes:      fields.notes || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateTrade(tradeId, fields) {
  const { error } = await db
    .from('trades')
    .update({
      trade_date: fields.date   || null,
      trade_time: fields.time   || null,
      pair:       fields.pair   || null,
      position:   fields.position || 'Long',
      strategy:   fields.strategy  || [],
      timeframe:  fields.timeframe || [],
      pnl:        fields.pnl  !== '' && fields.pnl  != null ? parseFloat(fields.pnl)  : null,
      r_factor:   fields.r    !== '' && fields.r    != null ? parseFloat(fields.r)    : null,
      confidence: fields.confidence || null,
      mood:       fields.mood  || [],
      notes:      fields.notes || null,
    })
    .eq('id', tradeId);
  if (error) throw error;
}

async function deleteTrade(tradeId) {
  // Fetch image metadata and delete storage + DB rows in parallel where possible
  const { data: imgs } = await db
    .from('trade_images')
    .select('id, storage_url')
    .eq('trade_id', tradeId);

  if (imgs?.length) {
    const paths = imgs.map(i => i.storage_url).filter(Boolean);
    // Run storage removal and DB row deletion in parallel
    await Promise.all([
      paths.length ? db.storage.from('trade-images').remove(paths) : Promise.resolve(),
      db.from('trade_images').delete().eq('trade_id', tradeId),
    ]);
  }

  const { error } = await db.from('trades').delete().eq('id', tradeId);
  if (error) throw error;
}


// ── Trade image helpers ───────────────────────────────────

async function addTradeImage(userId, tradeId, input) {
  try {
    console.log('%c🎬 IMAGE UPLOAD STARTED', 'color: #00ff88; font-weight: bold; font-size: 14px');

    function _dataUrlToBlob(dataUrl) {
      const [header, b64] = dataUrl.split(',');
      const mime = header.match(/:(.*?);/)[1];
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }

    console.log('[addTradeImage] 📦 Optimizing image for upload...');
    // input can be a Blob, File, or data URL string — compressImage handles all
    const compressed = await compressImage(input, {
      maxWidth: IMAGE_CONFIG.MAX_WIDTH,
      maxHeight: IMAGE_CONFIG.MAX_HEIGHT,
      targetKB: IMAGE_CONFIG.TARGET_SIZE_KB
    });

    // compressed is always a data URL string at this point
    const blob     = _dataUrlToBlob(compressed);
    const ext      = blob.type.includes('png') ? 'png' : 'jpg';
    const fileName = `trade_${Date.now()}.${ext}`;
    const sizeKB   = Math.round(blob.size / 1024);
    const sizeMB   = (blob.size / (1024 * 1024)).toFixed(2);

    console.log('[addTradeImage] ✅ Image optimized');
    console.log('[addTradeImage] File name:', fileName);
    console.log('[addTradeImage] File type:', blob.type);
    console.log('[addTradeImage] File size:', sizeKB, 'KB (' + sizeMB + 'MB)');

    if (blob.size > IMAGE_CONFIG.MAX_FILE_SIZE_BYTES) {
      throw new Error(`Image too large: ${sizeMB}MB (max 5MB)`);
    }

    console.log('[addTradeImage] %c🚀 ATTEMPTING R2 UPLOAD', 'color: #19c37d; font-weight: bold');
    const r2Result = await tryR2Upload(userId, tradeId, blob, fileName);
    if (r2Result.success) {
      console.log('%c✅ IMAGE SAVED TO R2', 'color: #19c37d; font-weight: bold; font-size: 14px');
      return r2Result.data;
    }

    console.warn('%c⚠️ R2 FAILED - FALLING BACK TO SUPABASE', 'color: #ff9500; font-weight: bold');
    console.log('[addTradeImage] R2 error:', r2Result.error);

    const supabaseResult = await uploadToSupabaseStorage(userId, tradeId, blob, fileName);
    console.log('%c✅ IMAGE SAVED TO SUPABASE (FALLBACK)', 'color: #ff9500; font-weight: bold; font-size: 14px');
    return supabaseResult;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('%c❌ IMAGE UPLOAD FAILED', 'color: #ff5f6d; font-weight: bold; font-size: 14px');
    console.error('[addTradeImage] Error:', errorMsg);
    throw error;
  }
}

async function tryR2Upload(userId, tradeId, blob, fileName) {
  try {
    console.log('[R2] ========== R2 UPLOAD START ==========');
    console.log('[R2] Authenticating user...');

    const { data: { user } } = await db.auth.getUser();
    if (!user?.id) throw new Error('User not authenticated');
    console.log('[R2] ✅ User authenticated:', user.id);

    const { data: sessionData } = await db.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      throw new Error('No auth token available');
    }
    console.log('[R2] ✅ Token retrieved, length:', token.length);

    console.log('[R2] 📤 Calling edge function...');
    console.log('[R2] Endpoint:', `${SUPABASE_URL}/functions/v1/generate-r2-upload-url`);

    const urlResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/generate-r2-upload-url`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          file_name: fileName,
          file_type: blob.type,
          trade_id: tradeId,
        }),
      }
    );

    console.log('[R2] Function response status:', urlResponse.status);

    if (!urlResponse.ok) {
      const responseText = await urlResponse.text();
      console.error('[R2] ❌ Edge function error:', responseText);
      return {
        success: false,
        error: `R2 function error (${urlResponse.status}): ${responseText}`
      };
    }

    const { upload_url: signedUrl, public_url: publicUrl } = await urlResponse.json();
    console.log('[R2] ✅ Got signed URL');
    console.log('[R2] Public URL:', publicUrl);

    console.log('[R2] 📤 Uploading blob to R2...');
    console.log('[R2] Blob size:', blob.size, 'bytes');

    const uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': blob.type,
      },
      body: blob,
    });

    console.log('[R2] Upload response status:', uploadResponse.status);

    if (!uploadResponse.ok) {
      console.error('[R2] ❌ Upload failed:', uploadResponse.statusText);
      return {
        success: false,
        error: `R2 upload failed: ${uploadResponse.statusText}`
      };
    }

    console.log('[R2] ✅ Blob uploaded to R2 successfully');
    console.log('[R2] 💾 Saving R2 URL to database...');

    // Save to DB with R2 URL
    const { data: savedData, error } = await db
      .from('trade_images')
      .insert({
        user_id:     userId,
        trade_id:    tradeId,
        storage_url: publicUrl,
        data:        null,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[R2] ❌ Database save error:', error);
      throw error;
    }

    console.log('[R2] ✅ Image record saved to DB');
    console.log('[R2] Image ID:', savedData.id);
    console.log('[R2] ========== R2 UPLOAD SUCCESS ==========');
    console.log('[R2] Storage URL:', savedData.storage_url);

    return { success: true, data: savedData };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[R2] ❌ EXCEPTION:', errorMsg);
    console.log('[R2] ========== R2 UPLOAD FAILED ==========');
    return {
      success: false,
      error: errorMsg
    };
  }
}

async function uploadToSupabaseStorage(userId, tradeId, blob, fileName) {
  try {
    console.log('[SUPABASE] ========== SUPABASE STORAGE FALLBACK START ==========');
    const path = `${userId}/${tradeId}/${fileName}`;
    console.log('[SUPABASE] Storage path:', path);
    console.log('[SUPABASE] Blob size:', blob.size, 'bytes');
    console.log('[SUPABASE] Content type:', blob.type);

    // Upload to Supabase Storage
    console.log('[SUPABASE] 📤 Uploading to Supabase Storage...');
    const { data: uploadData, error: uploadError } = await db.storage
      .from('trade-images')
      .upload(path, blob, { contentType: blob.type, upsert: false });

    if (uploadError) {
      console.error('[SUPABASE] ❌ Upload error:', uploadError);
      throw uploadError;
    }

    console.log('[SUPABASE] ✅ Uploaded to Supabase Storage');
    console.log('[SUPABASE] Storage path:', uploadData.path);

    // Save to DB with Supabase storage path
    console.log('[SUPABASE] 💾 Saving to database...');
    const { data: savedData, error } = await db
      .from('trade_images')
      .insert({
        user_id:     userId,
        trade_id:    tradeId,
        storage_url: uploadData.path,
        data:        null,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[SUPABASE] ❌ Database save error:', error);
      throw error;
    }

    console.log('[SUPABASE] ✅ Saved to database');
    console.log('[SUPABASE] Image ID:', savedData.id);
    console.log('[SUPABASE] ========== SUPABASE STORAGE FALLBACK SUCCESS ==========');
    console.log('[SUPABASE] Storage URL:', savedData.storage_url);

    return savedData;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[SUPABASE] ❌ EXCEPTION:', errorMsg);
    console.log('[SUPABASE] ========== SUPABASE STORAGE FALLBACK FAILED ==========');
    throw error;
  }
}

async function deleteTradeImage(imageId) {
  const { data: img } = await db
    .from('trade_images')
    .select('storage_url, data')
    .eq('id', imageId)
    .maybeSingle();

  // Run storage removal and DB deletion in parallel
  await Promise.all([
    (img?.storage_url && !img?.data)
      ? (img.storage_url.startsWith('https://')
          ? Promise.resolve() // R2 public URLs don't need explicit deletion
          : db.storage.from('trade-images').remove([img.storage_url])) // Supabase storage deletion
      : Promise.resolve(),
    db.from('trade_images').delete().eq('id', imageId),
  ]);
}


// ── Signed URL cache (55 min lifetime) ───────────────────
const _urlCache = {};

// Legacy `data` (base64) column is no longer fetched in bulk by
// getTradeImages. For rows that lack a storage_url, fetch `data` on
// demand (rare path — only matters for pre-R2 uploads).
async function _fetchLegacyImageData(imageId) {
  const { data, error } = await db
    .from('trade_images')
    .select('data')
    .eq('id', imageId)
    .maybeSingle();
  if (error || !data) return '';
  return data.data || '';
}

async function getImageUrl(img) {
  if (!img) return '';

  if (img.storage_url) {
    const cacheKey = img.storage_url;

    // R2 URLs are already public, return them directly
    if (img.storage_url.startsWith('https://')) {
      return img.storage_url;
    }

    // Supabase storage paths need signed URLs
    const cached = _urlCache[cacheKey];
    if (cached && cached.expires > Date.now()) return cached.url;
    const { data, error } = await db.storage
      .from('trade-images')
      .createSignedUrl(img.storage_url, 60 * 60);
    if (!error && data.signedUrl) {
      _urlCache[cacheKey] = { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 };
      return data.signedUrl;
    }
    return '';
  }

  if (img.data) return img.data;
  if (img.url)  return img.url;
  // Legacy row: getTradeImages stripped `data` from the select; fetch it now.
  if (img.id)   return await _fetchLegacyImageData(img.id);
  return '';
}

// ── Batch signed URL fetch ────────────────────────────────
// Fetches signed URLs for multiple images in parallel with cache awareness.
// Use this instead of calling getImageUrl() in a loop.
async function getImageUrls(imgs) {
  if (!imgs || !imgs.length) return [];
  const now     = Date.now();
  const results = new Array(imgs.length).fill('');
  const toFetch = []; // only images that need a fresh signed URL

  const legacyIds = []; // rows that need an on-demand `data` fetch
  imgs.forEach((img, i) => {
    if (!img)           return;
    if (img.data)       { results[i] = img.data; return; }
    if (img.url)        { results[i] = img.url;  return; }
    if (img.storage_url) {
      // R2 URLs are already public, use them directly
      if (img.storage_url.startsWith('https://')) {
        results[i] = img.storage_url;
        return;
      }
      // Supabase storage paths need signed URLs
      const cached = _urlCache[img.storage_url];
      if (cached && cached.expires > now) { results[i] = cached.url; return; }
      toFetch.push({ idx: i, path: img.storage_url });
      return;
    }
    // Legacy row: data column was stripped from getTradeImages; load it now.
    if (img.id) legacyIds.push({ idx: i, id: img.id });
  });

  // All cache misses fetched in parallel — single round-trip per image
  const tasks = [];
  if (toFetch.length) {
    tasks.push(Promise.all(toFetch.map(async ({ idx, path }) => {
      const { data, error } = await db.storage
        .from('trade-images')
        .createSignedUrl(path, 60 * 60);
      if (!error && data?.signedUrl) {
        _urlCache[path] = { url: data.signedUrl, expires: now + 55 * 60 * 1000 };
        results[idx] = data.signedUrl;
      }
    })));
  }
  if (legacyIds.length) {
    tasks.push(Promise.all(legacyIds.map(async ({ idx, id }) => {
      results[idx] = await _fetchLegacyImageData(id);
    })));
  }
  if (tasks.length) await Promise.all(tasks);

  return results;
}


// ── Image optimization & compression ─────────────────────
const IMAGE_CONFIG = {
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_WIDTH: 1200,
  MAX_HEIGHT: 1200,
  TARGET_SIZE_KB: 200, // Target compressed size
  QUALITY_HIGH: 0.85,
  QUALITY_MEDIUM: 0.75,
  QUALITY_LOW: 0.60,
};

async function compressImage(input, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      maxWidth = IMAGE_CONFIG.MAX_WIDTH,
      maxHeight = IMAGE_CONFIG.MAX_HEIGHT,
      targetKB = IMAGE_CONFIG.TARGET_SIZE_KB
    } = options;

    const img = new Image();

    img.onload = () => {
      // Revoke object URL if we created one
      if (img._objectUrl) URL.revokeObjectURL(img._objectUrl);

      try {
        let width = img.width;
        let height = img.height;
        const aspectRatio = width / height;

        if (width > maxWidth) {
          width = maxWidth;
          height = Math.round(width / aspectRatio);
        }
        if (height > maxHeight) {
          height = maxHeight;
          width = Math.round(height * aspectRatio);
        }

        console.log(`[compress] Original: ${img.width}x${img.height} → Optimized: ${width}x${height}`);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        let minQuality = 0.3;
        let maxQuality = 0.95;
        let bestDataUrl = canvas.toDataURL('image/jpeg', 0.75);
        let iterations = 0;

        while (maxQuality - minQuality > 0.01 && iterations < 8) {
          iterations++;
          const midQuality = (minQuality + maxQuality) / 2;
          const testDataUrl = canvas.toDataURL('image/jpeg', midQuality);
          const testSizeKB = (testDataUrl.length * 0.75) / 1024;
          if (testSizeKB > targetKB) {
            maxQuality = midQuality;
          } else {
            minQuality = midQuality;
            bestDataUrl = testDataUrl;
          }
        }

        const finalSizeKB = (bestDataUrl.length * 0.75) / 1024;
        console.log(`[compress] ✅ Final: ${Math.round(finalSizeKB)} KB (target: ${targetKB} KB)`);
        resolve(bestDataUrl);
      } catch (error) {
        console.error('[compress] Error during compression:', error);
        reject(error);
      }
    };

    img.onerror = () => {
      if (img._objectUrl) URL.revokeObjectURL(img._objectUrl);
      reject(new Error('Failed to load image for compression'));
    };

    // Accept Blob, File, or data URL string
    if (typeof input === 'string') {
      img.src = input;
    } else if (input instanceof Blob || input instanceof File) {
      const objectUrl = URL.createObjectURL(input);
      img._objectUrl = objectUrl;
      img.src = objectUrl;
    } else {
      reject(new Error('compressImage: unsupported input type'));
    }
  });
}

/**
 * Validate image before compression
 * Returns { valid: boolean, error?: string }
 */
function validateImageBeforeUpload(file) {
  // Check file size
  if (file.size > IMAGE_CONFIG.MAX_FILE_SIZE_BYTES) {
    const maxMB = Math.round(IMAGE_CONFIG.MAX_FILE_SIZE_BYTES / (1024 * 1024) * 10) / 10;
    const fileMB = Math.round(file.size / (1024 * 1024) * 10) / 10;
    return {
      valid: false,
      error: `Image too large: ${fileMB}MB (max ${maxMB}MB)`
    };
  }

  // Check file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported format: ${file.type}`
    };
  }

  return { valid: true };
}


// ── Bulk image count (1 query instead of N) ───────────────
async function getImageCountsForJournal(userId) {
  const { data } = await db
    .from('trade_images')
    .select('trade_id')
    .eq('user_id', userId);
  const counts = {};
  (data || []).forEach(row => {
    counts[row.trade_id] = (counts[row.trade_id] || 0) + 1;
  });
  return counts;
}

// Explicit column list — never ship the legacy `data` (base64) column to
// the browser. R2/Storage URLs are already enough; if a row is still legacy
// (storage_url null, data populated), getImageUrl() handles the fallback
// path explicitly via the dedicated migration helper.
const TRADE_IMAGES_COLUMNS = 'id, trade_id, storage_url, created_at';

async function getTradeImages(tradeId) {
  const { data, error } = await db
    .from('trade_images')
    .select(TRADE_IMAGES_COLUMNS)
    .eq('trade_id', tradeId)
    .order('created_at', { ascending: true });
  if (error) console.error('[supabase] getTradeImages error:', error);
  return data || [];
}


// ── Dashboard PNL helper ──────────────────────────────────
// Fetches PNL for multiple journals in ONE query instead of
// calling getTrades() per journal (N+1 problem on dashboard).
async function getJournalsPnl(journalIds) {
  if (!journalIds.length) return {};
  const { data } = await db
    .from('trades')
    .select('journal_id, pnl')
    .in('journal_id', journalIds)
    .not('pnl', 'is', null);

  const map = {};
  (data || []).forEach(row => {
    if (row.pnl != null) {
      map[row.journal_id] = (map[row.journal_id] || 0) + parseFloat(row.pnl);
    }
  });
  return map;
}


// ── Realtime subscription ─────────────────────────────────

function subscribeTrades(journalId, onChange) {
  return db
    .channel('trades:' + journalId)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'trades',
      filter: `journal_id=eq.${journalId}`,
    }, onChange)
    .subscribe();
}

// Applies a Supabase realtime payload to an in-memory trades array
// (already mapped through dbToTrade). Returns a new array (does not mutate).
//
// Why this matters: every realtime tick used to trigger a full
// `getTrades()` refetch on every consumer (logs, notes, calendar). With
// 100 trades and a steady stream of edits that's 100 rows × N events of
// pure egress for nothing. This applies the inline diff instead.
//
// Caller-supplied `mergeFn(existing, incoming)` lets the page preserve
// fields that aren't in the realtime row (e.g. attached image arrays).
// If omitted, the default is `{ ...existing, ...incoming }`.
function applyTradeDelta(trades, payload, mergeFn) {
  if (!payload || !payload.eventType) return trades;
  const event = payload.eventType;

  if (event === 'INSERT' || event === 'UPDATE') {
    const row = payload.new;
    if (!row || !row.id) return trades;
    const incoming = dbToTrade(row);
    const idx = trades.findIndex(t => t.id === incoming.id);
    if (idx >= 0) {
      const next = trades.slice();
      next[idx] = mergeFn ? mergeFn(trades[idx], incoming) : { ...trades[idx], ...incoming };
      return next;
    }
    // Not in list yet → prepend (matches "newest first" sort everywhere).
    return [incoming, ...trades];
  }

  if (event === 'DELETE') {
    const id = payload.old?.id;
    if (!id) return trades;
    return trades.filter(t => t.id !== id);
  }

  return trades;
}


// ── PIN helper ────────────────────────────────────────────

async function hashPin(pin) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(pin)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Custom Notes ──────────────────────────────────────────
async function getCustomNotes(journalId) {
  const { data, error } = await db.from('custom_notes')
    .select('*').eq('journal_id', journalId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
 
async function insertCustomNote(userId, journalId, note) {
  const { data, error } = await db.from('custom_notes')
    .insert({ user_id: userId, journal_id: journalId, ...note })
    .select().single();
  if (error) throw error;
  return data;
}
 
async function updateCustomNote(id, updates) {
  const { error } = await db.from('custom_notes')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
 
async function deleteCustomNote(id) {
  // Best-effort: remove any images first so storage doesn't leak.
  const { data: row } = await db.from('custom_notes')
    .select('images').eq('id', id).maybeSingle();
  const paths = ((row?.images) || [])
    .map(im => im?.storage_url || im?.path)
    .filter(p => p && !String(p).startsWith('https://'));
  if (paths.length) {
    try { await db.storage.from('custom-note-images').remove(paths); } catch(e) {}
  }
  const { error } = await db.from('custom_notes').delete().eq('id', id);
  if (error) throw error;
}

// ── Custom Note Images ────────────────────────────────────
// Custom notes store images as an `images` jsonb column on the row:
//   [{ storage_url: '<bucket-path>', path: '<bucket-path>' }, ...]
// We upload to the 'custom-note-images' bucket under <user_id>/<note_id>/<filename>.
const _cnUrlCache = {};

async function uploadCustomNoteImage(userId, noteId, input) {
  function _dataUrlToBlob(dataUrl) {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  const compressed = await compressImage(input, {
    maxWidth: IMAGE_CONFIG.MAX_WIDTH,
    maxHeight: IMAGE_CONFIG.MAX_HEIGHT,
    targetKB: IMAGE_CONFIG.TARGET_SIZE_KB
  });
  const blob = _dataUrlToBlob(compressed);
  if (blob.size > IMAGE_CONFIG.MAX_FILE_SIZE_BYTES) {
    throw new Error('Image too large (max 5MB)');
  }
  const ext  = blob.type.includes('png') ? 'png' : 'jpg';
  const path = `${userId}/${noteId || 'staging'}/cn_${Date.now()}.${ext}`;
  const { error } = await db.storage
    .from('custom-note-images')
    .upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw error;
  return { storage_url: path, path };
}

async function getCustomNoteImageUrl(img) {
  if (!img) return '';
  const key = img.storage_url || img.path || '';
  if (!key) return img.url || '';
  if (key.startsWith('https://')) return key;
  const cached = _cnUrlCache[key];
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await db.storage
    .from('custom-note-images')
    .createSignedUrl(key, 60 * 60);
  if (!error && data?.signedUrl) {
    _cnUrlCache[key] = { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 };
    return data.signedUrl;
  }
  return '';
}

async function deleteCustomNoteImageFile(path) {
  if (!path || String(path).startsWith('https://')) return;
  try { await db.storage.from('custom-note-images').remove([path]); } catch(e) {}
}

// ── Pre-Session checklist ─────────────────────────────────
// Decoupled from session_date: each journal has one or more checklist
// "sets" with their own items, reset cadence, and resettable runtime
// state (is_checked per item, plus set-level mood / market_bias).
//
// A "reset cycle" is a window that starts at the configured reset_time
// each day and advances forward 24h. State carries last_reset_at; if
// the current cycle's start is later than that timestamp, the state is
// considered stale and is reset (locally + persisted) before render.

async function getPresessionSets(journalId) {
  const { data, error } = await db.from('presession_checklist_sets')
    .select('*')
    .eq('journal_id', journalId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getPresessionItems(setId) {
  const { data, error } = await db.from('presession_checklist_items')
    .select('*')
    .eq('set_id', setId)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getPresessionState(setId) {
  const { data, error } = await db.from('presession_checklist_state')
    .select('*')
    .eq('set_id', setId);
  if (error) throw error;
  return data || [];
}

async function getPresessionSetState(setId) {
  const { data, error } = await db.from('presession_checklist_set_state')
    .select('*')
    .eq('set_id', setId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const DEFAULT_PRESESSION_MOODS = ['😊 Calm', '🎯 Focused', '😤 Frustrated', '😰 Anxious', '🤑 Greedy', '😴 Tired', '💪 Confident'];

async function createPresessionSet(userId, journalId, fields) {
  const { data, error } = await db.from('presession_checklist_sets')
    .insert({
      user_id: userId,
      journal_id: journalId,
      name: fields.name || 'New Checklist',
      description: fields.description || '',
      reset_enabled: fields.reset_enabled ?? true,
      reset_time: fields.reset_time || '00:00',
      position: fields.position ?? 0,
      mood_options: fields.mood_options || DEFAULT_PRESESSION_MOODS,
    })
    .select('*').single();
  if (error) throw error;
  // Companion set-state row so realtime + reset bookkeeping have something to mutate.
  await db.from('presession_checklist_set_state')
    .insert({ set_id: data.id, user_id: userId });
  return data;
}

async function updatePresessionSet(setId, updates) {
  const { error } = await db.from('presession_checklist_sets')
    .update(updates).eq('id', setId);
  if (error) throw error;
}

async function deletePresessionSet(setId) {
  const { error } = await db.from('presession_checklist_sets')
    .delete().eq('id', setId);
  if (error) throw error;
}

async function createPresessionItem(setId, fields) {
  const { data, error } = await db.from('presession_checklist_items')
    .insert({
      set_id: setId,
      label: fields.label,
      order_index: fields.order_index ?? 0,
    })
    .select('*').single();
  if (error) throw error;
  return data;
}

async function updatePresessionItem(itemId, updates) {
  const { error } = await db.from('presession_checklist_items')
    .update(updates).eq('id', itemId);
  if (error) throw error;
}

async function deletePresessionItem(itemId) {
  const { error } = await db.from('presession_checklist_items')
    .delete().eq('id', itemId);
  if (error) throw error;
}

async function upsertPresessionItemState(userId, setId, itemId, isChecked) {
  const { error } = await db.from('presession_checklist_state')
    .upsert({
      user_id: userId,
      set_id: setId,
      item_id: itemId,
      is_checked: isChecked,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'item_id' });
  if (error) throw error;
}

async function upsertPresessionSetState(userId, setId, updates) {
  const { error } = await db.from('presession_checklist_set_state')
    .upsert({
      user_id: userId,
      set_id: setId,
      ...updates,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'set_id' });
  if (error) throw error;
}

// Resets all per-item states for a set + the set-level mood/bias, stamping
// last_reset_at to the cycle's start. Called on stale-cycle detection or
// from a manual "Reset now" action.
async function resetPresessionCycle(userId, setId, cycleStartIso) {
  const stamp = cycleStartIso || new Date().toISOString();
  const [r1, r2] = await Promise.all([
    db.from('presession_checklist_state')
      .update({ is_checked: false, last_reset_at: stamp, updated_at: stamp })
      .eq('set_id', setId),
    db.from('presession_checklist_set_state')
      .upsert({
        set_id: setId, user_id: userId,
        session_mood: null, market_bias: null,
        last_reset_at: stamp, updated_at: stamp,
      }, { onConflict: 'set_id' }),
  ]);
  if (r1.error) throw r1.error;
  if (r2.error) throw r2.error;
}

// Computes the most recent reset boundary (a Date object) for a given
// reset_time string ("HH:MM" or "HH:MM:SS") in the user's local zone.
// Cycles are 24h windows aligned to the wall-clock reset_time.
function presessionCycleStart(resetTimeStr) {
  const [h, m] = String(resetTimeStr || '00:00').split(':').map(n => parseInt(n, 10) || 0);
  const now = new Date();
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (candidate.getTime() > now.getTime()) {
    candidate.setDate(candidate.getDate() - 1);
  }
  return candidate;
}

// True if the supplied last_reset_at is older than the current cycle's start.
function presessionIsStale(lastResetAtIso, resetTimeStr) {
  if (!lastResetAtIso) return true;
  const cycleStart = presessionCycleStart(resetTimeStr).getTime();
  const last = new Date(lastResetAtIso).getTime();
  return last < cycleStart;
}

function subscribePresessionSet(setId, onChange) {
  return db
    .channel('presession_set:' + setId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presession_checklist_sets',      filter: `id=eq.${setId}`     }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presession_checklist_items',     filter: `set_id=eq.${setId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presession_checklist_state',     filter: `set_id=eq.${setId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presession_checklist_set_state', filter: `set_id=eq.${setId}` }, onChange)
    .subscribe();
}

function subscribePresessionJournal(journalId, onChange) {
  return db
    .channel('presession_journal:' + journalId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presession_checklist_sets', filter: `journal_id=eq.${journalId}` }, onChange)
    .subscribe();
}