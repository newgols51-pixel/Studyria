// ══════════════════════════════════════════════════════════════════
// WISHLIST DIAGNOSTIC SCRIPT
// Add this as a <script> tag AFTER supabase.js but BEFORE </body>
// Open DevTools Console, refresh, and read the numbered steps.
// ══════════════════════════════════════════════════════════════════

(function installWishlistDiagnostics() {
  'use strict';

  const TAG = '[WISHLIST-DIAG]';
  let stepN = 0;
  function step(label, data) {
    stepN++;
    if (data !== undefined) {
      console.log(`${TAG} STEP ${stepN}: ${label}`, data);
    } else {
      console.log(`${TAG} STEP ${stepN}: ${label}`);
    }
  }
  function fail(label, data) {
    console.error(`${TAG} ❌ FAIL — ${label}`, data !== undefined ? data : '');
  }
  function ok(label, data) {
    console.log(`%c${TAG} ✅ OK — ${label}`, 'color:green', data !== undefined ? data : '');
  }

  // ── 1. CHECK SCRIPT LOAD ORDER ─────────────────────────────────
  step('Script load order check');
  if (typeof window.supabaseClient !== 'undefined') {
    ok('supabaseClient exists on window');
  } else {
    fail('window.supabaseClient is UNDEFINED — supabase.js did not run or CDN failed');
  }

  // ── 2. INTERCEPT window.loadWishlistFromSupabase ───────────────
  // We wrap it immediately so we catch whichever version is current
  // AND any later overwrites.
  let _lastLoadResult = null;

  function _wrapLoader(fn, label) {
    return async function wrappedLoader() {
      step(`loadWishlistFromSupabase called (version: ${label})`);
      console.log(`${TAG}   window.currentUser at call time:`, window.currentUser);
      console.log(`${TAG}   wishlist at call time:`, getWishlist());

      const result = await fn.apply(this, arguments);

      console.log(`${TAG}   wishlist AFTER load:`, getWishlist());
      console.log(`${TAG}   window.PDFS.length at this point:`, (window.PDFS || []).length);
      _lastLoadResult = getWishlist();

      if (getWishlist().length === 0) {
        // Distinguish: is Supabase returning 0 rows, or is userId missing?
        const client = window.supabaseClient;
        const uid    = window.currentUser?.uid;
        if (!uid) {
          fail('wishlist is empty because window.currentUser.uid is NULL/UNDEFINED');
        } else {
          // Direct probe
          try {
            const { data, error } = await client
              .from('user_wishlist')
              .select('*')
              .eq('user_id', uid);
            console.log(`${TAG}   DIRECT PROBE user_wishlist for uid=${uid}:`, { data, error });
            if (error) {
              fail('DIRECT PROBE returned error — likely RLS issue', error);
            } else if (!data || data.length === 0) {
              fail('DIRECT PROBE returned 0 rows — row was never inserted or wrong uid');
            } else {
              fail('DIRECT PROBE found rows but wishlist array is still empty — type mismatch bug', data);
            }
          } catch(e) {
            fail('DIRECT PROBE threw exception', e);
          }
        }
      } else {
        ok(`loadWishlistFromSupabase populated wishlist with ${getWishlist().length} items`, getWishlist());
      }
      return result;
    };
  }

  // Install wrapper on current value
  if (typeof window.loadWishlistFromSupabase === 'function') {
    window.loadWishlistFromSupabase = _wrapLoader(window.loadWishlistFromSupabase, 'initial');
  }

  // Watch for overwrites (the line 3733 overwrite happens when the main <script> runs)
  let _loaderSetCount = 0;
  Object.defineProperty(window, 'loadWishlistFromSupabase', {
    configurable: true,
    get() {
      return this._loadWishlistFromSupabase_fn;
    },
    set(fn) {
      _loaderSetCount++;
      step(`window.loadWishlistFromSupabase OVERWRITTEN (#${_loaderSetCount})`, {
        callerStack: new Error().stack.split('\n').slice(1, 4).join(' | ')
      });
      if (_loaderSetCount === 1) {
        // First assignment is supabase.js — wrap it
        this._loadWishlistFromSupabase_fn = _wrapLoader(fn, 'supabase.js');
      } else {
        // Second assignment is index.html line 3733 — this is the overwrite bug
        console.error(`${TAG} ❌ OVERWRITE DETECTED — index.html is replacing the supabase.js version!`);
        console.error(`${TAG}   This resets the _wishlistLoading guard to undefined.`);
        this._loadWishlistFromSupabase_fn = _wrapLoader(fn, `index.html-overwrite-#${_loaderSetCount}`);
      }
    }
  });

  // ── 3. INTERCEPT toggleWish ────────────────────────────────────
  const _origToggle = window.toggleWish || window.toggleWishlistItem;
  async function _wrappedToggle(id) {
    const client = window.supabaseClient;
    step(`toggleWish called with id=${id}`);

    // Get auth.uid() from live session — the only reliable source
    let authUid = null;
    try {
      const { data: { user: u } } = await client.auth.getUser();
      authUid = u?.id ?? null;
    } catch(e) {}

    console.log(`${TAG}   USER ID (auth.getUser):`, authUid);
    console.log(`${TAG}   USER ID (window.currentUser.uid):`, window.currentUser?.uid);
    console.log(`${TAG}   PDF ID:`, String(id));

    if (authUid !== window.currentUser?.uid) {
      fail('MISMATCH: auth.getUser() uid !== window.currentUser.uid', {
        authUid, currentUserUid: window.currentUser?.uid
      });
    }

    const pdfId = String(id);
    const { data: saveData, error: saveError } = await client
      .from('user_wishlist')
      .upsert({ user_id: authUid, pdf_id: pdfId }, { onConflict: 'user_id,pdf_id' });

    console.log(`${TAG}   SAVE RESULT:`, { saveData, saveError });

    if (saveError) {
      fail('UPSERT FAILED', {
        message: saveError.message,
        code:    saveError.code,
        hint:    saveError.hint,
        details: saveError.details
      });
    } else {
      // Verify the row actually exists
      const { data: verifyData, error: verifyError } = await client
        .from('user_wishlist')
        .select('*')
        .eq('user_id', authUid)
        .eq('pdf_id', pdfId);
      console.log(`${TAG}   VERIFY ROW EXISTS:`, { verifyData, verifyError });
      if (!verifyData || verifyData.length === 0) {
        fail('UPSERT succeeded but row is NOT in DB — RLS silently blocked it');
      } else {
        ok('Row confirmed in user_wishlist', verifyData[0]);
      }
    }

    // Now call original
    if (_origToggle) return _origToggle.call(this, id);
  }
  window.toggleWish = _wrappedToggle;
  window.toggleWishlistItem = _wrappedToggle;

  // ── 4. INTERCEPT renderWishlist ────────────────────────────────
  const _origRender = window.renderWishlist;
  window.renderWishlist = async function _wrappedRenderWishlist() {
    step('renderWishlist called');
    const wishlistAtCallTime = [...getWishlist()];
    console.log(`${TAG}   wishlist array BEFORE render:`, wishlistAtCallTime);
    console.log(`${TAG}   window.PDFS.length BEFORE render:`, (window.PDFS || []).length);

    if (wishlistAtCallTime.length > 0 && (window.PDFS || []).length === 0) {
      fail('PDFS IS EMPTY — wishlist has items but window.PDFS has 0 entries. ' +
           'pdf-list.js has not run yet, or Supabase PDF fetch is still pending. ' +
           'This is why the wishlist shows "Nothing saved yet" after refresh.');
    }

    const result = _origRender ? await _origRender.apply(this, arguments) : undefined;

    const wishlistAfter = [...getWishlist()];
    console.log(`${TAG}   wishlist array AFTER render:`, wishlistAfter);

    const matchedPdfs = (window.PDFS || []).filter(p =>
      wishlistAfter.includes(Number(p.id)) || wishlistAfter.includes(String(p.id))
    );
    console.log(`${TAG}   PDFs matched from wishlist:`, matchedPdfs.length, matchedPdfs.map(p=>p.title));

    if (wishlistAfter.length > 0 && matchedPdfs.length === 0) {
      fail('wishlist has IDs but NO PDFs matched — either PDFS is empty or id type mismatch', {
        wishlistIds: wishlistAfter,
        samplePdfIds: (window.PDFS || []).slice(0,3).map(p => ({ id: p.id, type: typeof p.id }))
      });
    }
    return result;
  };

  // ── 5. MONITOR onAuthStateChange events ───────────────────────
  document.addEventListener('DOMContentLoaded', function() {
    const client = window.supabaseClient;
    if (!client) {
      fail('supabaseClient missing at DOMContentLoaded');
      return;
    }

    step('DOMContentLoaded fired');
    console.log(`${TAG}   window.currentUser:`, window.currentUser);
    console.log(`${TAG}   window.PDFS.length:`, (window.PDFS || []).length);

    // Observe auth events
    client.auth.onAuthStateChange(function(event, session) {
      console.log(`${TAG} AUTH EVENT: ${event}`, {
        userId: session?.user?.id ?? null,
        currentUserUid: window.currentUser?.uid ?? null,
        wishlist: getWishlist(),
        pdfsLength: (window.PDFS || []).length
      });
    });

    // After a short delay, run final audit
    setTimeout(async function _finalAudit() {
      step('FINAL AUDIT (500ms after DOMContentLoaded)');
      console.log(`${TAG}   window.currentUser:`, window.currentUser);
      console.log(`${TAG}   CURRENT AUTH USER:`);
      try {
        const { data: { user } } = await client.auth.getUser();
        console.log(`${TAG}     auth.getUser():`, user?.id ?? 'null');
        console.log(`${TAG}   CURRENT USER:', window.currentUser`, window.currentUser);

        if (user) {
          const { data: loadData, error: loadError } = await client
            .from('user_wishlist')
            .select('*')
            .eq('user_id', user.id);
          console.log(`${TAG}   LOAD RESULT (direct probe at audit time):`, { loadData, loadError });
          console.log(`${TAG}   wishlist array in memory:`, getWishlist());
          console.log(`${TAG}   window.PDFS.length:`, (window.PDFS || []).length);

          if (loadError) {
            fail('FINAL AUDIT: load query errored', loadError);
          } else if (!loadData || loadData.length === 0) {
            step('FINAL AUDIT: 0 rows in user_wishlist for this user — no data to show');
          } else if (getWishlist().length === 0) {
            fail('FINAL AUDIT: DB has rows but in-memory wishlist[] is EMPTY — load result not written to variable');
          } else if ((window.PDFS || []).length === 0) {
            fail('FINAL AUDIT: wishlist loaded but window.PDFS is EMPTY — renderWishlist will show nothing. ' +
                 'Fix: renderWishlist must wait for PDFS to be populated.');
          } else {
            ok('FINAL AUDIT: everything looks correct', {
              dbRows: loadData.length,
              wishlistArray: getWishlist(),
              pdfsCount: window.PDFS.length
            });
          }
        } else {
          fail('FINAL AUDIT: no authenticated user');
        }
      } catch(e) {
        fail('FINAL AUDIT exception', e);
      }
    }, 500);
  });

  // ── HELPER: read wishlist regardless of scope ──────────────────
  function getWishlist() {
    try {
      // Try script-scope let first
      if (typeof wishlist !== 'undefined') return [...wishlist];
    } catch(e) {}
    return [...(window.wishlist || [])];
  }

  console.log(`${TAG} Diagnostics installed. Refresh the page to begin.`);
})();
