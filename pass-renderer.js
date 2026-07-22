/* pass-renderer.js — Dynamic Pass Page Renderer v2.0
 * Loads Pass Management config from Supabase (site_config table) and
 * dynamically renders pricing cards, hero text, and benefits on the website.
 *
 * FIX 6: No hardcoded plans — renders ONLY from database/site_config.
 * FIX 3: Auto-refresh via Supabase realtime + custom events.
 * FIX 1: Uses passId (permanent unique ID) instead of slugMap (name→slug).
 * FIX 14: Retry logic for config loading + friendly errors.
 */
(function(){'use strict';
var STORAGE_KEY='studyria_pass_config';
var _cfg=null;var _loaded=false;var _retryCount=0;var _maxRetries=3;

function _loadFromStorage(){try{var raw=localStorage.getItem(STORAGE_KEY);if(raw)return JSON.parse(raw)}catch(e){}return null}

function _esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

// FIX 6: No hardcoded plans. Return empty array if no config.
function _getPlans(cfg){
  if(!cfg||!cfg.plans)return [];
  // FIX 1: Use passId as permanent slug. Fall back to slugMap for backward compat.
  var slugMap={'7 Day Trial':'trial_7day','1 Day Trial':'trial_1day','15 Day Trial':'trial_15day','Monthly':'monthly',
    'Quarterly':'quarterly','Half Year':'half_year','Yearly':'yearly','Lifetime':'lifetime'};
  return cfg.plans.filter(function(p){return p.active}).sort(function(a,b){return(a.order||0)-(b.order||0)}).map(function(p){
    var slug=p.passId||slugMap[p.name]||p.name.toLowerCase().replace(/\s+/g,'_');
    var features=['All Pass Notes','Pass Reading Room'];
    if(cfg.features){cfg.features.filter(function(f){return f.active}).sort(function(a,b){return(a.order||0)-(b.order||0)}).forEach(function(f){if(features.indexOf(f.name)===-1)features.push(f.name)})}
    return{name:p.name,offerPrice:p.offerPrice||0,originalPrice:p.originalPrice||0,duration:p.duration||'30',durationUnit:p.durationUnit||'days',badge:p.badge||'',badgeType:p.badgeType||'gold',buttonText:p.buttonText||'Get Pass',icon:p.icon||'\uF0A4',planSlug:slug,features:features,discount:p.discount||0,passId:p.passId||slug,gradient:p.gradient||'',bgColor:p.bgColor||''}
  })
}

function _renderPricingCards(plans,cfg){
  var grid=document.querySelector('.prm-plans-grid');if(!grid)return;
  if(!plans.length){
    // FIX 14: Show friendly loading message, not "plan not found"
    grid.innerHTML='<div style="text-align:center;padding:40px;color:var(--text3);font-size:.9rem">Loading plans…</div>';
    return;
  }
  var h='';
  plans.forEach(function(p,i){
    var badgeClass=i===3?'prm-popular':(i===4?'prm-best':(i===0?'prm-trial':''));
    var badgeHtml=p.badge?'<div class="prm-plan-badge">'+_esc(p.badge)+'</div>':'';
    var emojiHtml='<div class="prm-plan-emoji">'+_esc(p.icon||'\uF0A4')+'</div>';
    var strikeHtml='';
    if(cfg&&cfg.pricing&&cfg.pricing.showStrikePrice&&p.originalPrice>p.offerPrice){
      strikeHtml='<span style="text-decoration:line-through;font-size:.75rem;color:var(--text3);margin-right:6px">\u20B9'+p.originalPrice+'</span>'
    }
    var discountHtml='';
    if(cfg&&cfg.pricing&&cfg.pricing.showDiscountBadge&&p.discount>0){
      discountHtml='<span style="font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(16,217,142,0.12);color:#10d98e;margin-left:6px">'+p.discount+'% OFF</span>'
    }
    var durationText=p.durationUnit==='lifetime'?'Lifetime':p.duration+' '+(p.durationUnit==='days'?'Days':p.durationUnit==='months'?'Months':'Days');
    var featuresHtml=p.features.map(function(f){return'<li>'+_esc(f)+'</li>'}).join('');
    // FIX 7: Use gradient from config if available
    var cardStyle=p.gradient?'style="background:'+p.gradient+';"':'';
    h+='<div class="prm-plan-card '+badgeClass+'" '+cardStyle+'>'+badgeHtml+emojiHtml+'<div class="prm-plan-name">'+_esc(p.name)+'</div><div class="prm-plan-price">'+strikeHtml+'\u20B9'+p.offerPrice+discountHtml+'</div><div class="prm-plan-only">Only</div><div class="prm-plan-duration">\uF0C5 '+durationText+'</div><ul class="prm-plan-features">'+featuresHtml+'</ul><button class="prm-plan-btn" data-plan="'+p.planSlug+'" data-pass-id="'+p.passId+'" onclick="PPAY.checkout(\''+p.planSlug+'\', this)">'+_esc(p.buttonText)+' \u2192</button></div>'
  });
  grid.innerHTML=h
}

function _renderHero(cfg){
  if(!cfg||!cfg.hero)return;
  var heroTitle=document.querySelector('.prm-hero-title')||document.querySelector('#page-premium h1');
  if(heroTitle&&cfg.hero.headline)heroTitle.innerHTML=_esc(cfg.hero.headline);
  var heroSub=document.querySelector('.prm-hero-sub');
  if(heroSub&&cfg.hero.description)heroSub.textContent=cfg.hero.description
}

function _renderBenefits(cfg){
  if(!cfg||!cfg.benefits)return;
  var title=document.querySelector('.prm-section-title');
  if(title&&cfg.benefits.sectionTitle)title.textContent=cfg.benefits.sectionTitle;
  var sub=document.querySelector('.prm-section-sub');
  if(sub&&cfg.benefits.sectionSubtitle)sub.textContent=cfg.benefits.sectionSubtitle;
  var grid=document.querySelector('.prm-benefits-grid');
  if(grid&&cfg.benefits.cards&&cfg.benefits.cards.length){
    var h='';
    cfg.benefits.cards.forEach(function(c){
      h+='<div class="prm-benefit-card"><div class="prm-benefit-icon" style="background:'+(c.color||'#fbbf24')+'20">'+_esc(c.icon||'\uF0CE')+'</div><div class="prm-benefit-name">'+_esc(c.title)+'</div></div>'
    });
    grid.innerHTML=h
  }
}

function _applyConfig(cfg){
  if(!cfg)return;
  var plans=_getPlans(cfg);
  _renderPricingCards(plans,cfg);
  _renderHero(cfg);
  _renderBenefits(cfg);
  console.log('[PassRenderer] Config applied — '+plans.length+' plans rendered')
}

// FIX 14: Retry logic for config loading
function _loadFromSupabase(retry){
  retry=retry||0;
  var client=window.supabaseClient;
  if(!client){
    if(retry<_maxRetries){setTimeout(function(){_loadFromSupabase(retry+1)},1000*(retry+1))}
    return;
  }
  client.from('site_config').select('value').eq('key','pass_management_config').maybeSingle().then(function(res){
    if(res.error||!res.data||!res.data.value){
      if(retry<_maxRetries){
        console.warn('[PassRenderer] Config load failed, retrying ('+(retry+1)+'/'+_maxRetries+')');
        setTimeout(function(){_loadFromSupabase(retry+1)},1000*(retry+1));
      }else{
        console.warn('[PassRenderer] No config after '+_maxRetries+' retries. Using localStorage.');
      }
      return;
    }
    try{
      var sbCfg=JSON.parse(res.data.value);
      // Update localStorage cache
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(sbCfg))}catch(e){}
      _cfg=sbCfg;
      _applyConfig(sbCfg);
      _retryCount=0; // Reset retry count on success
    }catch(e){console.warn('[PassRenderer] Parse error:',e)}
  }).catch(function(e){
    if(retry<_maxRetries){
      console.warn('[PassRenderer] Supabase error, retrying ('+(retry+1)+'/'+_maxRetries+'):',e);
      setTimeout(function(){_loadFromSupabase(retry+1)},1000*(retry+1));
    }else{
      console.warn('[PassRenderer] Supabase error after retries:',e);
    }
  })
}

// FIX 3: Listen for config update events (from admin save)
function _initEventListeners(){
  // Listen for custom event from pass-management.js
  window.addEventListener('studyria:passConfigUpdated',function(e){
    console.log('[PassRenderer] Config updated event received, refreshing');
    _loaded=false;
    _cfg=_loadFromStorage();
    if(_cfg){_applyConfig(_cfg)}
    // Also re-fetch from Supabase
    _loadFromSupabase();
  });
}

window.PassRenderer={
  init:function(){
    if(_loaded)return;_loaded=true;
    _initEventListeners();
    // 1. Try localStorage for instant render
    _cfg=_loadFromStorage();
    if(_cfg){_applyConfig(_cfg)}
    // 2. Try Supabase for authoritative config (with retry)
    _loadFromSupabase();
  },
  refresh:function(){
    _loaded=false;
    _cfg=_loadFromStorage();
    if(_cfg){_applyConfig(_cfg)}
    _loadFromSupabase();
  }
};

// Auto-init when premium page is shown
var _origNavigate=window.navigate;
if(typeof _origNavigate==='function'){
  window.navigate=function(page){
    var result=_origNavigate.apply(this,arguments);
    if(page==='premium'){
      setTimeout(function(){window.PassRenderer.init()},300)
    }
    return result
  }
}
// Also init on DOM ready
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(function(){window.PassRenderer.init()},1000)})}else{setTimeout(function(){window.PassRenderer.init()},500)}
})();
