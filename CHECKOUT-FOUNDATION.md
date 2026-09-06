# PDF Checkout — Foundation (pre-build state)

The old dedicated PDF checkout page has been REMOVED (revert of the
feat(checkout) commit). No checkout UI exists now. This file documents
the existing, trusted systems a future checkout page must REUSE —
they are all live and unmodified.

## Architecture the next checkout plugs into

    PRODUCT (window.PDFS + normalizePdf)  ->  product data / pricing
      |
    PREVIEW (pdp-v3.js viewer)            ->  3/4-page preview, thumbnails,
                                             watermark, fullscreen, LOCAL
                                             zoom/pan only (no viewport lock,
                                             no global touch handlers —
                                             browser pinch zoom stays free)
      |
    CART (cart.js, window.Cart)           ->  add/remove/badge/state
      |
    PRICE (verifyCart — DB is the only price source)
      |
    PAYMENT (Razorpay — single implementation:
             buyPDF() in pdp-checkout.js for one product,
             Cart.pay() for the cart)
      |
    ORDER (purchased_pdfs insert, status 'paid', Pipedream webhook)
      |
    VERIFICATION (payment re-verify + order check)
      |
    ENTITLEMENT (purchased_pdfs ownership -> "You Own This")
      |
    LIBRARY ACCESS (Cart.openOwned / My Library route)

## Where each system lives

| System | File | Entry points |
|---|---|---|
| Product data | pdf-list.js, pdp-checkout.js | window.PDFS, normalizePdf(pdf) |
| Pricing / discount | DB price + original_price fields | rendered by PDP; verified server-side |
| Cart | cart.js | Cart.add / remove / has / count / items / updateBadge / openOwned / verifyCart / pay |
| Single-product payment | pdp-checkout.js | buyPDF(pdfId, price) — verify -> Razorpay -> insert -> re-verify -> openOwned |
| Orders / entitlement | Supabase purchased_pdfs | rows with status 'paid'; checkOwnership |
| PDF preview | pdp-v3.js | renderDetail() mounts the gallery; pdpInitPreview() — single-instance viewer (#pdpV3* IDs) |
| Auth | Supabase session + #login route | login returns via existing flow |
| Library | SPA route + openOwned | purchased PDFs list & secure open |

## Rules for the next build

1. REUSE, never duplicate: one payment implementation, one cart, one
   price source (the DB), one entitlement table.
2. Keep the preview ISOLATED: its own bounded viewport, transforms
   applied only inside it, no document.body overflow manipulation,
   no global touch/pointer handlers, no viewport locking. Browser
   pinch zoom and normal page scrolling must stay untouched.
3. Do not modify the PDP, cart page, Library, BrainLab, or the nightly
   page-generator workflow.
4. Route concept: navigate('pdf-checkout') + deep link
   #pdf-checkout/<pdfId> was the previous convention; a clean route
   case in index.html navigate() is the only integration needed.
