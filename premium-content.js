/**
 * premium-content.js — Studyria Premium Content Integration v1.0
 * Branch: feat/premium-content-integration
 *
 * PURPOSE: Wire live Supabase membership status to PDF access control
 *   and "My Library → Premium Handwritten Notes" section.
 *
 * SAFETY: Read-only membership checks. Does NOT modify payment pipeline,
 *   Razorpay, purchased_pdfs writes, RLS, SQL schema, or auth.
 */
(function () {
  'use strict';
  if (window.SMCI && window.SMCI._version === 'pci-1.0') return;

  var CACHE_TTL_MS = 60000;
  var SECTION_ID   = 'smci-premium-notes-section';

  var _state = {
    isPremium:false, status:'none', planName:'Free', planSlug:null,
    expiresAt:null, daysLeft:0, fetchedAt:0, fetching:false
  };

  function _sb()   { return window.supabaseClient || null; }
  function _user() { return window.currentUser || null; }
  function _uid()  { var u = _user(); return u ? (u.uid || u.id || null) : null; }
  function _log(m,d){ d!==undefined?console.debug('[SMCI]',m,d):console.debug('[SMCI]',m); }
  function _warn(m,e){ console.warn('[SMCI]',m,e||''); }
  function _toast(m,t){ if(typeof window.showToast==='function') window.showToast(m,t||'info'); }

  async function _fetchStatus() {
    var client=_sb(), uid=_uid();
    if (!client||!uid) {
      Object.assign(_state,{isPremium:false,status:'none',planName:'Free',planSlug:null,
        expiresAt:null,daysLeft:0,fetchedAt:Date.now(),fetching:false});
      return;
    }
    _state.fetching=true;
    try {
      var memRes=await client.from('user_memberships')
        .select('id,plan_id,status,started_at,expires_at')
        .eq('user_id',uid).order('expires_at',{ascending:false}).limit(1).maybeSingle();
      var mem=(!memRes.error&&memRes.data)?memRes.data:null;

      if (!mem||mem.status!=='active') {
        Object.assign(_state,{isPremium:false,status:mem?'expired':'none',planName:'Free',
          planSlug:null,expiresAt:mem?mem.expires_at:null,daysLeft:0,
          fetchedAt:Date.now(),fetching:false});
        _log('Status',_state.status); return;
      }
      var now=new Date(), exp=mem.expires_at?new Date(mem.expires_at):null;
      if (!exp||exp<=now) {
        Object.assign(_state,{isPremium:false,status:'expired',planName:'Free',planSlug:null,
          expiresAt:mem.expires_at,daysLeft:0,fetchedAt:Date.now(),fetching:false});
        _log('Expired at',mem.expires_at); return;
      }
      var planName='Premium',planSlug=null;
      if (mem.plan_id) {
        try {
          var pr=await client.from('membership_plans').select('name,slug').eq('id',mem.plan_id).maybeSingle();
          if (!pr.error&&pr.data){planName=pr.data.name||'Premium';planSlug=pr.data.slug||null;}
        } catch(_){}
      }
      var daysLeft=Math.max(0,Math.ceil((exp-now)/86400000));
      Object.assign(_state,{isPremium:true,status:'active',planName:planName,planSlug:planSlug,
        expiresAt:mem.expires_at,daysLeft:daysLeft,fetchedAt:Date.now(),fetching:false});
      _log('Active premium',{plan:planName,daysLeft:daysLeft});
    } catch(e) {
      _warn('_fetchStatus exception',e);
      _state.isPremium=false; _state.status='none';
      _state.fetching=false; _state.fetchedAt=Date.now();
    }
  }

  async function _getStatus(force) {
    var stale=(Date.now()-_state.fetchedAt)>CACHE_TTL_MS;
    if (force||stale||!_state.fetchedAt) await _fetchStatus();
    return Object.assign({},_state);
  }

  async function _resolveSignedUrl(rawUrl,client) {
    if (!rawUrl||rawUrl==='#') return '';
    if (rawUrl.startsWith('http://')||rawUrl.startsWith('https://')) {
      var m=rawUrl.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
      if (!m) return rawUrl;
      rawUrl=decodeURIComponent(m[1]);
    }
    try {
      var res=await client.storage.from('pdfs').createSignedUrl(rawUrl,3600);
      if (res.error){_warn('signedUrl error',res.error.message);return '';}
      return res.data.signedUrl||'';
    } catch(e){_warn('signedUrl ex',e);return '';}
  }

  function _patchBuyPDF() {
    var orig=window.buyPDF;
    if (!orig||orig._smciPatched) return;
    window.buyPDF=async function buyPDF_smci(pdfId,amount,legacyUrl) {
      var pdf=(window.PDFS||[]).find(function(p){return String(p.id)===String(pdfId);});
      if (pdf&&typeof window.normalizePdf==='function') pdf=window.normalizePdf(pdf);
      var isFree=pdf?(pdf.free||Number(pdf.price||0)===0):(Number(amount||0)===0);
      if (isFree) return orig.call(this,pdfId,amount,legacyUrl);
      if (typeof window._isOwned==='function'&&window._isOwned(String(pdfId))) {
        _log('Individual owner passthrough',pdfId);
        return orig.call(this,pdfId,amount,legacyUrl);
      }
      var status=await _getStatus(false);
      if (!status.isPremium) return orig.call(this,pdfId,amount,legacyUrl);

      _log('Premium bypass buyPDF',pdfId);
      var client=_sb(),user=_user();
      if (!client||!user){_warn('No client/user — fallback');return orig.call(this,pdfId,amount,legacyUrl);}

      var pdfUrl='';
      try {
        var row=await client.from('pdfs').select('pdf_url,title').eq('id',pdfId).single();
        if (row.data) pdfUrl=row.data.pdf_url||'';
      } catch(e){_warn('pdf_url fetch',e);}
      if (!pdfUrl) pdfUrl=pdf?(pdf.pdf_url||pdf.pdfUrl||''):'';
      if (!pdfUrl){_warn('No pdf_url — fallback');return orig.call(this,pdfId,amount,legacyUrl);}

      var url=await _resolveSignedUrl(pdfUrl,client);
      if (!url){_warn('No signed URL — fallback');return orig.call(this,pdfId,amount,legacyUrl);}

      window.open(url,'_blank');
      if (typeof window.trackReadingSession==='function') window.trackReadingSession(pdfId);
      if (typeof window.trackPdfDownloadEvent==='function') window.trackPdfDownloadEvent(pdf||{id:pdfId},'premium_member');
      _toast('Opening with Premium access! \uD83D\uDC51','success');
    };
    window.buyPDF._smciPatched=true;
    _log('buyPDF patched');
  }

  function _patchTriggerPDFDownload() {
    var orig=window.triggerPDFDownload;
    if (!orig||orig._smciPatched) return;
    window.triggerPDFDownload=async function triggerPDFDownload_smci(pdfId) {
      if (typeof window._isOwned==='function'&&window._isOwned(String(pdfId)))
        return orig.call(this,pdfId);
      var status=await _getStatus(false);
      if (!status.isPremium) return orig.call(this,pdfId);

      _log('Premium bypass download',pdfId);
      var client=_sb(),user=_user();
      if (!client||!user) return orig.call(this,pdfId);

      var pdfUrl='';
      try {
        var row=await client.from('pdfs').select('pdf_url').eq('id',pdfId).single();
        if (row.data) pdfUrl=row.data.pdf_url||'';
      } catch(e){}
      if (!pdfUrl) return orig.call(this,pdfId);

      var url=await _resolveSignedUrl(pdfUrl,client);
      if (!url) return orig.call(this,pdfId);

      _toast('Downloading with Premium access! \uD83D\uDCE5\uD83D\uDC51','success');
      try {
        var a=document.createElement('a');
        a.href=url;a.download='';a.target='_blank';a.rel='noopener noreferrer';
        document.body.appendChild(a);a.click();document.body.removeChild(a);
      } catch(_){window.open(url,'_blank');}
      if (typeof window.trackReadingSession==='function') window.trackReadingSession(pdfId);
    };
    window.triggerPDFDownload._smciPatched=true;
    _log('triggerPDFDownload patched');
  }

  function _getPremiumPdfs() {
    return (window.PDFS||[]).filter(function(p){
      if (!p||!p.title) return false;
      return Number(p.price||0)>0&&!p.free;
    });
  }

  function _esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  function _buildPremiumCard(pdf) {
    var title=_esc(pdf.title||'Untitled');
    var cover=pdf.cover_image||pdf.coverImage||'';
    var price=Number(pdf.price||0);
    var cat=_esc(pdf.category||'');
    var id=String(pdf.id);
    var coverHtml=cover
      ?'<img src="'+cover+'" alt="'+title+'" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'" loading="lazy" decoding="async">'
      :'<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;background:linear-gradient(135deg,rgba(61,142,248,0.08),rgba(139,92,246,0.08))">\uD83D\uDCCC</div>';
    return '<div onclick="buyPDF(\''+id+'\','+price+')" style="cursor:pointer;border-radius:10px;'
      +'background:var(--glass-bg,rgba(255,255,255,0.03));border:1px solid var(--glass-border,rgba(255,255,255,0.08));'
      +'overflow:hidden;transition:transform .15s,box-shadow .15s" '
      +'onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 6px 20px rgba(0,0,0,.3)\'" '
      +'onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\'">'
      +'<div style="position:relative;height:110px;overflow:hidden">'
      +coverHtml
      +'<div style="position:absolute;top:5px;right:5px;background:linear-gradient(135deg,#fbbf24,#f59e0b);'
      +'color:#000;font-size:.55rem;font-weight:800;padding:2px 6px;border-radius:10px">\uD83D\uDC51 PREMIUM</div>'
      +'</div>'
      +'<div style="padding:8px">'
      +'<div style="font-size:.74rem;font-weight:600;color:var(--text1);line-height:1.3;margin-bottom:3px;'
      +'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+title+'</div>'
      +(cat?'<div style="font-size:.62rem;color:var(--text2);margin-bottom:5px">'+cat+'</div>':'')
      +'<button onclick="event.stopPropagation();buyPDF(\''+id+'\','+price+')" '
      +'style="width:100%;padding:5px;border-radius:6px;border:none;cursor:pointer;font-size:.7rem;font-weight:700;'
      +'background:linear-gradient(135deg,rgba(251,191,36,0.15),rgba(245,158,11,0.1));'
      +'color:#fbbf24;border:1px solid rgba(251,191,36,0.25)">\uD83D\uDC51 Open Free</button>'
      +'</div></div>';
  }

  function _buildPremiumSection(pdfs,status) {
    var expFmt='';
    if (status.expiresAt) {
      try{expFmt=new Date(status.expiresAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}catch(_){}
    }
    var booksHtml=pdfs.length>0
      ?pdfs.map(_buildPremiumCard).join('')
      :'<div style="text-align:center;padding:24px;color:var(--text2);font-size:.88rem">No Premium Notes in catalogue yet.</div>';
    return '<div id="'+SECTION_ID+'" style="margin-top:24px;padding-top:24px;border-top:1px solid var(--glass-border,rgba(255,255,255,0.08))">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">'
      +'<div>'
      +'<div style="display:flex;align-items:center;gap:8px">'
      +'<span style="font-size:1.05rem">\uD83D\uDC51</span>'
      +'<span style="font-weight:700;font-size:.95rem;color:var(--text1)">Premium Handwritten Notes</span>'
      +'<span style="font-size:.62rem;font-weight:700;padding:2px 8px;border-radius:20px;'
      +'background:linear-gradient(135deg,rgba(251,191,36,0.15),rgba(245,158,11,0.1));'
      +'color:#fbbf24;border:1px solid rgba(251,191,36,0.3)">ACTIVE</span>'
      +'</div>'
      +(expFmt?'<div style="font-size:.7rem;color:var(--text2);margin-top:3px">Access until '+expFmt+' \xb7 '+_esc(status.planName)+'</div>':'')
      +'</div>'
      +'<button onclick="navigate(\'library\')" style="font-size:.75rem;color:var(--accent);'
      +'background:none;border:1px solid rgba(61,142,248,0.25);border-radius:20px;'
      +'padding:5px 12px;cursor:pointer;font-weight:600">View All \u2192</button>'
      +'</div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">'
      +booksHtml
      +'</div></div>';
  }

  async function injectLibrarySection(force) {
    var panel=document.getElementById('bsfTabPanel');
    var old=document.getElementById(SECTION_ID);
    if (old) old.remove();
    if (!panel) return;
    var status=await _getStatus(force||false);
    if (!status.isPremium){_log('Not premium — skip library section');return;}
    var pdfs=_getPremiumPdfs();
    _log('Injecting premium section',pdfs.length+' PDFs');
    var frag=document.createElement('div');
    frag.innerHTML=_buildPremiumSection(pdfs,status);
    panel.insertBefore(frag.firstChild,panel.firstChild);
  }

  function _removePremiumSection() {
    var el=document.getElementById(SECTION_ID);
    if (el) el.remove();
  }

  function _updateBadges(isPremium) {
    document.querySelectorAll('[data-prm-status]').forEach(function(el){
      el.textContent=isPremium?'\uD83D\uDC51 Premium':'\uD83D\uDD12 Free';
    });
    var pip=document.querySelector('.p5d-tab-pip');
    if (pip) pip.style.display=isPremium?'block':'none';
    var banner=document.querySelector('#dashMain .me-premium-banner');
    if (banner) banner.style.display=isPremium?'none':'';
  }

  async function syncAll(force) {
    var status=await _getStatus(force||false);
    _updateBadges(status.isPremium);
    var panel=document.getElementById('bsfTabPanel');
    if (panel){
      if (status.isPremium) await injectLibrarySection(false);
      else _removePremiumSection();
    }
    try{window.dispatchEvent(new CustomEvent('smci:statusUpdated',{detail:status}));}catch(_){}
    return status;
  }

  function _hookSwitchMeTab() {
    var orig=window.switchMeTab;
    if (!orig||orig._smciHooked) return;
    window.switchMeTab=async function switchMeTab_smci(tab) {
      var res=orig.apply(this,arguments);
      if (tab==='purchased') {
        var tries=0;
        var tryInject=async function(){
          var panel=document.getElementById('bsfTabPanel');
          if (panel){await injectLibrarySection(false);}
          else if (tries++<15){setTimeout(tryInject,200);}
        };
        setTimeout(tryInject,700);
      }
      return res;
    };
    window.switchMeTab._smciHooked=true;
    window.switchMeTab._p5dHooked=orig._p5dHooked||false;
    _log('switchMeTab hooked');
  }

  function _hookRenderDetail() {
    var orig=window.renderDetail;
    if (!orig||orig._smciHooked) return;
    window.renderDetail=async function renderDetail_smci() {
      var res=orig.apply(this,arguments);
      var pdf=window.selectedPdf;
      if (!pdf) return res;
      if (Number(pdf.price||0)===0) return res;
      var status=await _getStatus(false);
      if (!status.isPremium) return res;
      setTimeout(function(){
        document.querySelectorAll('.pdp-cta-btn,.pdp-buy-primary,#pdpStickyBuy,.pdp-sticky-buy').forEach(function(btn){
          if (/buy|purchase|\u26a1/i.test(btn.textContent)) {
            btn.textContent='\uD83D\uDC51 Open with Premium';
            btn.style.background='linear-gradient(135deg,#fbbf24,#f59e0b)';
            btn.style.color='#000';
          }
        });
        document.querySelectorAll('.pdp-price-row,.pdp-price-wrap,.pdp-buy-section').forEach(function(el){
          if (!el.querySelector('.smci-prm-tag')) {
            var tag=document.createElement('div');
            tag.className='smci-prm-tag';
            tag.style.cssText='display:inline-flex;align-items:center;gap:5px;margin-top:6px;'
              +'padding:4px 10px;border-radius:20px;font-size:.72rem;font-weight:700;'
              +'background:linear-gradient(135deg,rgba(251,191,36,0.12),rgba(245,158,11,0.08));'
              +'color:#fbbf24;border:1px solid rgba(251,191,36,0.25)';
            tag.innerHTML='\uD83D\uDC51 Included in your '+_esc(status.planName)+' membership';
            el.appendChild(tag);
          }
        });
      },200);
      return res;
    };
    window.renderDetail._smciHooked=true;
    _log('renderDetail hooked');
  }

  function _hookSyncNavToAuth() {
    var orig=window.syncNavToAuth;
    if (!orig||orig._smciHooked) return;
    window.syncNavToAuth=function syncNavToAuth_smci(user) {
      var res=orig.apply(this,arguments);
      _state.fetchedAt=0; _state.isPremium=false;
      if (!user){_removePremiumSection();_updateBadges(false);_log('Logout — premium cleared');}
      else{setTimeout(function(){syncAll(true);},600);}
      return res;
    };
    window.syncNavToAuth._smciHooked=true;
    window.syncNavToAuth._p5dHooked=orig._p5dHooked||false;
    _log('syncNavToAuth hooked');
  }

  function _onActivated(e) {
    _log('membership:activated',e&&e.detail);
    _state.fetchedAt=0;
    syncAll(true).then(function(s){
      if (s.isPremium){
        _toast('\uD83D\uDC51 Premium active! All Premium Notes unlocked.','success');
        injectLibrarySection(true);
      }
    });
  }

  function _init() {
    _patchBuyPDF();
    _patchTriggerPDFDownload();
    _hookSwitchMeTab();
    _hookRenderDetail();

    var _ha=0;
    function _tryHookAuth(){
      if (window.syncNavToAuth){_hookSyncNavToAuth();}
      else if (_ha++<30){setTimeout(_tryHookAuth,300);}
    }
    _tryHookAuth();

    window.addEventListener('studyria:membership:activated',_onActivated);
    window.addEventListener('smci:refresh',function(){syncAll(true);});

    if (_uid()){setTimeout(function(){syncAll(false);},900);}
    else {
      var _aw=0;
      function _waitAuth(){
        if (_uid()){syncAll(false);}
        else if (_aw++<20){setTimeout(_waitAuth,500);}
      }
      setTimeout(_waitAuth,1200);
    }
    _log('Init complete — SMCI pci-1.0');
  }

  window.SMCI={
    _version:'pci-1.0',
    isPremium:function(){return _getStatus(false).then(function(s){return s.isPremium;});},
    getStatus:function(f){return _getStatus(f||false);},
    syncAll:function(f){return syncAll(f||false);},
    refresh:function(){_state.fetchedAt=0;return syncAll(true);},
    injectLibrarySection:function(){return injectLibrarySection(true);}
  };

  if (document.readyState==='loading'){document.addEventListener('DOMContentLoaded',_init);}
  else{_init();}
})();
