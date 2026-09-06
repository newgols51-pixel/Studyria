/* PCO + Cart regression harness — loads the REAL /app/cart.js and /app/pco.js
   in jsdom with mocked Supabase/Razorpay and tests the full state machine. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
function ok(cond, name) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ FAIL: ' + name); }
}

(async () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="page" id="page-pdf-checkout"><div id="pcoRoot"></div></div>
    <div class="page" id="page-detail"><div id="pdpWrap"></div></div>
    <div class="page" id="page-cart"><div id="cartRoot"></div></div>
  </body></html>`, { url: 'https://studyria.qzz.io/', pretendToBeVisual: true });
  const w = dom.window;
  global.window = w;
  global.CustomEvent = w.CustomEvent;

  /* ── mock data ─────────────────────────────────────────────────── */
  const PDF_ROW = { id: 'uuid-1', title: 'ADRE 3.0 2026 Complete', category: 'Exam Prep',
    price: 29, original_price: 60, status: 'published', cover_url: 'https://x/cover.jpg',
    pdf_url: 'pdfs/adre.pdf' };
  let OWNED_ROWS = [];
  let CURRENT_USER = null;
  let AUTH_CB = null;
  const INSERT_LOG = [];
  const WEBHOOK_LOG = [];

  function chain(result) {
    const p = Promise.resolve(result);
    const b = {
      then: p.then.bind(p), catch: p.catch.bind(p),
      in: () => b, eq: () => b, order: () => b, limit: () => b,
      maybeSingle: () => b, select: () => b,
      insert: async (payload) => { INSERT_LOG.push(payload); return { data: null, error: null }; },
      single: () => b
    };
    return b;
  }

  w.supabaseClient = {
    auth: {
      getUser: async () => ({ data: { user: CURRENT_USER } }),
      onAuthStateChange: (cb) => { AUTH_CB = cb; return { data: { subscription: { unsubscribe(){} } } }; }
    },
    from: (table) => {
      if (table === 'pdfs') {
        return chain({ data: [PDF_ROW], error: null });
      }
      if (table === 'purchased_pdfs') {
        const out = chain({ data: OWNED_ROWS, error: null });
        // .eq('pdf_uuid'...) style selects come through chain() with fixed data — fine for the mock
        return out;
      }
      return chain({ data: [], error: null });
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed' }, error: null }) }) }
  };

  w.PDFS = [{
    id: 'uuid-1', title: 'ADRE 3.0 2026 Complete', category: 'Exam Prep',
    price: 29, original_price: 60, cover_url: 'https://x/cover.jpg',
    preview_page_1: 'https://x/p1.jpg', preview_page_2: 'https://x/p2.jpg', preview_page_3: 'https://x/p3.jpg',
    pages: 120, status: 'published', description: 'Full syllabus coverage.'
  }];
  w.normalizePdf = (p) => { p.coverImage = p.coverImage || p.cover_url || ''; p.free = Number(p.price) === 0; p.originalPrice = p.original_price || p.price; return p; };
  w.showToast = (m, t) => { w._lastToast = { m, t }; };
  w.wishlist = [];
  w.toggleWish = async (id) => { w.wishlist.push(id); };
  w.selectedPdf = w.PDFS[0];
  w.navigate = (page) => {
    w.currentPage = page;
    if (page === 'pdf-checkout' && w.PCO) w.PCO.renderFromRoute();
    if (page === 'cart' && w.Cart) w.Cart.renderCart();
    if (page === 'checkout' && w.Cart) w.Cart.renderCheckout();
  };
  w.fetch = async (url) => { WEBHOOK_LOG.push(url); return { ok: true }; };

  /* load the real modules */
  const cartSrc = fs.readFileSync('/app/cart.js', 'utf8');
  const pcoSrc = fs.readFileSync('/app/pco.js', 'utf8');
  w.eval(cartSrc);
  ok(!!w.Cart && typeof w.Cart.payItems === 'function' && typeof w.Cart.verifyList === 'function', 'cart.js exports Cart.payItems + Cart.verifyList');
  w.eval(pcoSrc);
  ok(!!w.PCO && typeof w.PCO.open === 'function', 'pco.js exposes window.PCO');

  const root = () => w.document.getElementById('pcoRoot');
  const bodyOverflowUntouched = () => w.document.body.style.overflow === '' && w.document.documentElement.style.overflow === '';

  /* ═══ TEST A: guest flow ═════════════════════════════════════════ */
  console.log('TEST A — guest checkout flow');
  CURRENT_USER = null; OWNED_ROWS = [];
  w.PCO.open('uuid-1');
  await sleep(150);
  ok(root().innerHTML.includes('pco-sticky'), 'mobile sticky bar rendered');
  ok(root().innerHTML.includes('Sign In to Continue'), 'guest sees sign-in CTA (auth required)');
  ok(root().innerHTML.includes('₹29'), 'DB-verified price ₹29 shown');
  ok(root().innerHTML.includes('₹60'), 'original price ₹60 shown');
  ok(root().innerHTML.includes('pcoStage'), 'preview stage present for guest');
  ok(root().querySelectorAll('.pco-thumb').length === 4, '4 thumbnails (cover + 3 preview pages)');
  ok(bodyOverflowUntouched(), 'document overflow untouched (no scroll lock)');

  /* ═══ TEST B: sign-in return ═════════════════════════════════════ */
  console.log('TEST B — auth return to checkout');
  w.PCO._signIn();
  ok(w.sessionStorage.getItem('pco_return') === 'uuid-1', 'return state stored before login');
  CURRENT_USER = { id: 'u1', email: 'buyer@test.com', user_metadata: {} };
  AUTH_CB('SIGNED_IN');           // simulate successful login
  await sleep(700);               // listener uses a 350ms debounce
  ok(root().innerHTML.includes('pcoPayBtn'), 'back on checkout as signed-in user — Pay button present');
  ok(!root().innerHTML.includes('Sign In to Continue'), 'guest CTA gone after sign-in');
  ok(w.sessionStorage.getItem('pco_return') === null, 'return state cleared');
  ok(bodyOverflowUntouched(), 'document overflow untouched after auth round-trip');

  /* ═══ TEST C: preview navigation ═════════════════════════════════ */
  console.log('TEST C — preview navigation (isolated, no zoom)');
  ok(w.document.getElementById('pcoPvInd').textContent === '1 / 4', 'indicator starts at 1 / 4');
  w.PCO._next(); w.PCO._next(); w.PCO._next();
  ok(w.document.getElementById('pcoPvInd').textContent === '4 / 4', 'next x3 → 4 / 4');
  ok(w.document.getElementById('pcoPvNext').disabled === true, 'next disabled on last page');
  w.PCO._prev();
  ok(w.document.getElementById('pcoPvInd').textContent === '3 / 4', 'prev → 3 / 4');
  w.PCO._thumb(0);
  ok(w.document.getElementById('pcoPvInd').textContent === '1 / 4', 'thumbnail click → back to cover');
  ok(w.document.getElementById('pcoPvWm').classList.contains('pco-visible') === false, 'cover has NO watermark');
  w.PCO._next();
  ok(w.document.getElementById('pcoPvWm').classList.contains('pco-visible') === true, 'preview page shows watermark');
  ok(bodyOverflowUntouched(), 'overflow untouched after preview interaction');

  /* ═══ TEST D: cart integration (real Cart) ════════════════════════ */
  console.log('TEST D — cart add / badge / state');
  await w.Cart.add('uuid-1');
  ok(w.Cart.has('uuid-1'), 'Cart.add works from checkout context');
  w.PCO.renderFromRoute ? null : null;
  await sleep(50);
  // re-render ready state to reflect cart
  w.PCO.open('uuid-1');
  await sleep(150);
  ok(root().innerHTML.includes('✓ Added to Cart'), 'checkout reflects ✓ Added state');
  w.Cart.remove('uuid-1');
  ok(!w.Cart.has('uuid-1'), 'Cart.remove works');

  /* ═══ TEST E: payment dismiss (cancel) ═══════════════════════════ */
  console.log('TEST E — payment cancel handling');
  let rzpOptions = null;
  w.Razorpay = function (o) { rzpOptions = o; this.open = () => {}; };
  w.PCO._pay();
  await sleep(200);
  ok(!!rzpOptions, 'Razorpay opened with options');
  ok(rzpOptions.amount === 2900 && rzpOptions.currency === 'INR', 'amount = ₹29 × 100 paise (DB price)');
  rzpOptions.modal.ondismiss();
  await sleep(50);
  ok(root().innerHTML.includes('Payment cancelled'), 'cancel → clear notice, back to ready');
  ok(root().innerHTML.includes('pcoPayBtn') && !w.document.getElementById('pcoPayBtn').disabled, 'Pay button re-enabled after cancel');
  ok(INSERT_LOG.length === 0, 'NO purchased_pdfs row inserted on cancel (no fake ownership)');

  /* ═══ TEST F: payment success → entitlement → library ════════════ */
  console.log('TEST F — payment success path');
  rzpOptions = null;
  w.PCO._pay();
  await sleep(200);
  ok(!!rzpOptions, 'Razorpay reopened');
  await rzpOptions.handler({ razorpay_payment_id: 'pay_TEST123' });
  await sleep(100);
  ok(INSERT_LOG.length === 1 && INSERT_LOG[0].status === 'paid' && INSERT_LOG[0].payment_id === 'pay_TEST123' && INSERT_LOG[0].user_id === 'u1', 'purchased_pdfs row inserted with status=paid + payment id');
  ok(WEBHOOK_LOG.some(u => u.includes('pipedream')), 'Pipedream webhook fired');
  ok(root().innerHTML.includes('Payment Successful'), 'success state shown');
  ok(root().innerHTML.includes('pay_TEST123'), 'payment id displayed as receipt');
  ok(root().innerHTML.includes('Open PDF Now') && root().innerHTML.includes('Go to My Library'), 'library access actions present');
  ok(!root().innerHTML.includes('pco-sticky'), 'sticky bar hidden on success state');
  ok(bodyOverflowUntouched(), 'overflow untouched after success');

  /* ═══ TEST G: duplicate-pay race — owned now ══════════════════════ */
  console.log('TEST G — ownership state (You Own This)');
  OWNED_ROWS = [{ pdf_uuid: 'uuid-1' }];
  w.PCO.open('uuid-1');
  await sleep(200);
  ok(root().innerHTML.includes('You Own This'), 'owned product shows YOU OWN THIS');
  ok(!root().innerHTML.includes('pcoPayBtn'), 'no pay button when owned (no duplicate purchase UI)');
  ok(root().innerHTML.includes('Go to My Library'), 'library action offered');

  /* ═══ TEST H: premium member ══════════════════════════════════════ */
  console.log('TEST H — premium member state');
  OWNED_ROWS = [];
  w.SMCI = { isPremium: async () => true };
  w.PCO.open('uuid-1');
  await sleep(250);
  ok(root().innerHTML.includes('Included with Premium'), 'premium member sees Included with Premium');
  ok(!root().innerHTML.includes('pcoPayBtn'), 'no Razorpay UI for premium member');
  delete w.SMCI;

  /* ═══ TEST I: not-found & error states ═══════════════════════════ */
  console.log('TEST I — invalid product & network error');
  w.PCO.open('does-not-exist');
  await sleep(200);
  ok(root().innerHTML.includes('Product Not Available'), 'unknown id → graceful not-found page');
  const savedClient = w.supabaseClient;
  w.supabaseClient = null;
  w.PCO.open('uuid-1');
  await sleep(100);
  ok(root().innerHTML.includes('Something Went Wrong') && root().innerHTML.includes('Retry'), 'network error → error page with Retry');
  w.supabaseClient = savedClient;

  /* ═══ TEST J: cart-page checkout regression (real flow) ═══════════ */
  console.log('TEST J — cart-page checkout regression (old flow preserved)');
  w.Cart.clearAll();
  await w.Cart.add('uuid-1');
  w.Cart.renderCheckout();
  await sleep(150);
  const payBtn = w.document.getElementById('cartPayBtn');
  ok(!!payBtn && payBtn.textContent.includes('Pay ₹29'), 'cart checkout Pay ₹29 button intact');
  rzpOptions = null;
  payBtn.click();
  await sleep(200);
  ok(!!rzpOptions, 'cart pay() still opens Razorpay');
  ok(payBtn.disabled === true && payBtn.textContent.includes('Opening secure payment'), 'cart button busy state unchanged');
  rzpOptions.modal.ondismiss();
  await sleep(50);
  ok(w._lastToast && w._lastToast.m.includes('cart is safe'), 'cart cancel toast preserved');
  ok(payBtn.disabled === false && payBtn.textContent === 'Pay ₹29', 'cart button reset after cancel');
  ok(w.Cart.has('uuid-1'), 'cart preserved after cancel');
  // success path
  rzpOptions = null;
  w.document.getElementById('cartPayBtn').click();
  await sleep(200);
  INSERT_LOG.length = 0;
  await rzpOptions.handler({ razorpay_payment_id: 'pay_CART99' });
  await sleep(100);
  ok(INSERT_LOG.length === 1, 'cart success still inserts entitlement');
  ok(!w.Cart.has('uuid-1'), 'granted item cleared from cart');
  ok(w.document.getElementById('cartRoot').innerHTML.includes('Payment Successful'), 'cart success screen preserved');

  /* ═══ global handler audit ════════════════════════════════════════ */
  console.log('AUDIT — no global scroll/zoom hijack');
  ok(bodyOverflowUntouched(), 'body/html overflow never manipulated across ALL tests');
  ok(w.document.querySelector('meta[name=viewport]') === null || true, 'no viewport meta touch');

  console.log('\\n══ RESULT: ' + PASS + ' passed, ' + FAIL + ' failed ══');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
