/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADRE PAPERS — Complete Previous Year Paper System  v1.0
 * Studyria Production Module
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Features:
 *  - Verified paper configuration for ADRE 1.0 (2022) and ADRE 2.0 (2024)
 *  - Paper library with filters (year, edition, grade, qualification, paper)
 *  - Paper detail view with full metadata
 *  - Real exam engine with timer, question palette, mark-for-review
 *  - Auto-save (localStorage + Supabase) with refresh recovery
 *  - Variable marking support (Paper IV: Q1-125 = 1 mark, Q126-150 = 2 marks)
 *  - Paper-specific negative marking
 *  - Result engine with question review
 *  - Practice certificate generation
 *  - Attempt history
 *  - Admin paper management interface
 *
 * Data Sources:
 *  - Official ASSEB / SLRC notifications (asseb.org)
 *  - jobassam.in verified paper listings
 *  - testbook.com verified exam metadata
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root) {

  // ═══ SECTION 1: PAPER CONFIGURATION ENGINE ═══

  var ADRE_PAPERS = [
    // ── ADRE 2.0 (2024) ──
    { id:'adre2-2024-p1', edition:'ADRE 2.0', year:2024, paper_number:'I',
      grade:'Grade IV', qualification_level:'Class VIII',
      applicable_posts:'Grade IV — Class VIII Level General Posts',
      question_count:135, maximum_marks:135, duration_minutes:150,
      default_question_mark:1, negative_mark:0.25, special_marking_rules:null,
      language:'Assamese, Bengali, Bodo, English, Hindi',
      source_url:'https://asseb.org/adre-question-paper/',
      exam_date:'2024-10-27', answer_key_status:'verified',
      answer_key_source:'ASSEB Official Answer Key',
      verification_status:'verified', published:false, questions_status:'pending_import' },
    { id:'adre2-2024-p2', edition:'ADRE 2.0', year:2024, paper_number:'II',
      grade:'Grade IV', qualification_level:'HSLC (Class X)',
      applicable_posts:'Grade IV — HSLC Level General Posts',
      question_count:135, maximum_marks:135, duration_minutes:150,
      default_question_mark:1, negative_mark:0.25, special_marking_rules:null,
      language:'Assamese, Bengali, Bodo, English, Hindi',
      source_url:'https://asseb.org/adre-question-paper/',
      exam_date:'2024-10-27', answer_key_status:'verified',
      answer_key_source:'ASSEB Official Answer Key',
      verification_status:'verified', published:false, questions_status:'pending_import' },
    { id:'adre2-2024-p3', edition:'ADRE 2.0', year:2024, paper_number:'III',
      grade:'Grade III', qualification_level:'HSSLC (Class XII)',
      applicable_posts:'Grade III — HSSLC Level General Posts',
      question_count:150, maximum_marks:150, duration_minutes:180,
      default_question_mark:1, negative_mark:0.25, special_marking_rules:null,
      language:'Assamese, Bengali, Bodo, English, Hindi',
      source_url:'https://asseb.org/adre-question-paper/',
      exam_date:'2024-09-15', answer_key_status:'verified',
      answer_key_source:'ASSEB Official Answer Key',
      verification_status:'verified', published:false, questions_status:'pending_import' },
    { id:'adre2-2024-p4', edition:'ADRE 2.0', year:2024, paper_number:'IV',
      grade:'Grade III', qualification_level:"Bachelor's Degree",
      applicable_posts:"Grade III — Bachelor's Degree Level General Posts",
      question_count:150, maximum_marks:175, duration_minutes:180,
      default_question_mark:1, negative_mark:0.25,
      special_marking_rules:{ description:'Q1-125: 1 mark each (125 marks). Q126-150: 2 marks each — Reading Comprehension (50 marks). Wrong 1-mark: -0.25. Wrong 2-mark: -0.50.',
        rules:[{question_range:[1,125],marks:1,negative_mark:0.25},{question_range:[126,150],marks:2,negative_mark:0.50}] },
      language:'Assamese, Bengali, Bodo, English, Hindi',
      source_url:'https://asseb.org/adre-question-paper/',
      exam_date:'2024-09-29', answer_key_status:'verified',
      answer_key_source:'ASSEB Official Answer Key',
      verification_status:'verified', published:false, questions_status:'pending_import' },
    { id:'adre2-2024-p5', edition:'ADRE 2.0', year:2024, paper_number:'V',
      grade:'Grade III', qualification_level:'HSLC + Valid Driving Licence',
      applicable_posts:'Grade III — Driver Posts',
      question_count:150, maximum_marks:150, duration_minutes:180,
      default_question_mark:1, negative_mark:0.25, special_marking_rules:null,
      language:'Assamese, Bengali, Bodo, English, Hindi',
      source_url:'https://asseb.org/adre-question-paper/',
      exam_date:'2024-09-29', answer_key_status:'verified',
      answer_key_source:'ASSEB Official Answer Key',
      verification_status:'verified', published:false, questions_status:'pending_import' },
    // ── ADRE 1.0 (2022) ──
    { id:'adre1-2022-p1', edition:'ADRE 1.0', year:2022, paper_number:'I',
      grade:'Grade IV', qualification_level:'Class VIII',
      applicable_posts:'Grade IV — Class VIII Level General Posts',
      question_count:null, maximum_marks:null, duration_minutes:null,
      default_question_mark:null, negative_mark:0, special_marking_rules:null,
      language:'Assamese, Bodo, English, Hindi',
      source_url:'https://asseb.org/adre-question-paper/',
      exam_date:'2022-08-21', answer_key_status:'not_available',
      answer_key_source:null, verification_status:'partial',
      published:false, questions_status:'pending_import' },
    { id:'adre1-2022-p2', edition:'ADRE 1.0', year:2022, paper_number:'II',
      grade:'Grade IV', qualification_level:'HSLC (Class X)',
      applicable_posts:'Grade IV — HSLC Level General Posts',
      question_count:null, maximum_marks:null, duration_minutes:null,
      default_question_mark:null, negative_mark:0, special_marking_rules:null,
      language:'Assamese, Bodo, English, Hindi',
      source_url:'https://asseb.org/adre-question-paper/',
      exam_date:'2022-08-21', answer_key_status:'not_available',
      answer_key_source:null, verification_status:'partial',
      published:false, questions_status:'pending_import' },
    { id:'adre1-2022-p3', edition:'ADRE 1.0', year:2022, paper_number:'III',
      grade:'Grade III', qualification_level:'HSSLC (Class XII)',
      applicable_posts:'Grade III — HSSLC Level General Posts',
      question_count:100, maximum_marks:150, duration_minutes:120,
      default_question_mark:1.5, negative_mark:0, special_marking_rules:null,
      language:'Assamese, Bodo, English, Hindi',
      source_url:'https://asseb.org/adre-question-paper/',
      exam_date:'2022-08-28', answer_key_status:'not_available',
      answer_key_source:null, verification_status:'verified',
      published:false, questions_status:'pending_import' },
    { id:'adre1-2022-p4', edition:'ADRE 1.0', year:2022, paper_number:'IV',
      grade:'Grade III', qualification_level:"Bachelor's Degree",
      applicable_posts:"Grade III — Bachelor's Degree Level General Posts",
      question_count:100, maximum_marks:175, duration_minutes:120,
      default_question_mark:null, negative_mark:0,
      special_marking_rules:{ description:'Variable marking — exact split pending verification from official source.',
        rules:[{question_range:[1,75],marks:1.5,negative_mark:0},{question_range:[76,100],marks:2,negative_mark:0}] },
      language:'Assamese, Bodo, English, Hindi',
      source_url:'https://asseb.org/adre-question-paper/',
      exam_date:'2022-08-28', answer_key_status:'not_available',
      answer_key_source:null, verification_status:'partial',
      published:false, questions_status:'pending_import' },
    { id:'adre1-2022-p5', edition:'ADRE 1.0', year:2022, paper_number:'V',
      grade:'Grade III', qualification_level:'HSLC + Valid Driving Licence',
      applicable_posts:'Grade III — Driver Posts',
      question_count:100, maximum_marks:150, duration_minutes:120,
      default_question_mark:1.5, negative_mark:0, special_marking_rules:null,
      language:'Assamese, Bodo, English, Hindi',
      source_url:'https://asseb.org/adre-question-paper/',
      exam_date:'2022-08-28', answer_key_status:'not_available',
      answer_key_source:null, verification_status:'verified',
      published:false, questions_status:'pending_import' }
  ];

  // ═══ SECTION 2: MARKING ENGINE ═══

  function getQuestionMarks(paper, qn) {
    if (paper.special_marking_rules && paper.special_marking_rules.rules) {
      for (var i=0;i<paper.special_marking_rules.rules.length;i++){
        var r=paper.special_marking_rules.rules[i];
        if (qn>=r.question_range[0] && qn<=r.question_range[1]) return r.marks;
      }
    }
    return paper.default_question_mark;
  }
  function getQuestionNegativeMark(paper, qn) {
    if (paper.special_marking_rules && paper.special_marking_rules.rules) {
      for (var i=0;i<paper.special_marking_rules.rules.length;i++){
        var r=paper.special_marking_rules.rules[i];
        if (qn>=r.question_range[0] && qn<=r.question_range[1]) return r.negative_mark;
      }
    }
    return paper.negative_mark;
  }
  function calculateMaxMarks(paper) {
    if (paper.special_marking_rules && paper.special_marking_rules.rules) {
      var t=0;
      for (var i=0;i<paper.special_marking_rules.rules.length;i++){
        var r=paper.special_marking_rules.rules[i];
        t+=(r.question_range[1]-r.question_range[0]+1)*r.marks;
      }
      return t;
    }
    return paper.question_count*paper.default_question_mark;
  }
  function validatePaper(paper, qs) {
    var e=[];
    if (!paper.question_count||paper.question_count<=0) e.push('Question count not defined.');
    if (!paper.maximum_marks||paper.maximum_marks<=0) e.push('Maximum marks not defined.');
    if (!paper.duration_minutes||paper.duration_minutes<=0) e.push('Duration not defined.');
    if (qs&&qs.length>0) {
      if (qs.length!==paper.question_count) e.push('Question count mismatch: expected '+paper.question_count+', got '+qs.length+'.');
      for (var i=0;i<qs.length;i++) {
        if (!qs[i].question_text) e.push('Q'+(i+1)+': missing text.');
        if (!qs[i].correct_answer||['a','b','c','d'].indexOf(qs[i].correct_answer)<0) e.push('Q'+(i+1)+': invalid answer.');
      }
      var cm=calculateMaxMarks(paper);
      if (cm!==paper.maximum_marks) e.push('Calculated max ('+cm+') != configured ('+paper.maximum_marks+').');
    }
    return {valid:e.length===0, errors:e};
  }

  // ═══ SECTION 3: STATE ═══
  var S={currentPaper:null,currentQuestions:[],answers:{},markedForReview:{},startTime:0,duration:0,attemptId:null,submitted:false,filterYear:'all',filterEdition:'all',filterGrade:'all',filterQualification:'all',filterPaper:'all',view:'library',resultData:null,examTimer:null};

  // ═══ SECTION 4: AUTO-SAVE ═══
  var SK='studyria_adre_exam_';
  function saveState(){if(!S.currentPaper||!S.attemptId)return;try{localStorage.setItem(SK+S.currentPaper.id,JSON.stringify({paperId:S.currentPaper.id,attemptId:S.attemptId,answers:S.answers,markedForReview:S.markedForReview,startTime:S.startTime,duration:S.duration,submitted:S.submitted}));}catch(e){}}
  function loadState(pid){try{var r=localStorage.getItem(SK+pid);return r?JSON.parse(r):null;}catch(e){return null;}}
  function clearState(pid){try{localStorage.removeItem(SK+pid);}catch(e){}}

  // ═══ SECTION 5: QUESTION LOADING ═══
  async function loadQuestions(paper){
    var sb=root.supabaseClient||(typeof window!=='undefined'?window.supabaseClient:null);
    if(!sb) return [];
    try{
      var r=await sb.from('adre_paper_questions').select('id,question_number,question_text,option_a,option_b,option_c,option_d,correct_answer,marks,negative_marks,topic,section,sort_order').eq('paper_id',paper.id).order('sort_order',{ascending:true}).limit(200);
      if(r.error){console.warn('[ADRE] Q load err:',r.error.message);return [];}
      return r.data||[];
    }catch(e){console.warn('[ADRE] Q load fail:',e);return [];}
  }
  async function loadAttempts(pid){
    var sb=root.supabaseClient||(typeof window!=='undefined'?window.supabaseClient:null);
    if(!sb) return [];
    try{
      var u=typeof getCurrentUser==='function'?getCurrentUser():(window.currentUser||null);
      if(!u) return [];
      var r=await sb.from('adre_attempts').select('id,paper_id,score,maximum_marks,percentage,total_correct,total_wrong,total_unanswered,negative_marks,time_spent_seconds,completed_at,created_at').eq('paper_id',pid).eq('user_id',u.id).order('created_at',{ascending:false}).limit(50);
      return r.data||[];
    }catch(e){return [];}
  }

  // ═══ SECTION 6: EXAM ENGINE ═══
  async function startExam(pid){
    var paper=ADRE_PAPERS.find(function(p){return p.id===pid;});
    if(!paper){toast('Paper not found.','error');return;}
    var qs=await loadQuestions(paper);
    if(!qs.length){toast('Questions not imported yet.','info');showDetail(pid);return;}
    var v=validatePaper(paper,qs);
    if(!v.valid){toast('Validation failed: '+v.errors[0],'error');return;}
    var saved=loadState(pid);
    if(saved&&!saved.submitted){
      S.currentPaper=paper;S.currentQuestions=qs;S.answers=saved.answers||{};S.markedForReview=saved.markedForReview||{};
      S.startTime=saved.startTime;S.duration=saved.duration;S.attemptId=saved.attemptId;S.submitted=false;S.view='exam';
      renderExam();toast('Resumed previous attempt.','info');return;
    }
    S.currentPaper=paper;S.currentQuestions=qs;S.answers={};S.markedForReview={};
    S.startTime=Date.now();S.duration=paper.duration_minutes*60000;
    S.attemptId=pid+'-'+Date.now()+'-'+Math.random().toString(36).substr(2,9);
    S.submitted=false;S.view='exam';saveState();renderExam();
  }
  function selectAnswer(qid,opt){if(S.submitted)return;S.answers[qid]=opt;saveState();updatePalette();updateOpt(qid);}
  function toggleReview(qid){if(S.submitted)return;if(S.markedForReview[qid])delete S.markedForReview[qid];else S.markedForReview[qid]=true;saveState();updatePalette();var b=document.getElementById('ap-mark-'+qid);if(b)b.textContent=S.markedForReview[qid]?'★ Marked':'☆ Mark for Review';}
  function updateOpt(qid){var c=document.querySelector('[data-q="'+qid+'"]');if(!c)return;var s=S.answers[qid];c.querySelectorAll('.ap-option').forEach(function(o){o.classList.toggle('selected',o.dataset.option===s);});}

  // ═══ SECTION 7: TIMER ═══
  function startTimer(){
    if(S.examTimer)clearInterval(S.examTimer);
    var end=S.startTime+S.duration;
    function tick(){
      var r=Math.max(0,end-Date.now());
      var h=Math.floor(r/3600000),m=Math.floor((r%3600000)/60000),s=Math.floor((r%60000)/1000);
      var el=document.getElementById('apTimer');
      if(el){el.textContent=pad(h)+':'+pad(m)+':'+pad(s);if(r<=300000)el.classList.add('ap-timer-warning');}
      if(r<=0){clearInterval(S.examTimer);S.examTimer=null;autoSubmit();}
    }
    tick();S.examTimer=setInterval(tick,1000);
  }
  function pad(n){return (n<10?'0':'')+n;}

  // ═══ SECTION 8: SUBMISSION ═══
  async function submitExam(){
    if(S.submitted)return;
    var ua=S.currentQuestions.length-Object.keys(S.answers).length;
    if(ua>0&&!confirm(ua+' question(s) unanswered. Submit anyway?'))return;
    await doSubmit(false);
  }
  async function autoSubmit(){if(S.submitted)return;toast('Time up! Auto-submitting...','info');await doSubmit(true);}
  async function doSubmit(isAuto){
    S.submitted=true;
    if(S.examTimer){clearInterval(S.examTimer);S.examTimer=null;}
    var p=S.currentPaper,qs=S.currentQuestions,c=0,w=0,ua=0,rs=0,nm=0;
    qs.forEach(function(q,idx){
      var qn=idx+1,a=S.answers[q.id],qM=getQuestionMarks(p,qn),qN=getQuestionNegativeMark(p,qn);
      if(q.marks)qM=q.marks;
      if(q.negative_marks!==null&&q.negative_marks!==undefined)qN=q.negative_marks;
      if(!a){ua++;}else if(a===q.correct_answer){c++;rs+=qM;}else{w++;nm+=qN;}
    });
    var fs=Math.max(0,rs-nm),pct=Math.round((fs/p.maximum_marks)*100),ts=Math.floor((Date.now()-S.startTime)/1000);
    var acc=(c+w)>0?Math.round((c/(c+w))*100):0;
    var result={paper:p,score:fs,rawScore:rs,negativeMarks:nm,maximumMarks:p.maximum_marks,percentage:pct,correct:c,wrong:w,unanswered:ua,accuracy:acc,timeSpent:ts,isAuto:isAuto,questions:qs,answers:S.answers,attemptId:S.attemptId,completedAt:new Date().toISOString()};
    await persist(result);clearState(p.id);S.resultData=result;S.view='result';renderResult();window.scrollTo(0,0);
  }
  async function persist(r){
    var sb=root.supabaseClient||(typeof window!=='undefined'?window.supabaseClient:null);
    if(!sb)return;
    var u=typeof getCurrentUser==='function'?getCurrentUser():(window.currentUser||null);
    if(!u)return;
    try{
      var ex=await sb.from('adre_attempts').select('id').eq('attempt_id',r.attemptId).limit(1);
      if(ex.data&&ex.data.length>0)return;
      await sb.from('adre_attempts').insert({attempt_id:r.attemptId,paper_id:r.paper.id,user_id:u.id,score:r.score,raw_score:r.rawScore,negative_marks:r.negativeMarks,maximum_marks:r.maximumMarks,percentage:r.percentage,total_correct:r.correct,total_wrong:r.wrong,total_unanswered:r.unanswered,accuracy:r.accuracy,time_spent_seconds:r.timeSpent,answers:r.answers,completed_at:r.completedAt,is_auto_submit:r.isAuto});
    }catch(e){console.error('[ADRE] Persist fail:',e);}
  }

  // ═══ SECTION 9: CERTIFICATE ═══
  function genCertId(){return 'STR-ADRE-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).substr(2,4).toUpperCase();}
  function renderCert(r){
    var u=typeof getCurrentUser==='function'?getCurrentUser():(window.currentUser||null);
    var name=u?(u.user_metadata&&u.user_metadata.full_name||u.email&&u.email.split('@')[0]||'Student'):'Student';
    var cid=genCertId();
    var dt=new Date(r.completedAt).toLocaleDateString('en-IN',{year:'numeric',month:'long',day:'numeric'});
    return '<div class="ap-cert"><div class="ap-cert-border">'+
      '<div class="ap-cert-header"><div class="ap-cert-logo">🎓 Studyria</div>'+
      '<div class="ap-cert-title">Practice Certificate</div>'+
      '<div class="ap-cert-subtitle">Not an Official Recruitment Certificate</div></div>'+
      '<div class="ap-cert-body"><div class="ap-cert-label">This certifies that</div>'+
      '<div class="ap-cert-name">'+esc(name)+'</div>'+
      '<div class="ap-cert-label">has successfully completed</div>'+
      '<div class="ap-cert-exam">'+r.paper.edition+' — '+r.paper.year+'</div>'+
      '<div class="ap-cert-paper">Paper '+r.paper.paper_number+' — '+r.paper.qualification_level+'</div>'+
      '<div class="ap-cert-score-row">'+
      '<div class="ap-cert-score-item"><div class="ap-cert-score-val">'+r.score+'</div><div class="ap-cert-score-lbl">Score</div></div>'+
      '<div class="ap-cert-score-item"><div class="ap-cert-score-val">'+r.percentage+'%</div><div class="ap-cert-score-lbl">Percentage</div></div>'+
      '<div class="ap-cert-score-item"><div class="ap-cert-score-val">'+r.accuracy+'%</div><div class="ap-cert-score-lbl">Accuracy</div></div>'+
      '</div><div class="ap-cert-date">'+dt+'</div>'+
      '<div class="ap-cert-id">Certificate ID: '+cid+'</div></div>'+
      '<div class="ap-cert-footer">Studyria Practice Certificate — Issued by studyria.qzz.io</div></div></div>';
  }

  // ═══ SECTION 10: RENDER LIBRARY ═══
  function renderLib(){
    var c=document.getElementById('apContent');if(!c)return;
    var f=getFiltered();
    var h='';
    h+=renderFilters();
    var eds=['ADRE 2.0','ADRE 1.0'];
    eds.forEach(function(ed){
      var ep=f.filter(function(p){return p.edition===ed;});
      if(!ep.length)return;
      h+='<div class="ap-edition-block"><div class="ap-edition-title">'+ed+' — '+ep[0].year+'</div>';
      var grs=['Grade III','Grade IV'];
      grs.forEach(function(gr){
        var gp=ep.filter(function(p){return p.grade===gr;});
        if(!gp.length)return;
        h+='<div class="ap-grade-section"><div class="ap-grade-label">'+gr+'</div><div class="ap-paper-grid">';
        gp.forEach(function(p){h+=renderCard(p);});
        h+='</div></div>';
      });
      h+='</div>';
    });
    if(!f.length)h+='<div class="ap-empty">No papers match the selected filters.</div>';
    c.innerHTML=h;
    document.querySelectorAll('.ap-filter-chip').forEach(function(ch){ch.addEventListener('click',function(){S[this.dataset.filter]=this.dataset.value;renderLib();});});
  }
  function renderFilters(){
    var h='<div class="ap-filters">';
    h+=fGrp('Year','filterYear',['all','2024','2022'],S.filterYear);
    h+=fGrp('Edition','filterEdition',['all','ADRE 2.0','ADRE 1.0'],S.filterEdition);
    h+=fGrp('Grade','filterGrade',['all','Grade III','Grade IV'],S.filterGrade);
    h+=fGrp('Qualification','filterQualification',['all','Class VIII','HSLC (Class X)','HSSLC (Class XII)',"Bachelor's Degree",'HSLC + Valid Driving Licence'],S.filterQualification);
    h+=fGrp('Paper','filterPaper',['all','I','II','III','IV','V'],S.filterPaper);
    h+='</div>';return h;
  }
  function fGrp(lb,key,opts,act){
    var h='<div class="ap-filter-group"><div class="ap-filter-label">'+lb+'</div><div class="ap-filter-options">';
    opts.forEach(function(o){var d=o==='all'?'All':o;h+='<button class="ap-filter-chip'+(act===o?' active':'')+'" data-filter="'+key+'" data-value="'+o+'">'+d+'</button>';});
    return h+'</div></div>';
  }
  function getFiltered(){
    return ADRE_PAPERS.filter(function(p){
      if(S.filterYear!=='all'&&String(p.year)!==S.filterYear)return false;
      if(S.filterEdition!=='all'&&p.edition!==S.filterEdition)return false;
      if(S.filterGrade!=='all'&&p.grade!==S.filterGrade)return false;
      if(S.filterQualification!=='all'&&p.qualification_level!==S.filterQualification)return false;
      if(S.filterPaper!=='all'&&p.paper_number!==S.filterPaper)return false;
      return true;
    });
  }
  function renderCard(p){
    var v=p.verification_status==='verified',hasQ=p.questions_status!=='pending_import';
    var sb=p.published&&hasQ?'<span class="ap-badge ap-badge-published">✓ Published</span>':hasQ?'<span class="ap-badge ap-badge-ready">Ready</span>':'<span class="ap-badge ap-badge-pending">Questions Pending</span>';
    var vb=v?'<span class="ap-badge ap-badge-verified">✓ Verified</span>':'<span class="ap-badge ap-badge-partial">⚠ Partial</span>';
    var ak=p.answer_key_status==='verified'?'<span class="ap-badge ap-badge-verified">✓ Answer Key</span>':'<span class="ap-badge ap-badge-partial">No Answer Key</span>';
    var neg=p.negative_mark>0?'⚠️ -'+p.negative_mark+' per wrong':'No negative marking';
    var marks=p.maximum_marks?'📊 '+p.maximum_marks+' Marks':'📊 Marks: TBA';
    var qs=p.question_count?'📝 '+p.question_count+' Questions':'📝 Questions: TBA';
    var dur=p.duration_minutes?'⏱️ '+fmtDur(p.duration_minutes):'⏱️ Duration: TBA';
    var sp=p.special_marking_rules?'<div class="ap-card-special">📋 '+p.special_marking_rules.description.substring(0,80)+'…</div>':'';
    return '<div class="ap-paper-card" onclick="ADREPapers.openDetail(\''+p.id+'\')">'+
      '<div class="ap-card-header"><div class="ap-card-edition">🏛️ '+p.edition+' — '+p.year+'</div><div class="ap-card-paper">Paper '+p.paper_number+'</div></div>'+
      '<div class="ap-card-level">'+p.qualification_level+' — '+p.grade+'</div>'+
      '<div class="ap-card-meta"><span>'+qs+'</span><span>'+marks+'</span><span>'+dur+'</span></div>'+
      '<div class="ap-card-neg">'+neg+'</div>'+sp+
      '<div class="ap-card-badges">'+sb+vb+ak+'</div>'+
      '<div class="ap-card-cta">'+(hasQ?'<button class="ap-btn ap-btn-primary" onclick="event.stopPropagation();ADREPapers.startExam(\''+p.id+'\')">Start Real Paper →</button>':'<button class="ap-btn ap-btn-disabled" disabled>Questions Pending Import</button>')+'</div></div>';
  }

  // ═══ SECTION 11: RENDER DETAIL ═══
  async function showDetail(pid){
    var p=ADRE_PAPERS.find(function(x){return x.id===pid;});if(!p)return;
    S.view='detail';var c=document.getElementById('apContent');if(!c)return;
    var hasQ=p.questions_status!=='pending_import';
    var atts=await loadAttempts(pid);
    var h='<div class="ap-detail"><button class="ap-back-btn" onclick="ADREPapers.showLibrary()">← Back to Papers</button>';
    h+='<div class="ap-detail-header"><div class="ap-detail-edition">🏛️ '+p.edition+' — '+p.year+'</div>';
    h+='<div class="ap-detail-paper">Paper '+p.paper_number+'</div>';
    h+='<div class="ap-detail-level">'+p.qualification_level+' — '+p.grade+'</div></div>';
    h+='<div class="ap-detail-grid">';
    h+=dRow('Exam','Assam Direct Recruitment Examination');
    h+=dRow('Year',String(p.year));h+=dRow('Paper','Paper '+p.paper_number);h+=dRow('Grade',p.grade);
    h+=dRow('Qualification',p.qualification_level);h+=dRow('Applicable Posts',p.applicable_posts);
    h+=dRow('Questions',p.question_count?String(p.question_count):'TBA');
    h+=dRow('Maximum Marks',p.maximum_marks?String(p.maximum_marks):'TBA');
    h+=dRow('Duration',p.duration_minutes?fmtDur(p.duration_minutes):'TBA');
    h+=dRow('Negative Marking',p.negative_mark>0?'-'+p.negative_mark+' per wrong answer':'No negative marking');
    if(p.special_marking_rules)h+=dRow('Special Marking',p.special_marking_rules.description);
    h+=dRow('Language',p.language);h+=dRow('Exam Date',p.exam_date||'TBA');
    h+=dRow('Official Source',p.source_url,true);
    h+=dRow('Answer Key',p.answer_key_status==='verified'?'✓ Verified — '+p.answer_key_source:'Not Available');
    h+=dRow('Verification',p.verification_status==='verified'?'✓ Fully Verified':'⚠ Partially Verified');
    h+='</div>';
    if(atts.length>0){
      h+='<div class="ap-detail-attempts"><div class="ap-detail-section-title">Your Attempts</div>';
      atts.forEach(function(a,i){
        h+='<div class="ap-attempt-row"><div class="ap-attempt-info"><span class="ap-attempt-num">#'+(i+1)+'</span><span class="ap-attempt-score">'+a.score+'/'+a.maximum_marks+'</span><span class="ap-attempt-pct">'+a.percentage+'%</span></div><div class="ap-attempt-date">'+new Date(a.completed_at||a.created_at).toLocaleDateString('en-IN')+'</div></div>';
      });
      h+='</div>';
    }
    h+='<div class="ap-detail-cta">';
    if(hasQ){
      h+='<button class="ap-btn ap-btn-primary ap-btn-large" onclick="ADREPapers.startExam(\''+p.id+'\')">Start Real Paper →</button>';
    }else{
      h+='<div class="ap-pending-notice">📋 Questions for this paper have not been imported yet. The paper configuration is verified from official sources. Questions will be available once the official question paper PDF is processed and imported.</div>';
      h+='<button class="ap-btn ap-btn-disabled" disabled>Start Real Paper — Pending Import</button>';
    }
    h+='</div></div>';
    c.innerHTML=h;
  }
  function dRow(lb,val,link){
    if(link)return '<div class="ap-detail-row"><div class="ap-detail-label">'+lb+'</div><div class="ap-detail-value"><a href="'+val+'" target="_blank" rel="noopener">'+val+'</a></div></div>';
    return '<div class="ap-detail-row"><div class="ap-detail-label">'+lb+'</div><div class="ap-detail-value">'+val+'</div></div>';
  }

  // ═══ SECTION 12: RENDER EXAM ═══
  function renderExam(){
    var c=document.getElementById('apContent');if(!c||!S.currentPaper)return;
    var p=S.currentPaper,qs=S.currentQuestions;
    var h='<div class="ap-exam">';
    h+='<div class="ap-exam-header"><div class="ap-exam-title">'+p.edition+' — Paper '+p.paper_number+'</div>';
    h+='<div class="ap-exam-meta">'+p.qualification_level+' · '+p.question_count+' Q · '+p.maximum_marks+' Marks</div>';
    h+='<div id="apTimer" class="ap-timer">'+fmtMs(S.duration)+'</div></div>';
    h+='<div class="ap-exam-actions"><button class="ap-btn ap-btn-ghost" onclick="ADREPapers.exitExam()">Exit</button>';
    h+='<div class="ap-exam-progress" id="apProgress">0/'+qs.length+' answered</div>';
    h+='<button class="ap-btn ap-btn-primary" onclick="ADREPapers.submitExam()">Submit Exam</button></div>';
    h+='<div class="ap-palette" id="apPalette"><div class="ap-palette-title">Question Palette</div><div class="ap-palette-grid">';
    qs.forEach(function(q,i){
      var qn=i+1,a=S.answers[q.id]?' answered':'',m=S.markedForReview[q.id]?' marked':'';
      h+='<button class="ap-palette-btn'+a+m+'" onclick="ADREPapers.scrollToQuestion('+qn+')" data-pnum="'+qn+'">'+qn+'</button>';
    });
    h+='</div><div class="ap-palette-legend"><span class="ap-legend-item"><span class="ap-legend-dot answered"></span>Answered</span><span class="ap-legend-item"><span class="ap-legend-dot marked"></span>Marked</span><span class="ap-legend-item"><span class="ap-legend-dot"></span>Not Visited</span></div></div>';
    h+='<div class="ap-questions">';
    qs.forEach(function(q,i){
      var qn=i+1,qM=getQuestionMarks(p,qn),qN=getQuestionNegativeMark(p,qn);
      if(q.marks)qM=q.marks;
      if(q.negative_marks!==null&&q.negative_marks!==undefined)qN=q.negative_marks;
      var nT=qN>0?' · -'+qN+' wrong':'';
      h+='<div class="ap-question" data-q="'+q.id+'" id="ap-q'+qn+'">';
      h+='<div class="ap-q-header"><span class="ap-q-num">Q'+qn+'</span><span class="ap-q-marks">'+qM+' mark'+(qM>1?'s':'')+nT+'</span></div>';
      h+='<div class="ap-q-text">'+esc(q.question_text)+'</div><div class="ap-options">';
      var opts=[{key:'a',text:q.option_a},{key:'b',text:q.option_b},{key:'c',text:q.option_c},{key:'d',text:q.option_d}].filter(function(o){return o.text;});
      opts.forEach(function(o){
        var sel=S.answers[q.id]===o.key?' selected':'';
        h+='<div class="ap-option'+sel+'" data-option="'+o.key+'" onclick="ADREPapers.selectAnswer(\''+q.id+'\',\''+o.key+'\')"><div class="ap-option-letter">'+o.key.toUpperCase()+'</div><div class="ap-option-text">'+esc(o.text)+'</div></div>';
      });
      h+='</div><div class="ap-q-actions"><button class="ap-btn-sm ap-btn-ghost" onclick="ADREPapers.toggleMarkForReview(\''+q.id+'\')" id="ap-mark-'+q.id+'">'+(S.markedForReview[q.id]?'★ Marked':'☆ Mark for Review')+'</button></div></div>';
    });
    h+='</div><div class="ap-exam-bottom-submit"><button class="ap-btn ap-btn-primary ap-btn-large" onclick="ADREPapers.submitExam()">Submit Exam</button></div></div>';
    c.innerHTML=h;startTimer();updateProgress();
  }
  function updatePalette(){
    if(!S.currentQuestions)return;
    S.currentQuestions.forEach(function(q,i){
      var qn=i+1,b=document.querySelector('[data-pnum="'+qn+'"]');if(!b)return;
      b.classList.toggle('answered',!!S.answers[q.id]);b.classList.toggle('marked',!!S.markedForReview[q.id]);
    });
    updateProgress();
  }
  function updateProgress(){var el=document.getElementById('apProgress');if(!el)return;el.textContent=Object.keys(S.answers).length+'/'+S.currentQuestions.length+' answered';}
  function scrollToQ(qn){var el=document.getElementById('ap-q'+qn);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});}
  function exitExam(){if(!confirm('Progress auto-saved. Exit? You can resume later.'))return;saveState();if(S.examTimer){clearInterval(S.examTimer);S.examTimer=null;}showLib();}

  // ═══ SECTION 13: RENDER RESULT ═══
  function renderResult(){
    var c=document.getElementById('apContent');if(!c||!S.resultData)return;
    var r=S.resultData,p=r.paper,pass=r.percentage>=40;
    var h='<div class="ap-result">';
    h+='<div class="ap-result-header '+(pass?'pass':'fail')+'"><div class="ap-result-icon">'+(pass?'🏆':'💪')+'</div><div class="ap-result-title">Mock Completed</div><div class="ap-result-exam">'+p.edition+' — '+p.year+'</div><div class="ap-result-paper">Paper '+p.paper_number+'</div></div>';
    h+='<div class="ap-result-score-card"><div class="ap-result-score-main"><div class="ap-result-score-val">'+r.score+'</div><div class="ap-result-score-max">/ '+r.maximumMarks+'</div></div><div class="ap-result-score-pct">'+r.percentage+'%</div></div>';
    h+='<div class="ap-result-stats">';
    h+=statTile('Correct',r.correct,'var(--ap-success)');
    h+=statTile('Wrong',r.wrong,'var(--ap-danger)');
    h+=statTile('Unanswered',r.unanswered,'var(--ap-muted)');
    h+=statTile('Negative Marks','-'+r.negativeMarks,'var(--ap-danger)');
    h+=statTile('Raw Marks',r.rawScore,'var(--ap-primary)');
    h+=statTile('Accuracy',r.accuracy+'%','var(--ap-primary)');
    h+=statTile('Time Used',fmtSec(r.timeSpent),'var(--ap-muted)');
    h+=statTile('Max Marks',r.maximumMarks,'var(--ap-muted)');
    h+='</div>';
    h+='<div class="ap-result-review"><div class="ap-result-section-title">Question Review</div>';
    r.questions.forEach(function(q,i){
      var qn=i+1,ua=r.answers[q.id],ca=q.correct_answer;
      var isC=ua===ca,isW=ua&&ua!==ca;
      var qM=getQuestionMarks(p,qn),qN=getQuestionNegativeMark(p,qn);
      if(q.marks)qM=q.marks;
      if(q.negative_marks!==null&&q.negative_marks!==undefined)qN=q.negative_marks;
      var me=isC?qM:(isW?-qN:0);
      var sc=isC?'correct':(isW?'wrong':'unanswered');
      var si=isC?'✓':(isW?'✗':'—');
      h+='<div class="ap-review-q '+sc+'"><div class="ap-review-header"><span class="ap-review-num">Q'+qn+'</span><span class="ap-review-status">'+si+'</span><span class="ap-review-marks">'+(me>=0?'+':'')+me+'</span></div>';
      h+='<div class="ap-review-text">'+esc(q.question_text)+'</div>';
      h+='<div class="ap-review-answers"><div class="ap-review-ans"><span class="ap-review-ans-label">Your Answer:</span> '+(ua?ua.toUpperCase()+' — '+esc(q['option_'+ua]||''):'Not answered')+'</div>';
      h+='<div class="ap-review-ans ap-review-correct"><span class="ap-review-ans-label">Official Answer:</span> '+ca.toUpperCase()+' — '+esc(q['option_'+ca]||'')+'</div></div></div>';
    });
    h+='</div>';
    h+='<div class="ap-result-cert-section">'+renderCert(r)+'</div>';
    h+='<div class="ap-result-actions"><button class="ap-btn ap-btn-primary" onclick="ADREPapers.showLibrary()">Back to Papers</button><button class="ap-btn ap-btn-ghost" onclick="ADREPapers.startExam(\''+p.id+'\')">Retry Paper</button></div>';
    h+='</div>';
    c.innerHTML=h;window.scrollTo(0,0);
  }
  function statTile(lb,val,color){return '<div class="ap-stat-tile"><div class="ap-stat-val" style="color:'+color+'">'+val+'</div><div class="ap-stat-lbl">'+lb+'</div></div>';}

  // ═══ SECTION 14: RENDER HISTORY ═══
  async function renderHist(){
    var c=document.getElementById('apContent');if(!c)return;
    var sb=root.supabaseClient||(typeof window!=='undefined'?window.supabaseClient:null);
    if(!sb){c.innerHTML='<div class="ap-empty">History requires login.</div>';return;}
    var u=typeof getCurrentUser==='function'?getCurrentUser():(window.currentUser||null);
    if(!u){c.innerHTML='<div class="ap-empty">Please login to view history. <button class="ap-btn ap-btn-primary" onclick="navigate(\'login\')">Sign In</button></div>';return;}
    c.innerHTML='<div class="ap-loading">Loading history…</div>';
    try{
      var r=await sb.from('adre_attempts').select('id,paper_id,score,maximum_marks,percentage,total_correct,total_wrong,total_unanswered,negative_marks,time_spent_seconds,completed_at,created_at').eq('user_id',u.id).order('created_at',{ascending:false}).limit(100);
      if(!r.data||!r.data.length){c.innerHTML='<div class="ap-empty">No attempts yet.</div>';return;}
      var bp={};r.data.forEach(function(a){(bp[a.paper_id]=bp[a.paper_id]||[]).push(a);});
      var h='<div class="ap-history"><div class="ap-history-title">📊 ADRE Attempt History</div>';
      Object.keys(bp).forEach(function(pid){
        var p=ADRE_PAPERS.find(function(x){return x.id===pid;});if(!p)return;
        h+='<div class="ap-history-paper"><div class="ap-history-paper-title">'+p.edition+' — Paper '+p.paper_number+'</div><div class="ap-history-paper-level">'+p.qualification_level+'</div>';
        bp[pid].forEach(function(a,i){
          h+='<div class="ap-history-attempt"><div class="ap-ha-left"><span class="ap-ha-num">Attempt #'+(i+1)+'</span><span class="ap-ha-score">'+a.score+'/'+a.maximum_marks+'</span><span class="ap-ha-pct">'+a.percentage+'%</span></div><div class="ap-ha-right"><span>✅ '+a.total_correct+'</span><span>❌ '+a.total_wrong+'</span><span>⏱️ '+fmtSec(a.time_spent_seconds||0)+'</span><div class="ap-ha-date">'+new Date(a.completed_at||a.created_at).toLocaleDateString('en-IN')+'</div></div></div>';
        });
        h+='</div>';
      });
      h+='</div>';c.innerHTML=h;
    }catch(e){c.innerHTML='<div class="ap-empty">Failed to load history.</div>';}
  }

  // ═══ SECTION 15: ADMIN ═══
  function renderAdminView(){
    var c=document.getElementById('apContent');if(!c)return;
    var h='<div class="ap-admin"><div class="ap-admin-title">ADRE Paper Management</div>';
    ADRE_PAPERS.forEach(function(p){
      var v=validatePaper(p,null),hasQ=p.questions_status!=='pending_import';
      h+='<div class="ap-admin-paper"><div class="ap-admin-paper-header"><div class="ap-admin-paper-name">'+p.edition+' — Paper '+p.paper_number+'</div><div class="ap-admin-paper-level">'+p.qualification_level+' · '+p.grade+'</div></div>';
      h+='<div class="ap-admin-grid">';
      h+=aRow('Question Count',p.question_count?p.question_count+' / '+p.question_count:'Not set');
      h+=aRow('Answer Key',p.answer_key_status==='verified'?'✓ Available':'Not Available');
      h+=aRow('Validation',v.valid?'PASS':'FAIL — '+v.errors.join('; '));
      h+=aRow('Source','Official (ASSEB/SLRC)');
      h+=aRow('Status',p.published?'PUBLISHED':(hasQ?'READY':'QUESTIONS PENDING'));
      h+='</div><div class="ap-admin-actions">';
      if(!hasQ)h+='<button class="ap-btn-sm ap-btn-ghost">Import Questions</button>';
      h+='<button class="ap-btn-sm ap-btn-ghost">Edit Metadata</button><button class="ap-btn-sm ap-btn-ghost">Validate</button></div></div>';
    });
    h+='</div>';c.innerHTML=h;
  }
  function aRow(lb,val){return '<div class="ap-admin-row"><span class="ap-admin-label">'+lb+':</span> <span class="ap-admin-value">'+val+'</span></div>';}

  // ═══ SECTION 16: NAV & INIT ═══
  function showLib(){
    S.view='library';S.currentPaper=null;S.currentQuestions=[];S.resultData=null;
    if(S.examTimer){clearInterval(S.examTimer);S.examTimer=null;}
    renderLib();window.scrollTo(0,0);
  }
  function init(){
    var pg=document.getElementById('page-adre-papers');
    if(!pg||!pg.classList.contains('active'))return;
    var t=pg.querySelector('.ap-tab.active');
    if(t){var tn=t.dataset.tab;if(tn==='history')renderHist();else if(tn==='admin')renderAdminView();else renderLib();}
    else renderLib();
  }

  // ═══ SECTION 17: UTILITIES ═══
  function fmtDur(min){if(min<60)return min+' min';var h=Math.floor(min/60),m=min%60;return m>0?h+' hr '+m+' min':h+' hr'+(h>1?'s':'');}
  function fmtMs(ms){var t=Math.floor(ms/1000);return pad(Math.floor(t/3600))+':'+pad(Math.floor((t%3600)/60))+':'+pad(t%60);}
  function fmtSec(s){return Math.floor(s/60)+'m '+(s%60)+'s';}
  function esc(t){if(!t)return '';var d=document.createElement('div');d.textContent=t;return d.innerHTML;}
  function toast(msg,type){if(typeof window.showToast==='function')window.showToast(msg,type);else console.log('[ADRE] '+msg);}

  // ═══ SECTION 18: PUBLIC API ═══
  root.ADREPapers=Object.freeze({
    papers:ADRE_PAPERS,
    getPaper:function(id){return ADRE_PAPERS.find(function(p){return p.id===id;});},
    showLibrary:showLib,
    openDetail:showDetail,
    showHistory:renderHist,
    showAdmin:renderAdminView,
    startExam:startExam,
    selectAnswer:selectAnswer,
    toggleMarkForReview:toggleReview,
    submitExam:submitExam,
    exitExam:exitExam,
    scrollToQuestion:scrollToQ,
    getQuestionMarks:getQuestionMarks,
    getQuestionNegativeMark:getQuestionNegativeMark,
    calculateMaxMarks:calculateMaxMarks,
    validatePaper:validatePaper,
    _tab:function(tab,el){
      document.querySelectorAll('.ap-tab').forEach(function(t){t.classList.remove('active');});
      if(el)el.classList.add('active');
      var c=document.getElementById('apContent');if(!c)return;
      if(tab==='history')renderHist();
      else if(tab==='admin')renderAdminView();
      else renderLib();
    },
    init:init,
    render:function(c){if(c)c.innerHTML='<div id="apContent"></div>';init();}
  });

  console.log('[ADREPapers] v1.0 loaded — 10 papers configured.');

})(typeof self!=='undefined'?self:this);
